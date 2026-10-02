export type EmailMessage = { to: string; subject: string; text: string; idempotencyKey: string };
export type EmailResult = 'accepted' | 'failed' | 'unconfigured';
export interface EmailSender { send(message: EmailMessage): Promise<EmailResult> }
// Provider-specific transport stays behind this interface. Never log request bodies or provider errors.
export const resendSender: EmailSender = {
    async send(message) {
        if (process.env.EMAIL_PROVIDER !== 'resend' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return 'unconfigured';
        try {
            const response = await fetch('https://api.resend.com/emails', {
                method: 'POST', signal: AbortSignal.timeout(8000),
                headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
                body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
            });
            if (!response.ok) return 'failed';
            const result: unknown = await response.json();
            return result && typeof result === 'object' && 'id' in result && typeof result.id === 'string' ? 'accepted' : 'failed';
        } catch { return 'failed'; }
    },
};
