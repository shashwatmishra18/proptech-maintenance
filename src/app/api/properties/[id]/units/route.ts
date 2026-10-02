import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { PropertyService, unitInput, resourceId } from '@/lib/services/PropertyService';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.saveUnit(user.userId, resourceId.parse((await context.params).id), unitInput.parse(await req.json())), 201);
    } catch (error) { return handleApiError(error); }
}
