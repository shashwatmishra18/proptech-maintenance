import { NextRequest } from 'next/server';
import { z } from 'zod';
import { TicketService } from '@/lib/services/TicketService';
import { AppError, errorResponse, successResponse } from '@/lib/errors/api-response';
import { requireRole } from '@/lib/roles';
import { prisma } from '@/lib/prisma';

const updateStatusSchema = z.object({
    status: z.enum(['IN_PROGRESS', 'DONE']),
});

const assignSchema = z.object({
    technicianId: z.string().uuid(),
});

// Manager: Assign Technician
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const payload = await requireRole(req, ['MANAGER']);
        if (payload instanceof Response) return payload;

        const body = await req.json();
        const data = assignSchema.parse(body);

        const ticket = await TicketService.assign(params.id, data.technicianId, payload.userId);
        return successResponse(ticket);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse('Invalid input', 400);
        if (error instanceof AppError) return errorResponse(error.message, error.statusCode);
        return errorResponse(error.message, 500);
    }
}

// Technician: Update Status
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const payload = await requireRole(req, ['TECHNICIAN']);
        if (payload instanceof Response) return payload;

        const body = await req.json();
        const data = updateStatusSchema.parse(body);

        const ticket = await TicketService.updateStatus(params.id, data.status, payload.userId);
        return successResponse(ticket);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse('Invalid input', 400);
        if (error instanceof AppError) return errorResponse(error.message, error.statusCode);
        return errorResponse(error.message, 500);
    }
}
