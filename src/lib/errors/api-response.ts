import { NextResponse } from 'next/server';
import { z } from 'zod';

export interface ApiError {
    success: false;
    error: string;
}

export interface ApiSuccess<T> {
    success: true;
    data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function successResponse<T>(data: T, status = 200) {
    return NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function errorResponse(error: string, status = 400) {
    return NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export class AppError extends Error {
    public statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}

export function handleApiError(error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return errorResponse('This identifier already exists in this property', 409);
    if (error instanceof AppError) return errorResponse(error.message, error.statusCode);
    if (error instanceof SyntaxError) return errorResponse('Invalid JSON body', 400);
    if (error instanceof z.ZodError) return errorResponse(error.issues[0]?.message ?? 'Invalid input', 400);
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
        return errorResponse('The ticket changed during this request. Refresh and try again.', 409);
    }
    console.error(JSON.stringify({ event: 'api_error', category: 'unexpected' }));
    return errorResponse('Internal Server Error', 500);
}
