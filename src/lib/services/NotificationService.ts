import { prisma } from '../prisma';
import type { Prisma } from '@prisma/client';

export const NotificationService = {
    create: async (userId: string, message: string, db: Prisma.TransactionClient = prisma) => {
        return db.notification.create({
            data: {
                userId,
                message,
            },
        });
    },

    createForAdmins: async (message: string, db: Prisma.TransactionClient = prisma) => {
        const managers = await db.user.findMany({
            where: { role: 'MANAGER' },
            select: { id: true },
        });

        if (managers.length > 0) {
            await db.notification.createMany({
                data: managers.map((manager) => ({
                    userId: manager.id,
                    message,
                })),
            });
        }
    },

    getUnreadCount: async (userId: string) => {
        return prisma.notification.count({
            where: { userId, read: false },
        });
    },

    markAsRead: async (userId: string, ids: string[]) => {
        return prisma.notification.updateMany({
            where: { userId, id: { in: ids }, read: false },
            data: { read: true },
        });
    },
};
