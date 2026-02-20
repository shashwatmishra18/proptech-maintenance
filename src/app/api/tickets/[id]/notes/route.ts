import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';
import { TicketService } from '@/lib/services/TicketService';

const noteSchema = z.object({ note: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const body = await req.json();
        const data = noteSchema.parse(body);

        const log = await TicketService.addNote(params.id, payload.userId, data.note);

        return successResponse(log, 201);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse('Invalid input', 400);
        return errorResponse(error.message, 500);
    }
}
