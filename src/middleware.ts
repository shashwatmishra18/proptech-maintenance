import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.JWT_SECRET || 'super-secret-key-change-me-in-production';
const key = new TextEncoder().encode(secretKey);

export async function middleware(req: NextRequest) {
    const path = req.nextUrl.pathname;

    const isApiRoute = path.startsWith('/api/');

    // Allow public API auth routes
    if (path.startsWith('/api/auth/')) {
        return NextResponse.next();
    }

    const session = req.cookies.get('session')?.value;

    if (!session) {
        if (isApiRoute) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/login', req.url));
    }

    let payload;
    try {
        const verified = await jwtVerify(session, key, { algorithms: ['HS256'] });
        payload = verified.payload as { userId: string; role: string; exp: number };
    } catch (error) {
        const response = isApiRoute
            ? NextResponse.json({ success: false, error: 'Invalid Token' }, { status: 401 })
            : NextResponse.redirect(new URL('/login', req.url));
        response.cookies.delete('session');
        return response;
    }

    const { role } = payload;

    // Route-Level Role Protection
    if (path.startsWith('/manager') && role !== 'MANAGER') {
        if (isApiRoute) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        return NextResponse.redirect(new URL('/login', req.url));
    }

    if (path.startsWith('/tech') && role !== 'TECHNICIAN') {
        if (isApiRoute) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        return NextResponse.redirect(new URL('/login', req.url));
    }

    if (path.startsWith('/dashboard') && role !== 'TENANT') {
        if (isApiRoute) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
        return NextResponse.redirect(new URL('/login', req.url));
    }

    // Add session hardening headers to prevent back-button caching
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');

    return response;
}

export const config = {
    matcher: [
        '/manager/:path*',
        '/tech/:path*',
        '/dashboard/:path*',
        '/tickets/:path*',
        '/api/(.*)'
    ],
};
