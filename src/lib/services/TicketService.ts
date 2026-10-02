import { lockStaff } from '../staff-lock';
import { prisma } from '../prisma';
import { authorizeTicketAccess } from '../roles';
import { AppError } from '../errors/api-response';
import { NotificationService } from './NotificationService';
import { Priority, Status, Prisma } from '@prisma/client';
import { ticketWhere, ticketOrder, ticketQuerySchema, type TicketQuery, type TicketActor } from '../ticket-query';
import { attachmentUrl, validateOwnedUploads, lockUploader, cleanupUnattachedUploads } from '../attachments';

function checkVersion(current: number | undefined, expected?: number) {
    if (expected !== undefined && expected !== (current ?? 0)) throw new AppError('Ticket changed. Refresh and try again.', 409);
}
export const TicketService = {
    getAllForUser: async (user: TicketActor, query: TicketQuery = ticketQuerySchema.parse({})) => {
        const where = ticketWhere(user, query);
        return prisma.$transaction(async db => {
        const total = await db.ticket.count({ where });
        const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
        const page = Math.min(query.page, totalPages);
        const isTech = user.role === 'TECHNICIAN';

        const tickets = await db.ticket.findMany({
            where,
            select: {
                id: true,
                version: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                createdAt: true,
                updatedAt: true,
                property: { select: { id: true, name: true, address: true } },
                unit: { select: { id: true, identifier: true } },
                images: { select: { id: true, imageUrl: true } },
                tenant: {
                    select: isTech
                        ? { id: true, name: true }
                        : { id: true, name: true, email: true }
                },
                assignedTo: { select: { id: true, name: true, email: true } },
            },
            orderBy: ticketOrder(query.sort), skip: (page - 1) * query.pageSize, take: query.pageSize
        });
        return { tickets: tickets.map(ticket => ({ ...ticket, images: ticket.images.map(image => ({ ...image, imageUrl: attachmentUrl(image.id) })) })), total, page, pageSize: query.pageSize, totalPages };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },

    create: async (data: { title: string; description: string; priority: Priority; tenantId: string }, imageUrls: string[]) => {
        if (!data.title || !data.description || !Object.values(Priority).includes(data.priority)) {
            throw new AppError('Invalid title, description or priority', 400);
        }
        try {
            return await prisma.$transaction(async db => {
                await lockUploader(db, data.tenantId);
                const tenant = await db.user.findUnique({ where: { id: data.tenantId }, include: { unit: { include: { property: true } } } });
                if (!tenant || tenant.role !== 'TENANT' || !tenant.unit) throw new AppError('Your manager must assign you to a unit before you can submit a maintenance request.', 409);
                if (imageUrls.length > 0) {
                    await validateOwnedUploads(imageUrls, data.tenantId);
                    if (await db.ticketImage.findFirst({ where: { imageUrl: { in: imageUrls } }, select: { id: true } })) {
                        throw new AppError('An attachment is already linked to a ticket', 409);
                    }
                }
                const ticket = await db.ticket.create({ data: {
                    ...data,
                    propertyId: tenant.unit.propertyId,
                    unitId: tenant.unit.id,
                    images: { create: imageUrls.map(imageUrl => ({ imageUrl })) },
                    activityLogs: { create: { userId: data.tenantId, action: 'Ticket created' } },
                } });
                await NotificationService.create(tenant.unit.property.managerId, 'New ticket at ' + tenant.unit.property.name + ' / ' + tenant.unit.identifier + ': ' + ticket.title, db, ticket.id);
                return ticket;
            });
        } catch (error) {
            try { await cleanupUnattachedUploads(imageUrls, data.tenantId); }
            catch { console.warn('Unlinked upload cleanup could not complete; files were retained for safety.'); }
            throw error;
        }
    },

    assign: async (ticketId: string, technicianId: string, managerId: string, expectedVersion?: number) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { property: true } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            if (ticket.property?.managerId !== managerId) throw new AppError('Ticket not found', 404);
            checkVersion(ticket.version, expectedVersion);
            if (ticket.status !== 'OPEN' || ticket.assignedToId) {
                throw new AppError('This ticket is no longer open and unassigned. Refresh and try again.', 409);
            }
            await lockStaff(db, technicianId);
            const tech = await db.user.findUnique({ where: { id: technicianId, role: 'TECHNICIAN', active: true } });
            if (!tech) throw new AppError('Invalid technician ID or user is not a technician', 400);
            const result = await db.ticket.updateMany({
                where: { id: ticketId, status: 'OPEN', assignedToId: null, version: ticket.version ?? 0 },
                data: { status: 'ASSIGNED', assignedToId: technicianId, version: { increment: 1 } },
            });
            if (result.count !== 1) throw new AppError('Ticket assignment changed. Refresh and try again.', 409);
            await db.activityLog.create({ data: { ticketId, userId: managerId, action: 'Ticket assigned to ' + tech.name } });
            await NotificationService.create(technicianId, 'Ticket assigned: ' + ticket.title, db, ticketId);
            await NotificationService.create(ticket.tenantId, 'A technician has been assigned: ' + ticket.title, db, ticketId);
            return db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        });
    },

    updateStatus: async (ticketId: string, newStatus: Status, technicianId: string, expectedVersion?: number) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { property: true } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            if (ticket.assignedToId !== technicianId) throw new AppError('You are not assigned to this ticket', 403);
            checkVersion(ticket.version, expectedVersion);
            const previous = newStatus === 'IN_PROGRESS' ? 'ASSIGNED' : newStatus === 'DONE' ? 'IN_PROGRESS' : null;
            if (!previous) throw new AppError('Invalid status', 400);
            if (ticket.status === 'DONE' || ticket.status === 'CANCELLED' || ticket.status === newStatus) {
                throw new AppError('Ticket status already changed. Refresh and try again.', 409);
            }
            if (ticket.status !== previous) throw new AppError('Invalid status transition', 400);
            const result = await db.ticket.updateMany({
                where: { id: ticketId, status: previous, assignedToId: technicianId, version: ticket.version ?? 0 },
                data: { status: newStatus, version: { increment: 1 } },
            });
            if (result.count !== 1) throw new AppError('Ticket status changed during this request. Refresh and try again.', 409);
            await db.activityLog.create({ data: {
                ticketId, userId: technicianId, action: 'Status changed from ' + previous + ' to ' + newStatus,
            } });
            await NotificationService.create(ticket.tenantId, (newStatus === 'DONE' ? 'Ticket completed: ' : 'Work started: ') + ticket.title, db, ticketId);
            if (newStatus === 'DONE' && ticket.property) await NotificationService.create(ticket.property.managerId, 'Ticket completed at ' + ticket.property.name + ': ' + ticket.title, db, ticketId);
            return db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
        });
    },

    addNote: async (ticketId: string, userId: string, note: string, actor?: TicketActor, expectedVersion?: number) => {
        return prisma.$transaction(async db => {
            const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { property: true } });
            if (!ticket) throw new AppError('Ticket not found', 404);
            if (actor && !authorizeTicketAccess(ticket, actor)) throw new AppError(actor.role === 'MANAGER' ? 'Ticket not found' : 'Forbidden', actor.role === 'MANAGER' ? 404 : 403);
            if (ticket.status === 'DONE' || ticket.status === 'CANCELLED') throw new AppError('Cannot add notes to a completed or cancelled ticket', 400);
            checkVersion(ticket.version, expectedVersion);
            // The version also serializes notes with reassignment and terminal transitions.
            const result = await db.ticket.updateMany({
                where: { id: ticketId, version: ticket.version ?? 0, assignedToId: ticket.assignedToId, status: { notIn: ['DONE', 'CANCELLED'] } }, data: { updatedAt: new Date(), version: { increment: 1 } },
            });
            if (result.count !== 1) throw new AppError('Ticket changed. Refresh and try again.', 409);
            return db.activityLog.create({ data: { ticketId, userId, action: 'Note added: ' + note } });
        });
    },
};
