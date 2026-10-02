'use client';

import type { TicketDetail, UserSummary } from '@/lib/types';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

export default function ManagerTicketDetail() {
    const params = useParams();
    const { toast } = useToast();
    const [ticket, setTicket] = useState<TicketDetail | null>(null);
    const [technicians, setTechnicians] = useState<UserSummary[]>([]);
    const [selectedTech, setSelectedTech] = useState('');

    const fetchTicket = useCallback(() => {
        fetch(`/api/tickets/${params.id}`).then(r => r.json()).then(d => {
            if (d.success) setTicket(d.data);
        });
    }, [params.id]);

    useEffect(() => {
        fetchTicket();
        fetch('/api/users?role=TECHNICIAN').then(r => r.json()).then(d => {
            if (d.success) setTechnicians(d.data);
        });
    }, [fetchTicket]);

    const handleAssign = async () => {
        if (!selectedTech) return toast({ title: 'Select a technician', variant: 'destructive' });

        const res = await fetch(`/api/tickets/${params.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ technicianId: selectedTech })
        });

        const data = await res.json();
        if (res.ok) {
            toast({ title: 'Technician assigned successfully' });
            fetchTicket();
        } else {
            toast({ title: 'Failed to assign', description: data.error, variant: 'destructive' });
        }
    };

    if (!ticket) return <div className="p-8 text-center text-slate-500">Loading ticket details...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-start">
                <h1 className="text-3xl font-bold tracking-tight">Manager View: {ticket.title}</h1>
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
                                <p><strong>Current Tech:</strong> {ticket.assignedTo?.name || 'Unassigned'}</p>
                            </div>
                        </CardContent>
                    </Card>

                    {ticket.images && ticket.images.length > 0 && (
                        <Card>
                            <CardHeader><CardTitle>Attached Images</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-4">
                                    {ticket.images.map((img) => (
                                        <div key={img.id} className="relative w-32 h-32 rounded-md overflow-hidden border">
                                            <Image src={img.imageUrl} alt="Ticket attachment" fill sizes="128px" className="object-cover" unoptimized />
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
                                {ticket.activityLogs.map((log) => (
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
                        <CardHeader><CardTitle>Assign Technician</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {ticket.status === 'OPEN' ? (
                                <>
                                    <Select value={selectedTech} onValueChange={setSelectedTech}>
                                        <SelectTrigger><SelectValue placeholder="Select Technician" /></SelectTrigger>
                                        <SelectContent>
                                            {technicians.map(t => (
                                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button onClick={handleAssign} className="w-full">Assign Ticket</Button>
                                </>
                            ) : (
                                <div className="p-4 bg-slate-50 text-sm text-slate-500 rounded-md border text-center">
                                    This ticket is already in progress or completed and cannot be reassigned.
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
