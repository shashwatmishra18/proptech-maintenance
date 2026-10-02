import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AccountService, tokenInput, completeInput } from '@/lib/services/AccountService';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function PUT(req: NextRequest) { try { const input = z.object({ token: tokenInput }).strict().parse(await req.json()); return successResponse(await AccountService.context(input.token, 'RESET')); } catch (error) { return handleApiError(error); } }
export async function POST(req: NextRequest) { try { return successResponse(await AccountService.complete(completeInput.parse(await req.json()), 'RESET')); } catch (error) { return handleApiError(error); } }
