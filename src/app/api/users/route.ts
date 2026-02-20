import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse, successResponse } from '@/lib/errors/api-response';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const role = searchParams.get('role') as any;

        if (!role) return errorResponse('Role parameter required', 400);

        const users = await prisma.user.findMany({
            where: { role },
            select: { id: true, name: true, email: true, role: true }
        });

        return successResponse(users);
    } catch (error: any) {
        return errorResponse('Failed to fetch users', 500);
    }
}
