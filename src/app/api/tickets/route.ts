import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Priority, Status } from '@prisma/client';
import { TicketService } from '@/lib/services/TicketService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { requireAuth, requireRole } from '@/lib/roles';

const createTicketSchema = z.object({
    title: z.string().min(5).max(100),
    description: z.string().min(10).max(2000),
    priority: z.enum(Priority).optional().default('MEDIUM'),
    status: z.any().optional(),
    assignedToId: z.any().optional(),
    propertyId: z.never().optional(),
    unitId: z.never().optional(),
    imageUrls: z.array(z.string().startsWith('/api/attachments/files/')).max(5).default([]),
});

export async function POST(req: NextRequest) {
    try {
        const payload = await requireRole(req, ['TENANT']);
        if (payload instanceof Response) return payload;

        const body = await req.json();
        const data = createTicketSchema.parse(body);

        const ticket = await TicketService.create(
            {
                title: data.title,
                description: data.description,
                priority: data.priority,
                tenantId: payload.userId
            },
            data.imageUrls
        );

        return successResponse(ticket, 201);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}

export async function GET(req: NextRequest) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const { searchParams } = new URL(req.url);
        const status = z.enum(Status).optional()
            .parse(searchParams.get('status') ?? undefined);

        const tickets = await TicketService.getAllForUser(payload, status);

        return successResponse(tickets);
    } catch (error: unknown) {
        return handleApiError(error);
    }
}
