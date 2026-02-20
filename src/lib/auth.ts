import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const secretKey = process.env.JWT_SECRET || 'super-secret-key-change-me-in-production';
const key = new TextEncoder().encode(secretKey);

export async function signToken(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(key);
}

export async function verifyToken(token: string) {
    try {
        const { payload } = await jwtVerify(token, key, {
            algorithms: ['HS256'],
        });
        return payload;
    } catch (error) {
        return null;
    }
}

export async function setSessionCookie(payload: any) {
    const token = await signToken(payload);
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    cookies().set('session', token, { expires, httpOnly: true, secure: process.env.NODE_ENV === 'production' });
}

export function removeSessionCookie() {
    cookies().set('session', '', { expires: new Date(0) });
}

export async function getSession() {
    const session = cookies().get('session')?.value;
    if (!session) return null;
    return await verifyToken(session);
}

export async function middleware(request: NextRequest) {
    const session = request.cookies.get('session')?.value;

    if (!session) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await verifyToken(session);

    if (!payload) {
        return NextResponse.json({ success: false, error: 'Invalid Token' }, { status: 401 });
    }

    return payload;
}
