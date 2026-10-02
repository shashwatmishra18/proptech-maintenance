'use client';

import Link from 'next/link';
import type { TicketSummary } from '@/lib/types';
import { useResource } from '@/hooks/use-resource';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { LoadingState, ErrorState } from './RequestState';
import { TicketBadges } from './TicketBadges';

type Role = 'TENANT' | 'MANAGER' | 'TECHNICIAN';
const config = {
    TENANT: { heading: 'My tickets', description: 'Report maintenance issues and follow their progress.', list: 'Your reported issues', empty: 'You haven’t reported any issues yet.', path: '/tickets/', metrics: [['totalSubmitted', 'Total submitted'], ['pending', 'Pending']] },
    MANAGER: { heading: 'Manager dashboard', description: 'Review reported issues and coordinate maintenance.', list: 'All tickets', empty: 'No maintenance issues have been reported yet.', path: '/manager/tickets/', metrics: [['total', 'Total tickets'], ['open', 'Open'], ['inProgress', 'In progress'], ['done', 'Completed'], ['highPriority', 'High priority']] },
    TECHNICIAN: { heading: 'Technician dashboard', description: 'Track your assigned maintenance work.', list: 'My tasks', empty: 'You have no assigned tasks yet.', path: '/tech/tickets/', metrics: [['assigned', 'Assigned · to do'], ['inProgress', 'In progress'], ['done', 'Completed']] },
};

export function Dashboard({ role }: { role: Role }) {
    const tickets = useResource<TicketSummary[]>('/api/tickets');
    const metrics = useResource<Record<string, number>>('/api/metrics');
    const view = config[role];
    return <div className="space-y-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{view.heading}</h1><p className="mt-2 text-slate-600">{view.description}</p></div>{role === 'TENANT' && <Button asChild className="bg-blue-600 hover:bg-blue-700"><Link href="/tickets/new">Report an issue</Link></Button>}</header>
        <section aria-label="Ticket metrics">
            {metrics.loading ? <LoadingState label="Loading ticket metrics…" /> : metrics.error ? <ErrorState error={metrics.error} retry={metrics.reload} label="Could not load ticket metrics" /> : metrics.data && <div className={"grid grid-cols-2 gap-4 " + (role === 'MANAGER' ? 'lg:grid-cols-5' : role === 'TECHNICIAN' ? 'sm:grid-cols-3' : '')}>{view.metrics.map(([key, label]) => <Card key={key}><CardHeader className="p-4 pb-2"><CardTitle className="text-sm font-medium text-slate-600">{label}</CardTitle></CardHeader><CardContent className="p-4 pt-0 text-3xl font-semibold">{metrics.data![key]}</CardContent></Card>)}</div>}
        </section>
        <section aria-labelledby="ticket-list-heading" className="space-y-4"><h2 id="ticket-list-heading" className="text-xl font-semibold">{view.list}</h2>
            {tickets.loading ? <LoadingState label="Loading tickets…" /> : tickets.error ? <ErrorState error={tickets.error} retry={tickets.reload} label="Could not load tickets" /> : tickets.data?.length === 0 ? <div className="rounded-lg border border-dashed bg-white p-8 text-center space-y-3"><p className="text-slate-600">{view.empty}</p>{role === 'TENANT' && <Button asChild variant="outline"><Link href="/tickets/new">Report your first issue</Link></Button>}</div> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{tickets.data?.map(ticket => <Link key={ticket.id} href={view.path + ticket.id} className="min-w-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><Card className="h-full hover:border-blue-300 hover:shadow-md transition-shadow"><CardHeader><CardTitle className="text-lg break-words [overflow-wrap:anywhere]">{ticket.title}</CardTitle><TicketBadges ticket={ticket} /></CardHeader><CardContent className="space-y-3"><p className="text-sm text-slate-600 line-clamp-2 break-words [overflow-wrap:anywhere]">{ticket.description}</p>{role !== 'TENANT' && <p className="text-sm text-slate-600 break-words">Tenant: {ticket.tenant.name}<br />Technician: {ticket.assignedTo?.name || 'Unassigned'}</p>}<p className="text-xs text-slate-600">Reported {new Date(ticket.createdAt).toLocaleDateString()}</p><p className="text-sm font-medium text-blue-700">View ticket →</p></CardContent></Card></Link>)}</div>}
        </section>
    </div>;
}
