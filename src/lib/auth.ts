import type { JWTPayload } from 'jose';
import { signToken, verifyToken } from './session';
export { signToken, verifyToken } from './session';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function setSessionCookie(payload: JWTPayload) {
    const token = await signToken(payload);
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    (await cookies()).set('session', token, { expires, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

export async function removeSessionCookie() {
    (await cookies()).set('session', '', { expires: new Date(0), maxAge: 0, path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

export async function getSession() {
    const session = (await cookies()).get('session')?.value;
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
