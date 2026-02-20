import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AuthService } from '@/lib/services/AuthService';
import { AppError, errorResponse, successResponse } from '@/lib/errors/api-response';

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const data = loginSchema.parse(body);

        const user = await AuthService.login(data.email, data.password);
        return successResponse(user);

    } catch (error: any) {
        if (error instanceof z.ZodError) {
            return errorResponse('Invalid input format', 400);
        }
        if (error instanceof AppError) {
            return errorResponse(error.message, error.statusCode);
        }
        return errorResponse('Internal Server Error', 500);
    }
}
