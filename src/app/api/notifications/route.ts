import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';

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
    } catch (error: any) {
        return errorResponse('Failed to fetch notifications', 500);
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        await prisma.notification.updateMany({
            where: { userId: payload.userId, read: false },
            data: { read: true }
        });

        return successResponse({ message: 'Marked as read' });
    } catch (error: any) {
        return errorResponse('Failed to update notifications', 500);
    }
}
