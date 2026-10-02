import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { AccountService } from '@/lib/services/AccountService';
import { resourceId } from '@/lib/services/PropertyService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) { try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user; return successResponse(await AccountService.revoke(user.userId, resourceId.parse((await context.params).id))); } catch (error) { return handleApiError(error); } }
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) { try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user; return successResponse(await AccountService.renew(user.userId, resourceId.parse((await context.params).id))); } catch (error) { return handleApiError(error); } }
