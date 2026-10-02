import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface VerifiedSession extends JWTPayload {
    userId: string;
    role: 'TENANT' | 'MANAGER' | 'TECHNICIAN';
    exp: number;
    authVersion?: number;
}

export function getSessionKey() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.trim().length < 32) {
        throw new Error('JWT_SECRET must be configured with at least 32 characters');
    }
    return new TextEncoder().encode(secret);
}

export async function signToken(payload: JWTPayload) {
    return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt().setExpirationTime('7d').sign(getSessionKey());
}

export async function verifyToken(token: string) {
    const key = getSessionKey();
    try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (typeof payload.userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.userId) ||
            !['TENANT', 'MANAGER', 'TECHNICIAN'].includes(String(payload.role)) ||
            typeof payload.exp !== 'number' || (payload.authVersion !== undefined && (!Number.isSafeInteger(payload.authVersion) || Number(payload.authVersion) < 0))) return null;
        return payload as VerifiedSession;
    } catch {
        return null;
    }
}
