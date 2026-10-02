import { Button } from './ui/button';
import { RequestError } from '@/lib/client-request';

export function LoadingState({ label }: { label: string }) {
    return <div role="status" className="rounded-lg border bg-white p-8 text-center text-slate-600 min-h-32">{label}</div>;
}

export function ErrorState({ error, retry, label = 'Could not load this information', entity = 'ticket' }: { error: unknown; retry: () => void; label?: string; entity?: string }) {
    const status = error instanceof RequestError ? error.status : undefined;
    const message = status === 404 ? `This ${entity} could not be found.` : status === 403 ? `You do not have access to this ${entity}.` : status === 401 ? 'Your session has expired. Please sign in again.' : status && status >= 500 ? 'The service is temporarily unavailable. Please try again.' : 'Check your connection and try again. If the problem continues, return later.';
    return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 space-y-3">
        <p className="font-semibold text-red-900">{label}</p><p className="text-sm text-red-800">{message}</p>
        {status === 401 ? <a href="/login" className="inline-flex min-h-11 items-center font-medium underline">Sign in</a> : <Button variant="outline" onClick={retry}>Try again</Button>}
    </div>;
}
