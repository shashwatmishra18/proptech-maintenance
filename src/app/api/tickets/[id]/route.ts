import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const ticket = await prisma.ticket.findUnique({
            where: { id: params.id },
            include: {
                tenant: { select: { id: true, name: true, email: true } },
                assignedTo: { select: { id: true, name: true, email: true } },
                images: true,
                activityLogs: {
                    include: { user: { select: { name: true, role: true } } },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!ticket) return errorResponse('Ticket not found', 404);

        // Validation
        if (payload.role === 'TENANT' && ticket.tenantId !== payload.userId) {
            return errorResponse('Forbidden. Not your ticket.', 403);
        }
        if (payload.role === 'TECHNICIAN' && ticket.assignedToId !== payload.userId) {
            return errorResponse('Forbidden. Not assigned to you.', 403);
        }
        // MANAGER can view all

        return successResponse(ticket);
    } catch (error: any) {
        return errorResponse('Failed to fetch ticket details', 500);
    }
}
