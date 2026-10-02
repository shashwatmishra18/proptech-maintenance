import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, authorizeTicketAccess } from '@/lib/roles';
import { errorResponse, handleApiError, successResponse } from '@/lib/errors/api-response';
import { TicketService } from '@/lib/services/TicketService';

const noteSchema = z.object({ note: z.string().min(1).max(1000), expectedVersion: z.number().int().min(0).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;
        const { id } = await params;

        const body = await req.json();
        const data = noteSchema.parse(body);

        const ticket = await prisma.ticket.findUnique({ where: { id: id }, include: { property: { select: { managerId: true } } } });
        if (!ticket) return errorResponse('Ticket not found', 404);

        if (!authorizeTicketAccess(ticket, payload)) {
            return errorResponse(payload.role === 'MANAGER' ? 'Ticket not found' : 'Forbidden. Access denied.', payload.role === 'MANAGER' ? 404 : 403);
        }

        const log = await TicketService.addNote(id, payload.userId, data.note, payload, data.expectedVersion);

        return successResponse(log, 201);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}
