'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestData } from '@/lib/client-request';

export function useResource<T>(url: string | null) {
    const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown }>({ data: null, loading: !!url, error: null });
    const revision = useRef(0);
    const reload = useCallback(async () => {
        const version = ++revision.current;
        if (!url) { setState({ data: null, loading: false, error: null }); return; }
        setState(current => ({ ...current, loading: true, error: null }));
        try {
            const data = await requestData<T>(url);
            if (version === revision.current) setState({ data, loading: false, error: null });
        } catch (error) {
            if (version === revision.current) setState(current => ({ ...current, loading: false, error }));
        }
    }, [url]);
    useEffect(() => {
        const requestRevision = revision;
        setState({ data: null, loading: !!url, error: null });
        void reload();
        return () => { requestRevision.current++; };
    }, [url, reload]);
    return { ...state, reload };
}
