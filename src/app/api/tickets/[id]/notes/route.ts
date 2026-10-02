import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, authorizeTicketAccess } from '@/lib/roles';
import { errorResponse, handleApiError, successResponse } from '@/lib/errors/api-response';
import { TicketService } from '@/lib/services/TicketService';

const noteSchema = z.object({ note: z.string().min(1).max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const body = await req.json();
        const data = noteSchema.parse(body);

        const ticket = await prisma.ticket.findUnique({ where: { id: params.id } });
        if (!ticket) return errorResponse('Ticket not found', 404);

        if (!authorizeTicketAccess(ticket, payload)) {
            return errorResponse('Forbidden. Access denied.', 403);
        }

        const log = await TicketService.addNote(params.id, payload.userId, data.note);

        return successResponse(log, 201);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}
