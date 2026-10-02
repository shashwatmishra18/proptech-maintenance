import { prisma } from '../prisma';
import { AppError } from '../errors/api-response';
import { NotificationService } from './NotificationService';
import { Priority, Status, Prisma } from '@prisma/client';
import { attachmentUrl, validateOwnedUploads, lockUploader, cleanupUnattachedUploads } from '../attachments';

export const TicketService = {
    getAllForUser: async (user: { userId: string, role: string }, status?: Status) => {
        const where: Prisma.TicketWhereInput = {};
        if (status) where.status = status;

        if (user.role === 'TENANT') {
            where.tenantId = user.userId;
        } else if (user.role === 'TECHNICIAN') {
            where.assignedToId = user.userId;
        } else if (user.role !== 'MANAGER') {
            // Fail-safe block: unknown role blocked from fetching everything
            return [];
        }

        const isTech = user.role === 'TECHNICIAN';

        const tickets = await prisma.ticket.findMany({
            where,
            select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                createdAt: true,
                updatedAt: true,
                images: { select: { id: true, imageUrl: true } },
                tenant: {
                    select: isTech
                        ? { id: true, name: true }
                        : { id: true, name: true, email: true }
                },
                assignedTo: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' }
        });
        return tickets.map(ticket => ({ ...ticket, images: ticket.images.map(image => ({ ...image, imageUrl: attachmentUrl(image.id) })) }));
    },

    create: async (data: { title: string; description: string; priority: Priority; tenantId: string }, imageUrls: string[]) => {
        if (!data.title || !data.description || !Object.values(Priority).includes(data.priority)) {
            throw new AppError('Invalid title, description or priority', 400);
        }
        try {
            return await prisma.$transaction(async db => {
                if (imageUrls.length > 0) {
                    await lockUploader(db, data.tenantId);
                    await validateOwnedUploads(imageUrls, data.tenantId);
                    if (await db.ticketImage.findFirst({ where: { imageUrl: { in: imageUrls } }, select: { id: true } })) {
                        throw new AppError('An attachment is already linked to a ticket', 409);
                    }
                }
                const ticket = await db.ticket.create({ data: {
                    ...data,
                    images: { create: imageUrls.map(imageUrl => ({ imageUrl })) },
                    activityLogs: { create: { userId: data.tenantId, action: 'Ticket created' } },
                } });
                await NotificationService.createForAdmins('New ticket created: ' + ticket.title, db);
                return ticket;
            });
        } catch (error) {
            try { await cleanupUnattachedUploads(imageUrls, data.tenantId); }
            catch { console.warn('Unlinked upload cleanup could not complete; files were retained for safety.'); }
            throw error;
        }
    },

    assign: async (ticketId: string, technicianId: string, managerId: string) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            if (ticket.status !== 'OPEN' || ticket.assignedToId) {
                throw new AppError('This ticket is no longer open and unassigned. Refresh and try again.', 409);
            }
            const tech = await db.user.findUnique({ where: { id: technicianId, role: 'TECHNICIAN' } });
            if (!tech) throw new AppError('Invalid technician ID or user is not a technician', 400);
            const result = await db.ticket.updateMany({
                where: { id: ticketId, status: 'OPEN', assignedToId: null },
                data: { status: 'ASSIGNED', assignedToId: technicianId },
            });
            if (result.count !== 1) throw new AppError('Ticket assignment changed. Refresh and try again.', 409);
            await db.activityLog.create({ data: { ticketId, userId: managerId, action: 'Ticket assigned to ' + tech.name } });
            await NotificationService.create(technicianId, 'You have been assigned to Ticket #' + ticketId, db);
            await NotificationService.create(ticket.tenantId, 'A technician has been assigned to your ticket.', db);
            return db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        });
    },

    updateStatus: async (ticketId: string, newStatus: Status, technicianId: string) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            if (ticket.assignedToId !== technicianId) throw new AppError('You are not assigned to this ticket', 403);
            const previous = newStatus === 'IN_PROGRESS' ? 'ASSIGNED' : newStatus === 'DONE' ? 'IN_PROGRESS' : null;
            if (!previous) throw new AppError('Invalid status', 400);
            if (ticket.status === 'DONE' || ticket.status === newStatus) {
                throw new AppError('Ticket status already changed. Refresh and try again.', 409);
            }
            if (ticket.status !== previous) throw new AppError('Invalid status transition', 400);
            const result = await db.ticket.updateMany({
                where: { id: ticketId, status: previous, assignedToId: technicianId },
                data: { status: newStatus },
            });
            if (result.count !== 1) throw new AppError('Ticket status changed during this request. Refresh and try again.', 409);
            await db.activityLog.create({ data: {
                ticketId, userId: technicianId, action: 'Status changed from ' + previous + ' to ' + newStatus,
            } });
            await NotificationService.create(ticket.tenantId, 'Your ticket status changed to ' + newStatus, db);
            if (newStatus === 'DONE') await NotificationService.createForAdmins('Ticket #' + ticketId + ' marked as DONE.', db);
            return db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        });
    },

    addNote: async (ticketId: string, userId: string, note: string) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            // Updating the row serializes notes with completion without adding a new lock table.
            const result = await db.ticket.updateMany({
                where: { id: ticketId, status: { not: 'DONE' } }, data: { updatedAt: new Date() },
            });
            if (result.count !== 1) throw new AppError('Cannot add notes to a completed ticket', 400);
            return db.activityLog.create({ data: { ticketId, userId, action: 'Note added: ' + note } });
        });
    },
};
