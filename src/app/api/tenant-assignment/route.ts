import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { PropertyService, assignmentInput } from '@/lib/services/PropertyService';
export async function GET(req: NextRequest) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.lookupTenant(user.userId, z.string().email().parse(new URL(req.url).searchParams.get('email'))));
    } catch (error) { return handleApiError(error); }
}
export async function PATCH(req: NextRequest) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.assignTenant(user.userId, assignmentInput.parse(await req.json())));
    } catch (error) { return handleApiError(error); }
}
