import { z } from 'zod';
import { Priority, Status, type Prisma } from '@prisma/client';
import { AppError } from './errors/api-response';

const positiveInteger = (maximum: number, fallback: number) => z.string().regex(/^[1-9]\d*$/, 'Use a positive integer').transform(Number).pipe(z.number().int().max(maximum)).optional().default(fallback);
export const ticketQuerySchema = z.object({
    q: z.string().trim().max(120).optional().default(''),
    status: z.enum(Status).optional(), priority: z.enum(Priority).optional(),
    propertyId: z.string().uuid().optional(), unitId: z.string().uuid().optional(), technicianId: z.string().uuid().optional(),
    sort: z.enum(['newest', 'oldest', 'priority', 'updated']).optional().default('newest'),
    page: positiveInteger(10000, 1), pageSize: positiveInteger(50, 12),
}).strict();
export type TicketQuery = z.infer<typeof ticketQuerySchema>;
export type TicketActor = { userId: string; role: string };
export function parseTicketQuery(params: URLSearchParams, role: string): TicketQuery {
    const values: Record<string, string> = {};
    for (const [key, value] of params) {
        if (Object.hasOwn(values, key)) throw new AppError('Repeated query parameter: ' + key, 400);
        values[key] = value;
    }
    const query = ticketQuerySchema.parse(values);
    if ((role === 'TENANT' && query.propertyId) || (role !== 'MANAGER' && (query.unitId || query.technicianId))) throw new AppError('This filter is not available for your role', 400);
    return query;
}
export function ticketScope(user: TicketActor): Prisma.TicketWhereInput {
    if (user.role === 'TENANT') return { tenantId: user.userId };
    if (user.role === 'TECHNICIAN') return { assignedToId: user.userId };
    if (user.role === 'MANAGER') return { property: { managerId: user.userId } };
    throw new AppError('Forbidden', 403);
}
export function ticketWhere(user: TicketActor, query: TicketQuery): Prisma.TicketWhereInput {
    const where: Prisma.TicketWhereInput = { ...ticketScope(user) };
    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.unitId) where.unitId = query.unitId;
    if (query.technicianId) where.assignedToId = query.technicianId;
    if (query.q) {
        const contains = query.q.replace(/[\\%_]/g, value => '\\' + value);
        where.OR = [{ title: { contains, mode: 'insensitive' } }, { description: { contains, mode: 'insensitive' } }, { property: { name: { contains, mode: 'insensitive' } } }, { unit: { identifier: { contains, mode: 'insensitive' } } }];
    }
    return where;
}
export function ticketOrder(sort: TicketQuery['sort']): Prisma.TicketOrderByWithRelationInput[] {
    if (sort === 'priority') return [{ priority: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }];
    return [{ [sort === 'updated' ? 'updatedAt' : 'createdAt']: sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }];
}
