import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { requireAuth } from '@/lib/roles';
import { errorResponse, successResponse, handleApiError } from '@/lib/errors/api-response';

export async function GET(req: NextRequest) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const notifications = await prisma.notification.findMany({
            where: { userId: payload.userId },
            orderBy: { createdAt: 'desc' },
            take: 10
        });

        const unreadCount = await prisma.notification.count({
            where: { userId: payload.userId, read: false }
        });

        return successResponse({ notifications, unreadCount });
    } catch {
        return errorResponse('Failed to fetch notifications', 500);
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const { ids } = z.object({ ids: z.array(z.string().uuid()).max(10) }).parse(await req.json());
        const result = await prisma.$transaction(async db => {
            const updated = await db.notification.updateMany({
                where: { userId: payload.userId, id: { in: ids }, read: false }, data: { read: true },
            });
            const unreadCount = await db.notification.count({ where: { userId: payload.userId, read: false } });
            return { updated: updated.count, unreadCount };
        });
        return successResponse(result);
    } catch (error) {
        return handleApiError(error);
    }
}
