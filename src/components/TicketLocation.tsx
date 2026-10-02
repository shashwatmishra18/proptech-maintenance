import type { TicketSummary } from '@/lib/types';
export function TicketLocation({ ticket }: { ticket: TicketSummary }) {
    return <p className="text-sm text-slate-600 break-words">{ticket.property ? <>{ticket.property.name}{ticket.unit && ' · Unit ' + ticket.unit.identifier}<br />{ticket.property.address}</> : 'Legacy ticket · original location details are preserved in the description.'}</p>;
}
