import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/roles';
import { AccountService, profileInput } from '@/lib/services/AccountService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function GET(req: NextRequest) { try { const user = await requireAuth(req); if (user instanceof Response) return user; return successResponse(await AccountService.profile(user.userId)); } catch (error) { return handleApiError(error); } }
export async function PATCH(req: NextRequest) { try { const user = await requireAuth(req); if (user instanceof Response) return user; const input = profileInput.parse(await req.json()); return successResponse(await AccountService.updateProfile(user.userId, input.name)); } catch (error) { return handleApiError(error); } }
