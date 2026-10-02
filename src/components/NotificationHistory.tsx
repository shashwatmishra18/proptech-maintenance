'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { NotificationPage } from '@/lib/types';
import { useResource } from '@/hooks/use-resource';
import { useMutation } from '@/hooks/use-mutation';
import { useToast } from '@/hooks/use-toast';
import { requestData } from '@/lib/client-request';
import { Button } from './ui/button';
import { LoadingState, ErrorState } from './RequestState';
export function NotificationHistory() {
    const [page, setPage] = useState(1), [unread, setUnread] = useState(false);
    const resource = useResource<NotificationPage>('/api/notifications?page=' + page + '&pageSize=20&state=' + (unread ? 'unread' : 'all'));
    const { pending, run } = useMutation(); const { toast } = useToast();
    function mark(body: object) { void run(async () => { await requestData('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await resource.reload(); window.dispatchEvent(new Event('notifications-changed')); toast({ title: 'Notifications marked read' }); }, 'Could not update read status'); }
    return <div className="max-w-3xl mx-auto space-y-6"><header className="page-heading"><div><p className="eyebrow">Your updates</p><h1>Notifications</h1><p>Ticket updates and account messages, all in one place.</p></div></header>
        <div className="surface flex flex-wrap items-center justify-between gap-3 p-4"><label className="inline-flex min-h-11 gap-2 items-center text-sm font-medium"><input type="checkbox" checked={unread} onChange={event => { setUnread(event.target.checked); setPage(1); }} />Unread only</label><Button variant="outline" disabled={pending || resource.loading || !!resource.error || !resource.data?.unreadCount} onClick={() => mark({ all: true, before: resource.data!.snapshotAt })}>Mark all read</Button></div>
        {resource.loading ? <LoadingState label="Loading notifications…" /> : resource.error ? <ErrorState error={resource.error} retry={resource.reload} /> : resource.data && <>
            <p className="text-sm text-slate-600" role="status">{resource.data.unreadCount} unread · {resource.data.total} {unread ? 'unread notifications' : 'notifications'}</p>
            {resource.data.notifications.length === 0 ? <div className="empty-state"><h2 className="font-semibold">{unread ? 'You’re all caught up' : 'No notifications yet'}</h2><p>Updates will appear here as maintenance work progresses.</p></div> : <ol className="space-y-3">{resource.data.notifications.map(item => <li key={item.id} className={'surface p-4 sm:p-5 space-y-3 ' + (!item.read ? 'border-l-4 border-l-blue-600' : '')}><div className="flex flex-wrap gap-2 items-center justify-between"><span className={'text-xs font-semibold ' + (item.read ? 'text-slate-600' : 'text-blue-700')}>{item.read ? 'Read' : 'Unread'}</span><time className="text-xs text-slate-600" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div><p className="break-words [overflow-wrap:anywhere]">{item.message}</p><div className="flex flex-wrap gap-3 items-center">{item.ticketHref && <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 hover:underline" href={item.ticketHref}>View ticket →</Link>}{!item.read && <Button variant="outline" disabled={pending} onClick={() => mark({ ids: [item.id] })}>Mark read</Button>}</div></li>)}</ol>}
            <nav aria-label="Notification pagination" className="flex flex-wrap gap-3 items-center"><Button variant="outline" disabled={resource.data.page <= 1} onClick={() => setPage(resource.data!.page - 1)}>Previous page</Button><p className="text-sm" role="status">Page {resource.data.page} of {resource.data.totalPages}</p><Button variant="outline" disabled={resource.data.page >= resource.data.totalPages} onClick={() => setPage(resource.data!.page + 1)}>Next page</Button></nav>
        </>}
    </div>;
}
