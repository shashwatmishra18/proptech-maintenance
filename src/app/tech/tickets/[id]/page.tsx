'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';

export default function TechTicketDetail() {
    const params = useParams();
    const router = useRouter();
    const { toast } = useToast();
    const [ticket, setTicket] = useState<any>(null);
    const [note, setNote] = useState('');
    const [addingNote, setAddingNote] = useState(false);

    const fetchTicket = () => {
        fetch(`/api/tickets/${params.id}`).then(r => r.json()).then(d => {
            if (d.success) setTicket(d.data);
        });
    };

    useEffect(() => {
        fetchTicket();
    }, [params.id]);

    const handleStatusUpdate = async (newStatus: string) => {
        const res = await fetch(`/api/tickets/${params.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (res.ok) {
            toast({ title: 'Status updated' });
            fetchTicket();
        } else {
            toast({ title: 'Failed to update', description: data.error, variant: 'destructive' });
        }
    };

    const handleAddNote = async () => {
        if (!note.trim()) return;
        setAddingNote(true);
        const res = await fetch(`/api/tickets/${params.id}/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note })
        });
        const data = await res.json();
        setAddingNote(false);

        if (res.ok) {
            toast({ title: 'Note added' });
            setNote('');
            fetchTicket();
        } else {
            toast({ title: 'Failed to add note', description: data.error, variant: 'destructive' });
        }
    };

    if (!ticket) return <div className="p-8 text-center text-slate-500">Loading ticket details...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-start">
                <h1 className="text-3xl font-bold tracking-tight">Tech Task: {ticket.title}</h1>
                <div className="flex gap-2">
                    <Badge variant={ticket.status === 'DONE' ? 'outline' : 'default'} className="text-sm px-3 py-1">{ticket.status}</Badge>
                    <Badge variant="secondary" className="text-sm px-3 py-1">{ticket.priority}</Badge>
                </div>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 space-y-6">
                    <Card>
                        <CardContent className="pt-6">
                            <p className="text-slate-700 whitespace-pre-wrap">{ticket.description}</p>
                            <div className="mt-8 text-sm text-slate-500 space-y-1">
                                <p><strong>Tenant:</strong> {ticket.tenant.name} ({ticket.tenant.email})</p>
                                <p><strong>Created:</strong> {new Date(ticket.createdAt).toLocaleString()}</p>
                            </div>
                        </CardContent>
                    </Card>

                    {ticket.images && ticket.images.length > 0 && (
                        <Card>
                            <CardHeader><CardTitle>Attached Images</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-4">
                                    {ticket.images.map((img: any) => (
                                        <div key={img.id} className="relative w-32 h-32 rounded-md overflow-hidden border">
                                            <img src={img.imageUrl} alt="Ticket attachment" className="object-cover w-full h-full" />
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <Card>
                        <CardHeader><CardTitle>Activity Log</CardTitle></CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {ticket.activityLogs.map((log: any) => (
                                    <div key={log.id} className="border-l-2 border-slate-200 pl-4 py-1">
                                        <p className="text-sm font-medium text-slate-900">{log.action}</p>
                                        <p className="text-xs text-slate-500">
                                            {log.user.name} ({log.user.role}) - {new Date(log.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6">
                    <Card>
                        <CardHeader><CardTitle>Update Status</CardTitle></CardHeader>
                        <CardContent className="space-y-4 text-center">
                            {ticket.status === 'ASSIGNED' && (
                                <Button onClick={() => handleStatusUpdate('IN_PROGRESS')} className="w-full bg-orange-600 hover:bg-orange-700">Mark In Progress</Button>
                            )}
                            {ticket.status === 'IN_PROGRESS' && (
                                <Button onClick={() => handleStatusUpdate('DONE')} className="w-full bg-green-600 hover:bg-green-700">Mark Done</Button>
                            )}
                            {ticket.status === 'DONE' && (
                                <div className="p-4 bg-green-50 text-green-700 border border-green-200 rounded-md">Ticket Completed</div>
                            )}
                        </CardContent>
                    </Card>

                    {ticket.status !== 'DONE' && (
                        <Card>
                            <CardHeader><CardTitle>Add Note</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <Textarea placeholder="Type your note here..." value={note} onChange={e => setNote(e.target.value)} />
                                <Button onClick={handleAddNote} disabled={addingNote} variant="outline" className="w-full">Post Note</Button>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
