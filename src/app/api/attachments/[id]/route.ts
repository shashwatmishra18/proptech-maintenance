import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, authorizeTicketAccess } from '@/lib/roles';
import { errorResponse } from '@/lib/errors/api-response';
import { readAttachment } from '@/lib/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await requireAuth(req);
    if (session instanceof Response) return session;
    const { id } = await params;
    const image = await prisma.ticketImage.findUnique({
        where: { id: id },
        include: { ticket: { select: { tenantId: true, assignedToId: true } } },
    });
    if (!image || !authorizeTicketAccess(image.ticket, session)) return errorResponse('Attachment not found', 404);
    try {
        const { bytes, type } = await readAttachment(image.imageUrl);
        return new NextResponse(new Uint8Array(bytes), { headers: {
            'Content-Type': type,
            'Content-Disposition': 'inline',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
        } });
    } catch {
        return errorResponse('Attachment not found', 404);
    }
}
