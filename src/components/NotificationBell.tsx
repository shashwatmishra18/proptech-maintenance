'use client';

import type { NotificationSummary } from '@/lib/types';

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
        } catch {
            // Keep the last confirmed state when background polling fails.
        }
    }, []);

    useEffect(() => {
        fetchData();
        // In a real app we'd use WebSockets or SSE, for MVP we poll every 30s
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
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
        } catch (error) {
            toast({ title: 'Could not mark notifications read', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
        } finally {
            reading.current = false;
        }
    };

    return (
        <DropdownMenu open={open} onOpenChange={(val) => { setOpen(val); if (val) markAsRead(); }}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-red-600 text-white text-[10px] flex items-center justify-center font-bold">
                            {unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
                <div className="flex bg-slate-50 items-center justify-between px-4 py-2 border-b">
                    <span className="font-semibold text-sm">Notifications</span>
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                        <div className="p-4 text-center text-sm text-slate-500">No recent notifications</div>
                    ) : (
                        notifications.map((n) => (
                            <DropdownMenuItem key={n.id} className="p-4 focus:bg-slate-50 cursor-default border-b last:border-0 flex flex-col items-start gap-1">
                                <span className={`text-sm ${!n.read ? 'font-medium text-slate-900' : 'text-slate-600'}`}>
                                    {n.message}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                    {new Date(n.createdAt).toLocaleString()}
                                </span>
                            </DropdownMenuItem>
                        ))
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
