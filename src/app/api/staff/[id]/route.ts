import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { AccountService, statusInput } from '@/lib/services/AccountService';
import { resourceId } from '@/lib/services/PropertyService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) { try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user; return successResponse(await AccountService.status(user.userId, resourceId.parse((await context.params).id), statusInput.parse(await req.json()))); } catch (error) { return handleApiError(error); } }
