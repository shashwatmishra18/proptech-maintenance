'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useResource } from '@/hooks/use-resource';
import { useMutation } from '@/hooks/use-mutation';
import { requestData } from '@/lib/client-request';
import { LoadingState, ErrorState } from './RequestState';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

type Account = { id: string; name: string; email: string; role: string; active: boolean; authVersion: number };
const style = 'surface p-4 sm:p-6 space-y-4 min-w-0';
function NewPasswordFields() { return <><div><Label htmlFor="new-password">New password</Label><Input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={72} /></div><div><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" required /></div><p className="text-sm text-slate-600">Use at least 10 characters and at most 72 UTF-8 bytes. No complexity rules; spaces are allowed, but a blank password is not.</p></>; }
function values(form: HTMLFormElement) { return Object.fromEntries(new FormData(form)) as Record<string, string>; }
function checkPassword(data: Record<string, string>) { if (data.password !== data.confirmation) throw Error('Passwords must match.'); if (!data.password.trim() || data.password.length < 10 || new TextEncoder().encode(data.password).length > 72) throw Error('Use at least 10 characters and at most 72 UTF-8 bytes.'); }
export function AccountSettings() {
    const account = useResource<Account>('/api/account'); const { pending, run } = useMutation(); const [message, setMessage] = useState(''); const router = useRouter();
    return <div className="max-w-2xl mx-auto space-y-6"><h1 className="text-2xl font-bold">Account settings</h1>{account.loading ? <LoadingState label="Loading account details…" /> : account.error ? <ErrorState error={account.error} retry={account.reload} /> : account.data && <>
        <form className={style} aria-busy={pending} onSubmit={event => { event.preventDefault(); const data = values(event.currentTarget); void run(async () => { await requestData('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); setMessage('Profile saved.'); await account.reload(); }, 'Could not save profile'); }}>
            <h2 className="text-lg font-semibold">Profile</h2><p className="break-words [overflow-wrap:anywhere]">Email: {account.data.email}<br />Role: {account.data.role.toLowerCase()}</p><p className="text-sm text-slate-600">Email and role are read-only.</p><Label htmlFor="profile-name">Name</Label><Input key={account.data.name} id="profile-name" name="name" defaultValue={account.data.name} required minLength={2} maxLength={100} autoComplete="name" /><Button disabled={pending}>Save profile</Button>
        </form>
        <form className={style} aria-busy={pending} onSubmit={event => { event.preventDefault(); const data = values(event.currentTarget); void run(async () => { checkPassword(data); await requestData('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); router.push('/login'); router.refresh(); }, 'Could not change password'); }}>
            <h2 className="text-lg font-semibold">Change password</h2><div><Label htmlFor="current-password">Current password</Label><Input id="current-password" name="currentPassword" type="password" required autoComplete="current-password" /></div><NewPasswordFields /><p className="text-sm text-slate-600">All sessions will be invalidated. Sign in again after saving.</p><Button disabled={pending}>Change password</Button>
        </form></>}{message && <p role="status">{message}</p>}</div>;
}
export function ForgotPassword() {
    const { pending, run } = useMutation(); const [message, setMessage] = useState('');
    return <div className="max-w-sm mx-auto space-y-4"><h1 className="text-2xl font-bold">Forgot password</h1><form className={style} aria-busy={pending} onSubmit={event => { event.preventDefault(); const data = values(event.currentTarget); void run(async () => { const result = await requestData<{ message: string }>('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); setMessage(result.message); }, 'Could not request recovery'); }}><Label htmlFor="recovery-email">Email</Label><Input id="recovery-email" name="email" type="email" required autoComplete="email" /><Button disabled={pending}>Request recovery</Button></form>{message && <p role="status" className="text-sm">{message}</p>}<Link href="/login" className="inline-flex min-h-11 items-center text-blue-700">Back to sign in</Link></div>;
}
export function CredentialCompletion({ purpose }: { purpose: 'INVITE' | 'RESET' }) {
    const [token, setToken] = useState<string | null>(null), [context, setContext] = useState<{ name?: string; email?: string } | null>(null), [error, setError] = useState<string | null>(null), [complete, setComplete] = useState(false);
    const { pending, run } = useMutation(); const api = '/api/auth/' + (purpose === 'INVITE' ? 'invitation' : 'reset-password');
    useEffect(() => { let active = true; const value = new URLSearchParams(window.location.hash.slice(1)).get('token'); setToken(value); if (!value) { setError('This link is invalid or unavailable.'); return; } requestData<{ name?: string; email?: string }>(api, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) }).then(result => { if (active) setContext(result); }).catch(() => { if (active) setError('This link is invalid, expired, or unavailable.'); }); return () => { active = false; }; }, [api]);
    return <div className="max-w-sm mx-auto space-y-4"><h1 className="text-2xl font-bold">{purpose === 'INVITE' ? 'Accept technician invitation' : 'Reset password'}</h1>{complete ? <p role="status">{purpose === 'INVITE' ? 'Account activated.' : 'Password reset.'} <Link href="/login" className="underline text-blue-700">Sign in</Link></p> : error ? <p role="alert">{error} Ask for a new link.</p> : !context ? <LoadingState label="Checking secure link…" /> : <form className={style} aria-busy={pending} onSubmit={event => { event.preventDefault(); const data = values(event.currentTarget); void run(async () => { checkPassword(data); await requestData(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, token }) }); setComplete(true); }, 'Could not complete request'); }}>{purpose === 'INVITE' && <p className="break-words [overflow-wrap:anywhere]">{context.name}<br />{context.email}<br />Role: technician</p>}<NewPasswordFields /><Button disabled={pending}>{purpose === 'INVITE' ? 'Activate account' : 'Reset password'}</Button></form>}</div>;
}
