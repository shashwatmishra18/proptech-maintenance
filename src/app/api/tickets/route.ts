import { NextRequest } from 'next/server';
import { z } from 'zod';
import { TicketService } from '@/lib/services/TicketService';
import { AppError, errorResponse, successResponse } from '@/lib/errors/api-response';
import { requireAuth, requireRole } from '@/lib/roles';
import { prisma } from '@/lib/prisma';

const createTicketSchema = z.object({
    title: z.string().min(5).max(100),
    description: z.string().min(10).max(2000),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional().default('MEDIUM'),
    status: z.any().optional(),
    assignedToId: z.any().optional(),
    imageUrls: z.array(z.string().url().or(z.string().startsWith('/uploads/'))).max(5).default([]),
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
                priority: 'MEDIUM', // TENANT cannot override priority directly
                tenantId: payload.userId
            },
            data.imageUrls
        );

        return successResponse(ticket, 201);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse('Invalid input', 400);
        if (error instanceof AppError) return errorResponse(error.message, error.statusCode);
        return errorResponse(error.message, 500);
    }
}

export async function GET(req: NextRequest) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;

        const { searchParams } = new URL(req.url);
        const status = searchParams.get('status') as any;

        const tickets = await TicketService.getAllForUser(payload, status);

        return successResponse(tickets);
    } catch (error: any) {
        return errorResponse('Failed to fetch tickets', 500);
    }
}
