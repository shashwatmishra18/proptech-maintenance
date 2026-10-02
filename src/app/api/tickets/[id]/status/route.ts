import { NextRequest } from 'next/server';
import { z } from 'zod';
import { TicketService } from '@/lib/services/TicketService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { requireRole } from '@/lib/roles';

const updateStatusSchema = z.object({
    status: z.enum(['IN_PROGRESS', 'DONE']),
});

const assignSchema = z.object({
    technicianId: z.string().uuid(),
});

// Manager: Assign Technician
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const payload = await requireRole(req, ['MANAGER']);
        if (payload instanceof Response) return payload;
        const { id } = await params;

        const body = await req.json();
        const data = assignSchema.parse(body);

        const ticket = await TicketService.assign(id, data.technicianId, payload.userId);
        return successResponse(ticket);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}

// Technician: Update Status
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const payload = await requireRole(req, ['TECHNICIAN']);
        if (payload instanceof Response) return payload;
        const { id } = await params;

        const body = await req.json();
        const data = updateStatusSchema.parse(body);

        const ticket = await TicketService.updateStatus(id, data.status, payload.userId);
        return successResponse(ticket);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}
