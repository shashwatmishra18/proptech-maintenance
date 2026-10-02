'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { TicketDetail, UserSummary } from '@/lib/types';
import { useResource } from '@/hooks/use-resource';
import { useMutation } from '@/hooks/use-mutation';
import { useToast } from '@/hooks/use-toast';
import { requestData } from '@/lib/client-request';
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { LoadingState, ErrorState } from './RequestState';
import { TicketBadges } from './TicketBadges';
import { TicketLocation } from './TicketLocation';

export function TicketDetailView({ role }: { role: 'TENANT' | 'MANAGER' | 'TECHNICIAN' }) {
    const params = useParams();
    const resource = useResource<TicketDetail>('/api/tickets/' + params.id);
    const technicians = useResource<UserSummary[]>(role === 'MANAGER' ? '/api/users?role=TECHNICIAN' : null);
    const { pending, run } = useMutation();
    const { toast } = useToast();
    const [note, setNote] = useState('');
    const [selectedTech, setSelectedTech] = useState('');
    const dashboard = role === 'MANAGER' ? '/manager/dashboard' : role === 'TECHNICIAN' ? '/tech/dashboard' : '/dashboard';
    const ticket = resource.data;
    async function mutate(path: string, method: string, body: object, success: string, clearNote = false) {
        await run(async () => {
            await requestData('/api/tickets/' + params.id + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (clearNote) setNote('');
            toast({ title: success });
            await resource.reload();
        }, 'Could not save change');
    }
    return <div className="max-w-5xl mx-auto space-y-6">
        <Link href={dashboard} className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline">← Back to dashboard</Link>
        {resource.loading ? <LoadingState label="Loading ticket details…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} label="Could not load ticket details" /> : ticket && <>
            <header className="space-y-3"><h1 className="text-2xl sm:text-3xl font-bold break-words [overflow-wrap:anywhere]">{ticket.title}</h1><TicketBadges ticket={ticket} /><TicketLocation ticket={ticket} /></header>
            <div className="grid gap-6 lg:grid-cols-3"><div className="lg:col-span-2 min-w-0 space-y-6">
                <Card><CardHeader><CardTitle className="text-lg">Issue details</CardTitle></CardHeader><CardContent className="space-y-5"><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-slate-700">{ticket.description}</p><dl className="text-sm text-slate-600 space-y-2 break-words [overflow-wrap:anywhere]"><div><dt className="font-semibold inline">Reported: </dt><dd className="inline">{new Date(ticket.createdAt).toLocaleString()}</dd></div><div><dt className="font-semibold inline">Tenant: </dt><dd className="inline">{ticket.tenant.name}{ticket.tenant.email && ` (${ticket.tenant.email})`}</dd></div><div><dt className="font-semibold inline">Technician: </dt><dd className="inline">{ticket.assignedTo?.name || 'Unassigned'}</dd></div></dl></CardContent></Card>
                {ticket.images.length > 0 && <Card><CardHeader><CardTitle className="text-lg">Attached images</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{ticket.images.map((image, index) => <a href={image.imageUrl} key={image.id} target="_blank" rel="noopener noreferrer" className="relative aspect-square rounded-md overflow-hidden border focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" aria-label={`Open attachment ${index + 1} in a new tab`}><Image src={image.imageUrl} alt={`Issue attachment ${index + 1}`} fill sizes="(max-width: 640px) 40vw, 192px" className="object-cover" unoptimized /></a>)}</div></CardContent></Card>}
                <Card><CardHeader><CardTitle className="text-lg">Activity</CardTitle></CardHeader><CardContent><ol aria-live="polite" className="space-y-4">{ticket.activityLogs.map(log => <li key={log.id} className="border-l-2 border-slate-200 pl-4 py-1 break-words [overflow-wrap:anywhere]"><p className="text-sm font-medium whitespace-pre-wrap">{log.action}</p><p className="text-xs text-slate-600 mt-1">{log.user.name} · {log.user.role.toLowerCase()} · <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString()}</time></p></li>)}</ol>{ticket.activityLogs.length === 0 && <p className="text-sm text-slate-600">No activity yet.</p>}</CardContent></Card>
            </div><aside className="space-y-6 min-w-0">
                {role === 'MANAGER' && <Card><CardHeader><CardTitle className="text-lg">Assign technician</CardTitle></CardHeader><CardContent className="space-y-4">{ticket.status !== 'OPEN' ? <p className="text-sm text-slate-600">This ticket is already assigned. Reassignment is not available.</p> : technicians.loading ? <LoadingState label="Loading technicians…" /> : technicians.error ? <ErrorState error={technicians.error} retry={technicians.reload} label="Could not load technicians" /> : technicians.data?.length === 0 ? <p className="text-sm text-slate-600">No technicians are available for assignment.</p> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void mutate('/status', 'POST', { technicianId: selectedTech }, 'Technician assigned'); }}><Label htmlFor="technician">Technician</Label><select id="technician" required value={selectedTech} disabled={pending} onChange={e => setSelectedTech(e.target.value)} className="w-full min-w-0 h-11 rounded-md border bg-white px-3 text-sm"><option value="">Select a technician</option>{technicians.data?.map(tech => <option key={tech.id} value={tech.id}>{tech.name}</option>)}</select><Button disabled={pending || !selectedTech} className="w-full">{pending ? 'Saving…' : 'Assign ticket'}</Button></form>}</CardContent></Card>}
                {role === 'TECHNICIAN' && <Card><CardHeader><CardTitle className="text-lg">Update status</CardTitle></CardHeader><CardContent>{ticket.status === 'ASSIGNED' ? <Button disabled={pending} className="w-full" onClick={() => mutate('/status', 'PATCH', { status: 'IN_PROGRESS' }, 'Work started')}>{pending ? 'Saving…' : 'Mark in progress'}</Button> : ticket.status === 'IN_PROGRESS' ? <Button disabled={pending} className="w-full bg-green-700 hover:bg-green-800" onClick={() => mutate('/status', 'PATCH', { status: 'DONE' }, 'Ticket completed')}>{pending ? 'Saving…' : 'Mark completed'}</Button> : <p className="text-sm text-slate-600">{ticket.status === 'DONE' ? 'This ticket is completed.' : 'This ticket is awaiting assignment.'}</p>}</CardContent></Card>}
                <Card><CardHeader><CardTitle className="text-lg">Add a note</CardTitle></CardHeader><CardContent>{ticket.status === 'DONE' ? <p className="text-sm text-slate-600">Notes are closed for completed tickets.</p> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (note.trim()) void mutate('/notes', 'POST', { note }, 'Note added', true); }}><Label htmlFor="ticket-note">Maintenance note</Label><Textarea id="ticket-note" value={note} disabled={pending} required maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Share an update about this issue…" className="min-h-32" /><p className="text-xs text-slate-600">Visible to people with access to this ticket.</p><Button disabled={pending || !note.trim()} variant="outline" className="w-full">{pending ? 'Saving…' : 'Post note'}</Button></form>}</CardContent></Card>
            </aside></div>
        </>}
    </div>;
}
