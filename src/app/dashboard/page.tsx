'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function TenantDashboard() {
    const [tickets, setTickets] = useState<any[]>([]);

    useEffect(() => {
        fetch('/api/tickets').then(r => r.json()).then(d => {
            if (d.success) setTickets(d.data);
        });
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">My Tickets</h1>
                <Link href="/tickets/new" className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition">
                    Report Issue
                </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {tickets.map(ticket => (
                    <Link key={ticket.id} href={`/tickets/${ticket.id}`}>
                        <Card className="hover:shadow-lg transition cursor-pointer h-full">
                            <CardHeader>
                                <div className="flex justify-between items-start">
                                    <CardTitle className="text-xl">{ticket.title}</CardTitle>
                                    <Badge variant={ticket.status === 'DONE' ? 'outline' : 'default'}>{ticket.status}</Badge>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <p className="text-slate-500 line-clamp-2">{ticket.description}</p>
                                <div className="mt-4 text-sm text-slate-400">
                                    {new Date(ticket.createdAt).toLocaleDateString()}
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
                {tickets.length === 0 && (
                    <div className="col-span-full p-8 text-center text-slate-500 bg-slate-100 rounded-lg">
                        You haven't reported any issues yet.
                    </div>
                )}
            </div>
        </div>
    );
}
