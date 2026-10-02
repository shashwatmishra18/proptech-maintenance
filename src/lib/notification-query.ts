import { z } from 'zod';
import { authorizeTicketAccess } from './roles';
export const notificationQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10), state: z.enum(['all', 'unread']).default('all') }).strict();
export const notificationRead = z.union([
    z.object({ ids: z.array(z.string().uuid()).max(50) }).strict(),
    z.object({ all: z.literal(true), before: z.string().datetime() }).strict(),
]);
export function notificationTicketHref(ticket: { id: string; tenantId: string; assignedToId: string | null; property: { managerId: string } | null } | null, actor: { userId: string; role: string }) {
    if (!ticket || !authorizeTicketAccess(ticket, actor)) return null;
    const prefix = actor.role === 'MANAGER' ? '/manager/tickets/' : actor.role === 'TECHNICIAN' ? '/tech/tickets/' : '/tickets/';
    return prefix + ticket.id;
}
