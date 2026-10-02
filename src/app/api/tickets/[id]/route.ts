import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, authorizeTicketAccess } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';
import { attachmentUrl } from '@/lib/attachments';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const payload = await requireAuth(req);
        if (payload instanceof Response) return payload;
        const { id } = await params;

        const isTech = payload.role === 'TECHNICIAN';

        const ticket = await prisma.ticket.findUnique({
            where: { id: id },
            include: {
                property: { select: { id: true, name: true, address: true, managerId: true } },
                unit: { select: { id: true, identifier: true } },
                tenant: {
                    select: isTech
                        ? { id: true, name: true }
                        : { id: true, name: true, email: true }
                },
                assignedTo: { select: { id: true, name: true, email: true } },
                images: true,
                activityLogs: {
                    include: { user: { select: { name: true, role: true } } },
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!ticket) return errorResponse('Ticket not found', 404);

        // Validation
        if (!authorizeTicketAccess(ticket, payload)) {
            return errorResponse(payload.role === 'MANAGER' ? 'Ticket not found' : 'Forbidden', payload.role === 'MANAGER' ? 404 : 403);
        }

        return successResponse({ ...ticket, images: ticket.images.map(image => ({ ...image, imageUrl: attachmentUrl(image.id) })) });
    } catch {
        return errorResponse('Failed to fetch ticket details', 500);
    }
}
