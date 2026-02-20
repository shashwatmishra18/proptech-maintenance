'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';

export default function ManagerDashboard() {
    const [tickets, setTickets] = useState<any[]>([]);
    const [metrics, setMetrics] = useState({
        total: 0,
        open: 0,
        inProgress: 0,
        done: 0,
        highPriority: 0,
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
            <h1 className="text-3xl font-bold tracking-tight">Manager Dashboard</h1>

            <div className="grid gap-4 md:grid-cols-5">
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">Total Tickets</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{metrics.total}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">Open</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-blue-600">{metrics.open}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">In Progress</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-orange-500">{metrics.inProgress}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">Done</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-green-600">{metrics.done}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-slate-500">High Priority</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-red-600">{metrics.highPriority}</CardContent></Card>
            </div>

            <h2 className="text-2xl font-semibold mt-8 mb-4">All Tickets</h2>
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 uppercase text-slate-500 text-xs">
                        <tr>
                            <th className="px-6 py-3">Title</th>
                            <th className="px-6 py-3">Tenant</th>
                            <th className="px-6 py-3">Priority</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3">Tech</th>
                            <th className="px-6 py-3">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tickets.map(ticket => (
                            <tr key={ticket.id} className="border-b hover:bg-slate-50 cursor-pointer">
                                <td className="px-6 py-4 font-medium">{ticket.title}</td>
                                <td className="px-6 py-4">{ticket.tenant?.name}</td>
                                <td className="px-6 py-4"><Badge variant="outline">{ticket.priority}</Badge></td>
                                <td className="px-6 py-4"><Badge>{ticket.status}</Badge></td>
                                <td className="px-6 py-4">{ticket.assignedTo?.name || '-'}</td>
                                <td className="px-6 py-4">
                                    <Link href={`/manager/tickets/${ticket.id}`} className="text-blue-600 hover:underline">View/Assign</Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
