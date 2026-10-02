import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse, successResponse } from '@/lib/errors/api-response';
import { requireRole } from '@/lib/roles';

export async function GET(req: NextRequest) {
    try {
        const session = await requireRole(req, ['MANAGER']);
        if (session instanceof Response) return session;
        const { searchParams } = new URL(req.url);
        const role = searchParams.get('role');

        if (role !== 'TECHNICIAN') return errorResponse('Only technician lookup is supported', 400);

        const users = await prisma.user.findMany({
            where: { role, active: true },
            select: { id: true, name: true }
        });

        return successResponse(users);
    } catch {
        return errorResponse('Failed to fetch users', 500);
    }
}
