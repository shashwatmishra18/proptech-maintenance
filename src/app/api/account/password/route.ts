import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/roles';
import { AccountService, changeInput } from '@/lib/services/AccountService';
import { removeSessionCookie } from '@/lib/auth';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function POST(req: NextRequest) { try { const user = await requireAuth(req); if (user instanceof Response) return user; const result = await AccountService.changePassword(user.userId, Number(user.authVersion ?? 0), changeInput.parse(await req.json())); await removeSessionCookie(); return successResponse(result); } catch (error) { return handleApiError(error); } }
