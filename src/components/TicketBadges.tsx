import type { TicketSummary } from '@/lib/types';
import { Badge } from './ui/badge';

export function TicketBadges({ ticket }: { ticket: Pick<TicketSummary, 'status' | 'priority'> }) {
    const status = { OPEN: 'Open', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', DONE: 'Completed' }[ticket.status];
    return <div className="flex flex-wrap gap-2"><Badge variant={ticket.status === 'DONE' ? 'outline' : 'default'}>{status}</Badge><Badge variant="secondary">{ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()} priority</Badge></div>;
}
