import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { resendSender, type EmailSender } from './email-delivery';
export type CredentialDelivery = { purpose: 'INVITE' | 'RESET'; email: string; token: string };
// Future email delivery can consume this same event after the database transaction commits.
export async function deliverCredential(event: CredentialDelivery, sender: EmailSender = resendSender): Promise<{ url?: string; delivered: boolean; delivery?: 'development' | 'accepted' | 'failed' | 'unconfigured' }> {
    if (process.env.NODE_ENV === 'production') {
        try {
            const origin = new URL(process.env.APP_ORIGIN || '');
            if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) return { delivered: false, delivery: 'unconfigured' };
            const url = new URL(event.purpose === 'INVITE' ? '/accept-invitation' : '/reset-password', origin);
            url.hash = 'token=' + event.token;
            const invitation = event.purpose === 'INVITE';
            const delivery = await sender.send({ to: event.email, subject: invitation ? 'Your PropManage technician invitation' : 'Reset your PropManage password', text: (invitation ? 'Set your password to accept your technician invitation. This link expires in 48 hours.' : 'Use this link to reset your password. It expires in 30 minutes. If you did not request this, ignore this message.') + '\n\n' + url.toString(), idempotencyKey: createHash('sha256').update(event.purpose + event.token).digest('hex') });
            console.info(JSON.stringify({ event: 'credential_delivery', result: delivery }));
            return { delivered: delivery === 'accepted', delivery };
        } catch { return { delivered: false, delivery: 'failed' }; }
    }
    if (process.env.NODE_ENV !== 'development' || process.env.DEV_CREDENTIAL_LINKS !== '1') return { delivered: false };
    const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol)) throw Error('Development credential origin must be local');
    const url = new URL(event.purpose === 'INVITE' ? '/accept-invitation' : '/reset-password', origin);
    url.hash = 'token=' + event.token;
    const directory = path.join(process.cwd(), 'storage', 'dev-credentials');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, randomUUID() + '.json'), JSON.stringify({ purpose: event.purpose, email: event.email, url: url.toString() }), { mode: 0o600, flag: 'wx' });
    return { url: url.toString(), delivered: false };
}
