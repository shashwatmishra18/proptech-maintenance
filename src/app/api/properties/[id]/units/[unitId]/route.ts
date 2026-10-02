import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { PropertyService, unitInput, resourceId } from '@/lib/services/PropertyService';
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; unitId: string }> }) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        const params = await context.params;
        return successResponse(await PropertyService.saveUnit(user.userId, resourceId.parse(params.id), unitInput.parse(await req.json()), resourceId.parse(params.unitId)));
    } catch (error) { return handleApiError(error); }
}
