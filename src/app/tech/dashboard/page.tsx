'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function TechDashboard() {
    const [tickets, setTickets] = useState<any[]>([]);
    const [metrics, setMetrics] = useState({
        assigned: 0,
        inProgress: 0,
        done: 0,
    });

    useEffect(() => {
        fetch('/api/tickets').then(r => r.json()).then(d => {
            if (d.success) setTickets(d.data);
        });

        fetch('/api/metrics').then(r => r.json()).then(d => {
            if (d.success) setMetrics(d.data);
        });
    }, []);

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Technician Dashboard</h1>

            <div className="grid gap-4 md:grid-cols-3">
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">Assigned (To Do)</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-blue-600">{metrics.assigned}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">In Progress</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-orange-500">{metrics.inProgress}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">Done</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-green-600">{metrics.done}</CardContent></Card>
            </div>

            <h2 className="text-2xl font-semibold mt-8 mb-4">My Tasks</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tickets.map(ticket => (
                    <Link key={ticket.id} href={`/tech/tickets/${ticket.id}`}>
                        <Card className="hover:shadow-lg transition cursor-pointer h-full border-l-4" style={{ borderLeftColor: ticket.priority === 'URGENT' ? 'red' : ticket.priority === 'HIGH' ? 'orange' : 'blue' }}>
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-xl">{ticket.title}</CardTitle>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <Badge variant={ticket.status === 'DONE' ? 'outline' : 'default'}>{ticket.status}</Badge>
                                    <Badge variant="secondary">{ticket.priority}</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <p className="text-slate-500 line-clamp-2">{ticket.description}</p>
                                <div className="mt-4 text-sm text-slate-400">
                                    Tenant: {ticket.tenant?.name || 'Unknown'}
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
                {tickets.length === 0 && (
                    <div className="col-span-full p-8 text-center text-slate-500 bg-slate-100 rounded-lg">
                        You have no assigned tasks.
                    </div>
                )}
            </div>
        </div>
    );
}
