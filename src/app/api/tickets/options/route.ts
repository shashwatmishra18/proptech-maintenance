import { NextRequest } from 'next/server';
import { requireRole } from '@/lib/roles';
import { prisma } from '@/lib/prisma';
import { handleApiError, successResponse } from '@/lib/errors/api-response';
export async function GET(req: NextRequest) {
    try {
        const user = await requireRole(req, ['MANAGER', 'TECHNICIAN']);
        if (user instanceof Response) return user;
        const select = { id: true, name: true, units: { select: { id: true, identifier: true }, orderBy: { identifier: 'asc' as const } } };
        if (user.role === 'MANAGER') return successResponse({
            properties: await prisma.property.findMany({ where: { managerId: user.userId }, select, orderBy: { name: 'asc' } }),
            technicians: await prisma.user.findMany({ where: { role: 'TECHNICIAN', active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        });
        const tickets = await prisma.ticket.findMany({ where: { assignedToId: user.userId, propertyId: { not: null } }, distinct: ['propertyId'], select: { property: { select: { id: true, name: true } } } });
        return successResponse({ properties: tickets.flatMap(ticket => ticket.property ? [{ ...ticket.property, units: [] }] : []), technicians: [] });
    } catch (error) { return handleApiError(error); }
}
