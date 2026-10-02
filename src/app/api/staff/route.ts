import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { AccountService, inviteInput } from '@/lib/services/AccountService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function GET(req: NextRequest) { try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user; return successResponse(await AccountService.staff(user.userId)); } catch (error) { return handleApiError(error); } }
export async function POST(req: NextRequest) { try { const user = await requireRole(req, ['MANAGER']); if (user instanceof Response) return user; return successResponse(await AccountService.invite(user.userId, inviteInput.parse(await req.json())), 201); } catch (error) { return handleApiError(error); } }
