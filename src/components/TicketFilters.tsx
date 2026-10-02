'use client';
import { useTicketQuery } from '@/hooks/use-ticket-query';
import { useResource } from '@/hooks/use-resource';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ErrorState } from './RequestState';
type Options = { properties: { id: string; name: string; units: { id: string; identifier: string }[] }[]; technicians: { id: string; name: string }[] };
export function TicketFilters({ role }: { role: 'TENANT' | 'MANAGER' | 'TECHNICIAN' }) {
    const state = useTicketQuery();
    const params = new URLSearchParams(state.query);
    const options = useResource<Options>(role === 'TENANT' ? null : '/api/tickets/options');
    const selectClass = 'h-11 w-full min-w-0 rounded-md border bg-white px-3 text-sm';
    return <section aria-label="Ticket search and filters" className="rounded-lg border bg-white p-4 space-y-3">
        <form key={state.query} onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>; state.change({ ...values, q: values.q.trim(), page: '' }); }} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0"><Label htmlFor="ticket-search">Search tickets</Label><Input id="ticket-search" name="q" defaultValue={params.get('q') ?? ''} maxLength={120} placeholder="Issue, property, or unit" /></div>
            <div><Label htmlFor="ticket-status">Status</Label><select id="ticket-status" name="status" className={selectClass} defaultValue={params.get('status') ?? ''}><option value="">All statuses</option>{['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map(status => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}</select></div>
            <div><Label htmlFor="ticket-priority">Priority</Label><select id="ticket-priority" name="priority" className={selectClass} defaultValue={params.get('priority') ?? ''}><option value="">All priorities</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(priority => <option key={priority} value={priority}>{priority}</option>)}</select></div>
            <div><Label htmlFor="ticket-sort">Sort</Label><select id="ticket-sort" name="sort" className={selectClass} defaultValue={params.get('sort') ?? 'newest'}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="priority">Highest priority</option><option value="updated">Recently updated</option></select></div>
            {role !== 'TENANT' && <div className="min-w-0"><Label htmlFor="ticket-property">Property</Label><select key={options.data ? "ready" : "loading"} id="ticket-property" name="propertyId" className={selectClass} disabled={options.loading || !!options.error} defaultValue={params.get('propertyId') ?? ''}><option value="">{options.loading ? 'Loading properties…' : 'All accessible properties'}</option>{options.data?.properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></div>}
            {role === 'MANAGER' && <><div className="min-w-0"><Label htmlFor="ticket-unit">Unit</Label><select key={options.data ? "ready" : "loading"} id="ticket-unit" name="unitId" className={selectClass} disabled={options.loading || !!options.error} defaultValue={params.get('unitId') ?? ''}><option value="">All managed units</option>{options.data?.properties.flatMap(property => property.units.map(unit => <option key={unit.id} value={unit.id}>{property.name} · {unit.identifier}</option>))}</select></div><div><Label htmlFor="ticket-assignee">Technician</Label><select key={options.data ? "ready" : "loading"} id="ticket-assignee" name="technicianId" className={selectClass} disabled={options.loading || !!options.error} defaultValue={params.get('technicianId') ?? ''}><option value="">All technicians</option>{options.data?.technicians.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select></div></>}
            <div className="flex flex-wrap gap-2 items-end"><Button type="submit">Apply filters</Button><Button type="button" variant="outline" onClick={() => state.change({}, true)}>Clear filters</Button></div>
        </form>
        {!!options.error && <ErrorState error={options.error} retry={options.reload} label="Could not load filter choices" entity="filter choices" />}
    </section>;
}
