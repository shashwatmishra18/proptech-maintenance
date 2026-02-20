import { NextResponse } from 'next/server';

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
    return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(error: string, status = 400) {
    return NextResponse.json({ success: false, error }, { status });
}

export class AppError extends Error {
    public statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}
