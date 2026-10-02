import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getSessionKey, verifyToken } from '@/lib/session';

export async function middleware(req: NextRequest) {
    const path = req.nextUrl.pathname;

    // Legacy files remain on disk, but may only be served by the authorized API.
    if (path === '/uploads' || path.startsWith('/uploads/') || path === '/_next/image') {
        return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    const isApiRoute = path.startsWith('/api/');
    try { getSessionKey(); } catch {
        return NextResponse.json({ success: false, error: 'JWT_SECRET must be configured with at least 32 characters' }, { status: 503 });
    }

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
        payload = await verifyToken(session);
        if (!payload) throw new Error('Invalid session');
    } catch {
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
        '/uploads/:path*',
        '/_next/image',
        '/api/(.*)'
    ],
};
