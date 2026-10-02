import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { PropertyService, propertyInput } from '@/lib/services/PropertyService';
export async function GET(req: NextRequest) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.list(user.userId));
    } catch (error) { return handleApiError(error); }
}
export async function POST(req: NextRequest) {
    try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user;
        return successResponse(await PropertyService.create(user.userId, propertyInput.parse(await req.json())), 201);
    } catch (error) { return handleApiError(error); }
}
