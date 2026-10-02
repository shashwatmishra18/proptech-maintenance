import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';

export async function GET(req: NextRequest) {
    try {
        const payload = await requireRole(req, ['MANAGER', 'TECHNICIAN', 'TENANT']);
        if (payload instanceof Response) return payload;

        if (payload.role === 'MANAGER') {
            const scope = { property: { managerId: payload.userId } };
            const [total, open, inProgress, done, highPriority] = await Promise.all([
                prisma.ticket.count({ where: scope }),
                prisma.ticket.count({ where: { ...scope, status: 'OPEN' } }),
                prisma.ticket.count({ where: { ...scope, status: 'IN_PROGRESS' } }),
                prisma.ticket.count({ where: { ...scope, status: 'DONE' } }),
                prisma.ticket.count({ where: { ...scope, priority: 'HIGH' } }),
            ]);

            return successResponse({ total, open, inProgress, done, highPriority });
        }

        if (payload.role === 'TECHNICIAN') {
            const [assigned, inProgress, done] = await Promise.all([
                prisma.ticket.count({ where: { assignedToId: payload.userId, status: 'ASSIGNED' } }),
                prisma.ticket.count({ where: { assignedToId: payload.userId, status: 'IN_PROGRESS' } }),
                prisma.ticket.count({ where: { assignedToId: payload.userId, status: 'DONE' } }),
            ]);
            return successResponse({ assigned, inProgress, done });
        }

        if (payload.role === 'TENANT') {
            const [totalSubmitted, pending] = await Promise.all([
                prisma.ticket.count({ where: { tenantId: payload.userId } }),
                prisma.ticket.count({ where: { tenantId: payload.userId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } } }),
            ]);
            return successResponse({ totalSubmitted, pending });
        }

        return errorResponse('Invalid role', 400);

    } catch {
        return errorResponse('Failed to fetch metrics', 500);
    }
}
