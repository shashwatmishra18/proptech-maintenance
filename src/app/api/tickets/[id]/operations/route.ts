import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
import { resourceId } from '@/lib/services/PropertyService';
import { TicketOperations, operationInput } from '@/lib/services/TicketOperations';
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await requireRole(req, ['TENANT', 'MANAGER']);
        if (user instanceof Response) return user;
        const input = operationInput.parse(await req.json());
        return successResponse(await TicketOperations.apply(resourceId.parse((await context.params).id), user, input));
    } catch (error) { return handleApiError(error); }
}
