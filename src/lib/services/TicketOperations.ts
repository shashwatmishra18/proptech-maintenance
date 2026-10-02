import { lockStaff } from '../staff-lock';
import { prisma } from '../prisma';
import { AppError } from '../errors/api-response';
import { NotificationService } from './NotificationService';
import type { TicketActor } from '../ticket-query';
import { z } from 'zod';

export const operationInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('reassign'), technicianId: z.string().uuid(), expectedVersion: z.number().int().min(0) }).strict(),
    z.object({ action: z.literal('cancel'), expectedVersion: z.number().int().min(0) }).strict(),
    z.object({ action: z.literal('reopen'), expectedVersion: z.number().int().min(0) }).strict(),
]);
export const TicketOperations = {
    apply: (id: string, actor: TicketActor, input: z.infer<typeof operationInput>) => prisma.$transaction(async db => {
        const ticket = await db.ticket.findUnique({ where: { id }, include: { property: true, assignedTo: { select: { name: true } } } });
        if (!ticket) throw new AppError('Ticket not found', 404);
        if (actor.role === 'MANAGER') {
            if (ticket.property?.managerId !== actor.userId) throw new AppError('Ticket not found', 404);
        } else if (actor.role === 'TENANT' && input.action === 'cancel') {
            if (ticket.tenantId !== actor.userId) throw new AppError('Ticket not found', 404);
        } else throw new AppError('Forbidden', 403);
        if (ticket.version !== input.expectedVersion) throw new AppError('Ticket changed. Refresh and try again.', 409);

        let status = ticket.status;
        let assignedToId = ticket.assignedToId;
        let action: string;
        const recipients = new Set([ticket.tenantId, ticket.property?.managerId, ticket.assignedToId].filter((value): value is string => !!value));
        if (input.action === 'reassign') {
            if (!['ASSIGNED', 'IN_PROGRESS'].includes(ticket.status)) throw new AppError('Reassignment requires an assigned or in-progress ticket', 400);
            await lockStaff(db, input.technicianId);
            const tech = await db.user.findUnique({ where: { id: input.technicianId, role: 'TECHNICIAN', active: true }, select: { id: true, name: true } });
            if (!tech) throw new AppError('Invalid technician', 400);
            if (tech.id === ticket.assignedToId) throw new AppError('Choose a different technician', 400);
            assignedToId = tech.id; status = 'ASSIGNED'; recipients.add(tech.id);
            action = 'REASSIGNED from ' + (ticket.assignedTo?.name ?? 'previous technician') + ' to ' + tech.name + (ticket.status === 'IN_PROGRESS' ? '; work returned to ASSIGNED' : '');
        } else if (input.action === 'cancel') {
            if (!['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(ticket.status) || (actor.role === 'TENANT' && ticket.status !== 'OPEN')) throw new AppError('This ticket cannot be cancelled in its current state', 400);
            status = 'CANCELLED'; action = 'CANCELLED from ' + ticket.status;
        } else {
            if (ticket.status !== 'DONE') throw new AppError('Only completed tickets can be reopened', 400);
            status = 'OPEN'; assignedToId = null; action = 'REOPENED from DONE to OPEN; technician assignment cleared';
        }
        const result = await db.ticket.updateMany({ where: { id, version: input.expectedVersion, status: ticket.status, assignedToId: ticket.assignedToId }, data: { status, assignedToId, version: { increment: 1 } } });
        if (result.count !== 1) throw new AppError('Ticket changed during this request. Refresh and try again.', 409);
        await db.activityLog.create({ data: { ticketId: id, userId: actor.userId, action } });
        const message = action + ': ' + ticket.title + (ticket.property ? ' at ' + ticket.property.name : '');
        recipients.delete(actor.userId);
        for (const recipient of recipients) await NotificationService.create(recipient, message, db, ticket.id);
        return db.ticket.findUniqueOrThrow({ where: { id } });
    }),
};
