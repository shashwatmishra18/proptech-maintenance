'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useResource } from '@/hooks/use-resource';
import { useMutation } from '@/hooks/use-mutation';
import { requestData } from '@/lib/client-request';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { LoadingState, ErrorState } from './RequestState';

type Tenant = { id: string; name: string; email: string; occupancyVersion: number; unit: { id: string; identifier: string; property: { name: string } } | null };
type Unit = { id: string; identifier: string; floor: string | null; description: string | null; updatedAt: string; tenants: Tenant[] };
type Property = { id: string; name: string; address: string; description: string | null; updatedAt: string; units: Unit[]; _count?: { units: number } };
type Fields = { name?: string; address?: string; identifier?: string; floor?: string | null; description?: string | null };

function Editor({ initial = {}, unit = false, save, pending, prefix }: { initial?: Fields; unit?: boolean; save: (body: object) => Promise<void>; pending: boolean; prefix: string }) {
    return <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void save(Object.fromEntries(data)); }} className="space-y-3">
        <fieldset disabled={pending} className="space-y-3">
            <Label htmlFor={prefix + '-name'}>{unit ? 'Unit identifier' : 'Property name'}</Label>
            <Input id={prefix + '-name'} name={unit ? 'identifier' : 'name'} required minLength={unit ? 1 : 2} maxLength={unit ? 50 : 120} defaultValue={unit ? initial.identifier : initial.name} />
            <Label htmlFor={prefix + '-address'}>{unit ? 'Floor (optional)' : 'Address'}</Label>
            <Input id={prefix + '-address'} name={unit ? 'floor' : 'address'} required={!unit} minLength={unit ? undefined : 5} maxLength={unit ? 50 : 500} defaultValue={(unit ? initial.floor : initial.address) ?? ''} />
            <Label htmlFor={prefix + '-description'}>Description (optional)</Label>
            <Textarea id={prefix + '-description'} name="description" maxLength={unit ? 1000 : 2000} defaultValue={initial.description ?? ''} />
            <Button type="submit">{pending ? 'Saving…' : 'Save ' + (unit ? 'unit' : 'property')}</Button>
        </fieldset>
    </form>;
}

export function PropertyList() {
    const resource = useResource<Property[]>('/api/properties');
    const mutation = useMutation();
    const [error, setError] = useState<unknown>(null);
    const [revision, setRevision] = useState(0);
    async function save(body: object) {
        await mutation.run(async () => { setError(null); try { await requestData('/api/properties', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setRevision(value => value + 1); await resource.reload(); } catch (failure) { setError(failure); throw failure; } }, 'Could not create property');
    }
    return <div className="space-y-6"><h1 className="text-3xl font-bold">My properties</h1><Link href="/manager/dashboard" className="text-blue-700 inline-flex min-h-11 items-center">← Dashboard</Link>
        {resource.loading ? <LoadingState label="Loading properties…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} entity="property" /> : resource.data?.length === 0 ? <p>No properties yet. Create your first property below.</p> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{resource.data?.map(property => <Link href={'/manager/properties/' + property.id} key={property.id} className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"><Card><CardHeader><CardTitle className="break-words">{property.name}</CardTitle></CardHeader><CardContent><p className="break-words">{property.address}</p><p>{property._count?.units ?? 0} units · Manage property →</p></CardContent></Card></Link>)}</div>}
        <Card><CardHeader><CardTitle>Create property</CardTitle></CardHeader><CardContent>{!!error && <p role="alert" className="text-red-800">{error instanceof Error ? error.message : 'Could not save change. Please try again.'}</p>}<Editor key={revision} prefix="new-property" save={save} pending={mutation.pending} /></CardContent></Card>
    </div>;
}

