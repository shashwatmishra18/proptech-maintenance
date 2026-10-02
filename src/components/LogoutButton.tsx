'use client';

import { Button } from './ui/button';
import { useMutation } from '@/hooks/use-mutation';
import { requestData } from '@/lib/client-request';

export function LogoutButton() {
    const { pending, run } = useMutation();
    return <Button variant="outline" size="sm" disabled={pending} onClick={() => run(async () => {
        await requestData('/api/auth/logout', { method: 'POST' });
        window.location.replace('/login');
    }, 'Logout failed')}>
        {pending ? 'Logging out...' : 'Logout'}
    </Button>;
}
