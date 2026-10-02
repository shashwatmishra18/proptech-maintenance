import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AccountService } from '@/lib/services/AccountService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
const input = z.object({ email: z.string().trim().email().max(254) }).strict();
export async function POST(req: NextRequest) { try { return successResponse(await AccountService.requestReset(input.parse(await req.json()).email)); } catch (error) { return handleApiError(error); } }
