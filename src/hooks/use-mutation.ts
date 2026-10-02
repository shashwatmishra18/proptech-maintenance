'use client';

import { useRef, useState } from 'react';
import { useToast } from './use-toast';

export function useMutation() {
    const active = useRef(false);
    const [pending, setPending] = useState(false);
    const { toast } = useToast();

    async function run(action: () => Promise<void>, failureTitle: string) {
        if (active.current) return;
        active.current = true;
        setPending(true);
        try { await action(); }
        catch (error) {
            toast({ title: failureTitle, description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
        } finally {
            active.current = false;
            setPending(false);
        }
    }
    return { pending, run };
}
