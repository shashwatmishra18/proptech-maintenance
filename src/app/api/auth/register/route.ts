import { NextRequest } from 'next/server';
import { z } from 'zod';
import { AuthService } from '@/lib/services/AuthService';
import { AppError, errorResponse, successResponse } from '@/lib/errors/api-response';

const registerSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.literal('TENANT').optional(),
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const data = registerSchema.parse(body);

        const user = await AuthService.register(data.email, data.password, data.name);
        return successResponse(user, 201);

    } catch (error: unknown) {
        if (error instanceof z.ZodError) {
            return errorResponse('Invalid input format: ' + error.issues[0].message, 400);
        }
        if (error instanceof AppError) {
            return errorResponse(error.message, error.statusCode);
        }
        return errorResponse('Internal Server Error', 500);
    }
}
