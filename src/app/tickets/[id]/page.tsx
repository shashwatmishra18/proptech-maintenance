'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Image from 'next/image';

export default function TenantTicketDetail() {
    const params = useParams();
    const [ticket, setTicket] = useState<any>(null);

    useEffect(() => {
        fetch(`/api/tickets/${params.id}`).then(r => r.json()).then(d => {
            if (d.success) setTicket(d.data);
        });
    }, [params.id]);

    if (!ticket) return <div className="p-8 text-center text-slate-500">Loading ticket details...</div>;

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex justify-between items-start">
                <h1 className="text-3xl font-bold tracking-tight">{ticket.title}</h1>
                <div className="flex gap-2">
                    <Badge variant={ticket.status === 'DONE' ? 'outline' : 'default'} className="text-sm px-3 py-1">{ticket.status}</Badge>
                    <Badge variant="secondary" className="text-sm px-3 py-1">{ticket.priority}</Badge>
                </div>
            </div>

            <Card>
                <CardContent className="pt-6">
                    <p className="text-slate-700 whitespace-pre-wrap">{ticket.description}</p>
                    <div className="mt-8 text-sm text-slate-500">
                        <strong>Created:</strong> {new Date(ticket.createdAt).toLocaleString()}
                    </div>
                    {ticket.assignedTo && (
                        <div className="mt-2 text-sm text-slate-500">
                            <strong>Assigned Technician:</strong> {ticket.assignedTo.name}
                        </div>
                    )}
                </CardContent>
            </Card>

            {ticket.images && ticket.images.length > 0 && (
                <Card>
                    <CardHeader><CardTitle>Attached Images</CardTitle></CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap gap-4">
                            {ticket.images.map((img: any) => (
                                <div key={img.id} className="relative w-48 h-48 rounded-md overflow-hidden border">
                                    {/* Using standard img tag for local uploads demonstration without complex next/image hostname config */}
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
    );
}
