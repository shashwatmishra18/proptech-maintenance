import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
export type CredentialDelivery = { purpose: 'INVITE' | 'RESET'; email: string; token: string };
// Future email delivery can consume this same event after the database transaction commits.
export async function deliverCredential(event: CredentialDelivery): Promise<{ url?: string; delivered: boolean }> {
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
