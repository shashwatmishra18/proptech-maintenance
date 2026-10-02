'use client';
import { useResource } from '@/hooks/use-resource';
import { LoadingState, ErrorState } from './RequestState';
export type Occupancy = { unit: { id: string; identifier: string; property: { id: string; name: string; address: string } } | null };
export function TenantLocation() {
    const resource = useResource<Occupancy>('/api/occupancy');
    return <section aria-label="Your location" className="rounded-lg border bg-white p-5">
        {resource.loading ? <LoadingState label="Loading your location…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} label="Could not load your location" /> :
        resource.data?.unit ? <><h2 className="font-semibold">Your home</h2><p className="break-words">{resource.data.unit.property.name} · Unit {resource.data.unit.identifier}</p><p className="text-sm text-slate-600 break-words">{resource.data.unit.property.address}</p></> :
        <p>Your manager must assign you to a unit before you can submit a maintenance request. Existing tickets remain available below.</p>}
    </section>;
}
