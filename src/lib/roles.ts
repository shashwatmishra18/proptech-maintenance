import { Role } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './auth';
import { errorResponse } from './errors/api-response';

export interface SessionPayload {
    userId: string;
    role: Role;
    exp: number;
}

export async function requireAuth(req: NextRequest) {
    const session = req.cookies.get('session')?.value;
    if (!session) return errorResponse('Unauthorized', 401);

    const payload = await verifyToken(session);
    if (!payload) return errorResponse('Invalid token', 401);

    return payload as unknown as SessionPayload;
}

export async function requireRole(req: NextRequest, roles: Role[]) {
    const payload = await requireAuth(req);
    if (payload instanceof NextResponse) return payload; // Error response

    if (!roles.includes(payload.role)) {
        return errorResponse('Forbidden', 403);
    }

    return payload;
}

export function authorizeTicketAccess(ticket: { tenantId: string; assignedToId: string | null }, user: SessionPayload): boolean {
    if (user.role === 'MANAGER') return true;
    if (user.role === 'TENANT' && ticket.tenantId === user.userId) return true;
    if (user.role === 'TECHNICIAN' && ticket.assignedToId === user.userId) return true;
    return false;
}
