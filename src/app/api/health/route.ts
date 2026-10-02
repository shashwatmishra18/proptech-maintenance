import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionKey } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Public readiness probe: reveal neither configuration nor database details.
export async function GET() {
    const headers = { 'Cache-Control': 'no-store' };
    try {
        getSessionKey();
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({ status: 'ready' }, { headers });
    } catch {
        return NextResponse.json({ status: 'unavailable' }, { status: 503, headers });
    }
}
