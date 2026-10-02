import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { locationSelect } from '@/lib/services/PropertyService';
export async function GET(req: NextRequest) {
    try { const user = await requireRole(req, ['TENANT']); if (user instanceof Response) return user;
        const tenant = await prisma.user.findUnique({ where: { id: user.userId }, select: { unit: { select: locationSelect } } });
        return successResponse({ unit: tenant?.unit ?? null });
    } catch (error) { return handleApiError(error); }
}
