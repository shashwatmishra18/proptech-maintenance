'use client';

import type { NotificationSummary } from '@/lib/types';
import Link from 'next/link';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { requestData } from '@/lib/client-request';
import { useToast } from '@/hooks/use-toast';

export function NotificationBell() {
    const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [readError, setReadError] = useState(false);
    const reading = useRef(false);
    const revision = useRef(0);
    const { toast } = useToast();

    const fetchData = useCallback(async () => {
        if (reading.current) return;
        const version = ++revision.current;
        try {
            const data = await requestData<{ notifications: NotificationSummary[]; unreadCount: number }>('/api/notifications');
            if (version !== revision.current) return;
            setNotifications(data.notifications);
            setUnreadCount(data.unreadCount);
            setLoadError(false);
        } catch {
            if (version === revision.current) setLoadError(true);
        } finally {
            if (version === revision.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        // In a real app we'd use WebSockets or SSE, for MVP we poll every 30s
        const refresh = () => { if (!document.hidden) void fetchData(); };
        const invalidate = () => { revision.current++; };
        const interval = setInterval(refresh, 30000);
        window.addEventListener('notifications-changed', refresh);
        return () => { clearInterval(interval); window.removeEventListener('notifications-changed', refresh); invalidate(); };
    }, [fetchData]);

    const markAsRead = async () => {
        const ids = notifications.filter(n => !n.read).map(n => n.id);
        if (ids.length === 0 || reading.current) return;
        reading.current = true;
        revision.current++;
        try {
            const result = await requestData<{ unreadCount: number }>('/api/notifications', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
            });
            setUnreadCount(result.unreadCount);
            setNotifications(current => current.map(n => ids.includes(n.id) ? { ...n, read: true } : n));
            setReadError(false);
        } catch (error) {
            setReadError(true);
            toast({ title: 'Could not mark notifications read', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
        } finally {
            reading.current = false;
        }
    };

    return (
        <DropdownMenu open={open} onOpenChange={(val) => { setOpen(val); if (val) markAsRead(); }}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}>
                    <Bell aria-hidden="true" className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center font-bold">
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                <div className="flex bg-slate-50 items-center justify-between px-4 py-2 border-b">
                    <span className="font-semibold text-sm">Notifications</span>
                </div>
                {loadError && <div role="alert" className="p-4 text-sm text-red-800 space-y-2"><p>Could not refresh notifications. Previously loaded items may be out of date.</p><Button variant="outline" onClick={fetchData}>Try again</Button></div>}
                {readError && <div role="alert" className="p-4 text-sm text-red-800 space-y-2"><p>Read status could not be updated.</p><Button variant="outline" onClick={markAsRead}>Retry read update</Button></div>}
                <div className="max-h-80 overflow-y-auto">
                    {loading ? <p role="status" className="p-4 text-sm text-slate-600">Loading notifications…</p> : notifications.length === 0 && !loadError ? (
                        <div className="p-4 text-center text-sm text-slate-500">No recent notifications</div>
                    ) : (
                        notifications.map(n => {
                            const content = <><span className={"text-sm break-words [overflow-wrap:anywhere] " + (!n.read ? 'font-medium text-slate-900' : 'text-slate-600')}>{n.message}</span><span className="text-xs text-blue-700">{n.read ? 'Read' : 'Unread'}</span><time className="text-xs text-slate-600" dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString()}</time>{n.ticketHref && <span className="text-sm font-medium text-blue-700">View ticket →</span>}</>;
                            const style = 'p-4 focus:bg-slate-50 border-b last:border-0 flex flex-col items-start gap-1';
                            return n.ticketHref ? <DropdownMenuItem key={n.id} asChild><Link href={n.ticketHref} className={style} onClick={() => setOpen(false)}>{content}</Link></DropdownMenuItem> : <DropdownMenuItem key={n.id} className={style}>{content}</DropdownMenuItem>;
                        })
                    )}
                </div>
                <div className="border-t p-2"><DropdownMenuItem asChild><Link href="/notifications" className="flex min-h-11 items-center justify-center rounded-md text-sm font-semibold text-blue-700 hover:bg-blue-50" onClick={() => setOpen(false)}>View all notifications</Link></DropdownMenuItem></div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