export function PropertyDetail() {
    const params = useParams();
    const endpoint = '/api/properties/' + params.id;
    const resource = useResource<Property>(endpoint);
    const mutation = useMutation();
    const [error, setError] = useState<unknown>(null);
    const [email, setEmail] = useState('');
    const [tenant, setTenant] = useState<Tenant | null>(null);
    const [unitId, setUnitId] = useState('');
    const [unitRevision, setUnitRevision] = useState(0);
    const [notice, setNotice] = useState('');
    async function save(path: string, method: string, body: object) {
        await mutation.run(async () => { setError(null); setNotice(''); try { await requestData(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setUnitRevision(value => value + 1); setNotice('Saved successfully.'); await resource.reload(); } catch (failure) { setError(failure); throw failure; } }, 'Could not save change');
    }
    async function lookup(event: FormEvent) {
        event.preventDefault();
        await mutation.run(async () => { setError(null); setTenant(null); setNotice(''); try { const found = await requestData<Tenant>('/api/tenant-assignment?email=' + encodeURIComponent(email)); setTenant(found); setUnitId(resource.data?.units.some(unit => unit.id === found.unit?.id) ? found.unit!.id : ''); } catch (failure) { setError(failure); throw failure; } }, 'Could not find tenant');
    }
    async function assign(event: FormEvent) {
        event.preventDefault(); if (!tenant) return;
        await mutation.run(async () => { setError(null); setNotice(''); try {
            const updated = await requestData<Tenant>('/api/tenant-assignment', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: tenant.email, unitId: unitId === '__UNASSIGNED__' ? null : unitId, expectedVersion: tenant.occupancyVersion }) });
            setTenant(updated); setNotice('Tenant assignment saved.'); await resource.reload();
        } catch (failure) { setError(failure); setTenant(null); throw failure; } }, 'Could not assign tenant');
    }
    const property = resource.data;
    return <div className="space-y-6"><Link href="/manager/properties" className="text-blue-700 inline-flex min-h-11 items-center">← My properties</Link>
        {resource.loading ? <LoadingState label="Loading property…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} entity="property" /> : property && <>
            <h1 className="text-3xl font-bold break-words">{property.name}</h1>
            {!!error && <p role="alert" className="text-red-800">{error instanceof Error ? error.message : 'Could not save change. Please try again.'}</p>}<p role="status" className="text-green-800">{notice}</p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card><CardHeader><CardTitle>Edit property</CardTitle></CardHeader><CardContent><Editor key={property.updatedAt} prefix="edit-property" initial={property} save={body => save(endpoint, 'PATCH', body)} pending={mutation.pending} /></CardContent></Card>
                <Card><CardHeader><CardTitle>Add unit</CardTitle></CardHeader><CardContent><Editor key={unitRevision} unit prefix="new-unit" save={body => save(endpoint + '/units', 'POST', body)} pending={mutation.pending} /></CardContent></Card>
            </div>
            <section className="space-y-4"><h2 className="text-xl font-semibold">Units and current tenants</h2>{property.units.length === 0 && <p>No units yet. Add a unit above to assign tenants.</p>}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{property.units.map(unit => <Card key={unit.id}><CardHeader><CardTitle>Unit {unit.identifier}</CardTitle></CardHeader><CardContent className="space-y-4"><Editor key={unit.updatedAt} unit prefix={unit.id} initial={unit} pending={mutation.pending} save={body => save(endpoint + '/units/' + unit.id, 'PATCH', body)} /><div><h3 className="font-semibold">Current occupants</h3>{unit.tenants.length ? <ul>{unit.tenants.map(occupant => <li key={occupant.id} className="break-words">{occupant.name} · {occupant.email}</li>)}</ul> : <p className="text-slate-600">No tenants assigned.</p>}</div></CardContent></Card>)}</div>
            </section>
            <Card><CardHeader><CardTitle>Assign existing tenant</CardTitle></CardHeader><CardContent className="space-y-4">
                <p className="text-sm text-slate-600">Look up an exact tenant email. Only unassigned tenants and tenants in your properties are eligible.</p>
                <form onSubmit={lookup} className="space-y-3"><Label htmlFor="tenant-email">Tenant email</Label><Input id="tenant-email" type="email" value={email} required disabled={mutation.pending} onChange={event => { setEmail(event.target.value); setTenant(null); }} /><Button disabled={mutation.pending}>Look up tenant</Button></form>
                {tenant && <form onSubmit={assign} className="space-y-3"><p className="break-words">{tenant.name} · Current: {tenant.unit ? tenant.unit.property.name + ' / ' + tenant.unit.identifier : 'Unassigned'}</p><Label htmlFor="assigned-unit">New unit</Label><select id="assigned-unit" value={unitId} onChange={event => setUnitId(event.target.value)} disabled={mutation.pending} className="w-full h-11 rounded-md border px-3"><option value="" disabled>Select a unit or remove assignment</option><option value="__UNASSIGNED__">Remove current assignment</option>{property.units.map(unit => <option key={unit.id} value={unit.id}>Unit {unit.identifier}</option>)}</select><Button disabled={mutation.pending || !unitId}>Save tenant assignment</Button><p className="text-sm text-slate-600">Existing tickets retain their original location.</p></form>}
            </CardContent></Card>
        </>}
    </div>;
}
