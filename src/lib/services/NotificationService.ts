import { prisma } from '../prisma';

export const NotificationService = {
    create: async (userId: string, message: string) => {
        return prisma.notification.create({
            data: {
                userId,
                message,
            },
        });
    },

    createForAdmins: async (message: string) => {
        const managers = await prisma.user.findMany({
            where: { role: 'MANAGER' },
            select: { id: true },
        });

        if (managers.length > 0) {
            await prisma.notification.createMany({
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

    markAsRead: async (userId: string) => {
        return prisma.notification.updateMany({
            where: { userId, read: false },
            data: { read: true },
        });
    },
};
