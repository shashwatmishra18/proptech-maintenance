import { prisma } from '@/lib/prisma';
import type { VerifiedSession } from './session';
export async function validateAccountSession(payload: VerifiedSession | null) {
    if (!payload) return null;
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { active: true, authVersion: true, role: true } });
    if (!user || !user.active || user.role !== payload.role || user.authVersion !== (payload.authVersion ?? 0)) return null;
    return payload;
}
