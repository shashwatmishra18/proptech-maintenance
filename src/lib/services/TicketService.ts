import { prisma } from '../prisma';
import { AppError } from '../errors/api-response';
import { NotificationService } from './NotificationService';
import { Priority, Status, Ticket } from '@prisma/client';
import { escapeHtml } from '../utils';

export const TicketService = {
    getAllForUser: async (user: { userId: string, role: string }, status?: Status) => {
        let where: any = {};
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

        return prisma.ticket.findMany({
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
    },

    create: async (data: { title: string; description: string; priority: Priority; tenantId: string }, imageUrls: string[]) => {
        if (!data.title || !data.description) {
            throw new AppError('Title and description are required', 400);
        }

        const ticket = await prisma.ticket.create({
            data: {
                title: escapeHtml(data.title),
                description: escapeHtml(data.description),
                priority: data.priority,
                tenantId: data.tenantId,
                images: {
                    create: imageUrls.map(url => ({ imageUrl: url }))
                },
                activityLogs: {
                    create: {
                        userId: data.tenantId,
                        action: 'Ticket created',
                    }
                }
            },
        });

        // Notify managers
        await NotificationService.createForAdmins(`New ticket created: ${ticket.title}`);

        return ticket;
    },

    assign: async (ticketId: string, technicianId: string, managerId: string) => {
        // strict check
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) throw new AppError('Ticket not found', 404);

        if (ticket.status !== 'OPEN') {
            throw new AppError(`Cannot assign ticket in ${ticket.status} status. Must be OPEN.`, 400);
        }

        if (ticket.assignedToId) {
            throw new AppError('Ticket is already assigned.', 400);
        }

        const techUser = await prisma.user.findUnique({ where: { id: technicianId, role: 'TECHNICIAN' } });
        if (!techUser) {
            throw new AppError('Invalid technician ID or user is not a technician.', 400);
        }

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                status: 'ASSIGNED',
                assignedToId: technicianId,
                activityLogs: {
                    create: {
                        userId: managerId,
                        action: `Ticket assigned to ${techUser.name}`,
                    }
                }
            }
        });

        await NotificationService.create(technicianId, `You have been assigned to Ticket #${updated.id}`);
        await NotificationService.create(ticket.tenantId, `A technician has been assigned to your ticket.`);

        return updated;
    },

    updateStatus: async (ticketId: string, newStatus: Status, technicianId: string) => {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) throw new AppError('Ticket not found', 404);

        if (ticket.assignedToId !== technicianId) {
            throw new AppError('You are not assigned to this ticket', 403);
        }

        // STRICT transition checks
        if (ticket.status === 'ASSIGNED' && newStatus !== 'IN_PROGRESS') {
            throw new AppError('Invalid status transition. From ASSIGNED, you can only move to IN_PROGRESS.', 400);
        }
        if (ticket.status === 'IN_PROGRESS' && newStatus !== 'DONE') {
            throw new AppError('Invalid status transition. From IN_PROGRESS, you can only move to DONE.', 400);
        }
        if (ticket.status === 'DONE') {
            throw new AppError('Ticket is already DONE and cannot be updated.', 400);
        }

        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                status: newStatus,
                activityLogs: {
                    create: {
                        userId: technicianId,
                        action: `Status changed from ${ticket.status} to ${newStatus}`,
                    }
                }
            }
        });

        // Notifications
        await NotificationService.create(ticket.tenantId, `Your ticket status changed to ${newStatus}`);

        if (newStatus === 'DONE') {
            await NotificationService.createForAdmins(`Ticket #${ticket.id} marked as DONE.`);
        }

        return updated;
    },

    addNote: async (ticketId: string, userId: string, note: string) => {
        const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
        if (!ticket) throw new AppError('Ticket not found', 404);

        if (ticket.status === 'DONE') {
            throw new AppError('Cannot add notes to a completed ticket', 400);
        }

        return prisma.activityLog.create({
            data: {
                ticketId,
                userId,
                action: `Note added: ${escapeHtml(note)}`,
            }
        });
    }
};
