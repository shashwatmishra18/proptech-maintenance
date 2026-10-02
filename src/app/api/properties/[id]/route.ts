import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { PropertyService, propertyInput, resourceId } from '@/lib/services/PropertyService';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, context: Context) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.detail(user.userId, resourceId.parse((await context.params).id)));
    } catch (error) { return handleApiError(error); }
}
export async function PATCH(req: NextRequest, context: Context) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.edit(user.userId, resourceId.parse((await context.params).id), propertyInput.parse(await req.json())));
    } catch (error) { return handleApiError(error); }
}
