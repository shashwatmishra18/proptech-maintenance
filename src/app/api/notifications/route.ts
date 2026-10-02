import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/roles';
import { notificationQuery, notificationRead, notificationTicketHref } from '@/lib/notification-query';
import { AppError, successResponse, handleApiError } from '@/lib/errors/api-response';
export async function GET(req: NextRequest) {
    try {
        const actor = await requireAuth(req); if (actor instanceof Response) return actor;
        const parameters: Record<string, string> = {};
        for (const [key, value] of req.nextUrl.searchParams) { if (key in parameters) throw new AppError('Repeated notification filter', 400); parameters[key] = value; }
        const input = notificationQuery.parse(parameters);
        const result = await prisma.$transaction(async db => {
            const where = { userId: actor.userId, ...(input.state === 'unread' ? { read: false } : {}) };
            const total = await db.notification.count({ where });
            const totalPages = Math.max(1, Math.ceil(total / input.pageSize)), page = Math.min(input.page, totalPages);
            const rows = await db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.pageSize, skip: (page - 1) * input.pageSize, select: { id: true, message: true, read: true, createdAt: true, ticket: { select: { id: true, tenantId: true, assignedToId: true, property: { select: { managerId: true } } } } } });
            const unreadCount = await db.notification.count({ where: { userId: actor.userId, read: false } });
            return { notifications: rows.map(({ ticket, ...row }) => ({ ...row, ticketHref: notificationTicketHref(ticket, actor) })), unreadCount, total, page, pageSize: input.pageSize, totalPages, snapshotAt: new Date().toISOString() };
        }, { isolationLevel: 'RepeatableRead' });
        return successResponse(result);
    } catch (error) { return handleApiError(error); }
}
export async function PATCH(req: NextRequest) {
    try {
        const actor = await requireAuth(req); if (actor instanceof Response) return actor;
        const input = notificationRead.parse(await req.json());
        if ('all' in input && new Date(input.before) > new Date()) throw new AppError('Invalid read cutoff', 400);
        const result = await prisma.$transaction(async db => {
            const updated = await db.notification.updateMany({ where: { userId: actor.userId, read: false, ...('ids' in input ? { id: { in: input.ids } } : { createdAt: { lte: new Date(input.before) } }) }, data: { read: true } });
            const unreadCount = await db.notification.count({ where: { userId: actor.userId, read: false } });
            return { updated: updated.count, unreadCount };
        });
        return successResponse(result);
    } catch (error) { return handleApiError(error); }
}
