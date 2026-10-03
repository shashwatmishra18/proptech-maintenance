import { deliverCredential } from './credential-delivery';

// Only AccountService's manager-authorized create/renew paths use this result.
// Never use this fallback for password recovery or invitation history.
export async function deliverManagerInvitation(email: string, token: string) {
    const delivery = await deliverCredential({ purpose: 'INVITE', email, token });
    if (delivery.delivered || delivery.url || process.env.NODE_ENV !== 'production') return delivery;
    try {
        const origin = new URL(process.env.APP_ORIGIN || '');
        const local = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(origin.hostname);
        if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
            origin.protocol !== 'https:' || local) return delivery;
        const url = new URL('/accept-invitation', origin);
        // Fragments are not sent in HTTP requests or Referer headers.
        url.hash = 'token=' + token;
        return { ...delivery, url: url.toString() };
    } catch { return delivery; }
}
