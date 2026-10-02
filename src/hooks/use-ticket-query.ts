'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
export function useTicketQuery() {
    const search = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const query = search.toString();
    function change(values: Record<string, string>, reset = false) {
        const next = reset ? new URLSearchParams() : new URLSearchParams(query);
        for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
        router.push(pathname + (next.size ? '?' + next.toString() : ''), { scroll: false });
    }
    return { query, url: '/api/tickets' + (query ? '?' + query : ''), change };
}
