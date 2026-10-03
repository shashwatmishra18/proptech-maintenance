import { prisma } from '../prisma';
import { AppError } from '../errors/api-response';
import { lockStaff } from '../staff-lock';
import { passwordConfirmation, passwordPolicy } from '../password-policy';
import { deliverCredential } from '../credential-delivery';
import { deliverManagerInvitation } from '../invitation-delivery';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { z } from 'zod';

export const profileInput = z.object({ name: z.string().trim().min(2).max(100) }).strict();
export const inviteInput = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254) }).strict();
export const tokenInput = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid or unavailable link');
export const completeInput = z.object({ token: tokenInput, password: passwordPolicy, confirmation: z.string() }).strict().refine(value => value.password === value.confirmation, 'Passwords must match');
export const changeInput = z.object({ currentPassword: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Current password must not exceed 72 UTF-8 bytes'), password: passwordPolicy, confirmation: z.string() }).strict().refine(value => value.password === value.confirmation, 'Passwords must match');
export const statusInput = z.object({ active: z.boolean(), expectedVersion: z.number().int().min(0) }).strict();
export const accountSelect = { id: true, name: true, email: true, role: true, active: true, authVersion: true } as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const unavailable = () => new AppError('This link is invalid, expired, or unavailable.', 400);
const recoveryMessage = 'If the account is eligible, a recovery request has been recorded. Check your email if delivery is available, or contact your operator for help.';

export const AccountService = {
    profile: (id: string) => prisma.user.findUniqueOrThrow({ where: { id }, select: accountSelect }),
    updateProfile: (id: string, name: string) => prisma.user.update({ where: { id }, data: { name }, select: accountSelect }),
    staff: async (managerId: string) => ({
        technicians: (await prisma.user.findMany({ where: { onboardedById: managerId, role: 'TECHNICIAN' }, select: { ...accountSelect, credentialTokens: { where: { purpose: 'INVITE', usedAt: { not: null } }, select: { id: true }, take: 1 } }, orderBy: { name: 'asc' } })).map(({ credentialTokens, ...user }) => ({ ...user, invitationAccepted: credentialTokens.length > 0 })),
        invitations: await prisma.credentialToken.findMany({ where: { createdById: managerId, purpose: 'INVITE' }, select: { id: true, email: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
    }),
    invite: async (managerId: string, input: z.infer<typeof inviteInput>) => {
        const token = randomBytes(32).toString('hex');
        const unusablePassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
        try {
            const invitation = await prisma.$transaction(async db => {
                const existing = await db.user.findUnique({ where: { email: input.email } });
                if (existing) throw new AppError('An account or invitation already uses this email.', 409);
                const user = await db.user.create({ data: { ...input, password: unusablePassword, role: 'TECHNICIAN', active: false, onboardedById: managerId } });
                const invitation = await db.credentialToken.create({ data: { tokenHash: hashToken(token), purpose: 'INVITE', email: user.email, role: 'TECHNICIAN', userId: user.id, authVersion: user.authVersion, createdById: managerId, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }, select: { id: true, expiresAt: true } });
                await db.accountEvent.create({ data: { userId: user.id, actorId: managerId, action: 'STAFF_INVITED' } });
                return invitation;
            });
            const delivery = await deliverManagerInvitation(input.email, token);
            return { ...invitation, ...delivery };
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new AppError('An account or invitation already uses this email.', 409);
            throw error;
        }
    },
    revoke: (managerId: string, id: string) => prisma.$transaction(async db => {
        const record = await db.credentialToken.findFirst({ where: { id, createdById: managerId, purpose: 'INVITE' } });
        if (!record) throw new AppError('Invitation not found', 404);
        await lockStaff(db, record.userId);
        const result = await db.credentialToken.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        if (!result.count) throw new AppError('Invitation is no longer pending', 409);
        await db.accountEvent.create({ data: { userId: record.userId, actorId: managerId, action: 'INVITE_REVOKED' } });
        return { revoked: true };
    }),
    renew: async (managerId: string, id: string) => {
        const token = randomBytes(32).toString('hex');
        const result = await prisma.$transaction(async db => {
            const record = await db.credentialToken.findFirst({ where: { id, createdById: managerId, purpose: 'INVITE', usedAt: null } });
            if (!record) throw new AppError('Invitation not found', 404);
            await lockStaff(db, record.userId);
            const user = await db.user.findUniqueOrThrow({ where: { id: record.userId } });
            if (user.active || user.role !== 'TECHNICIAN' || user.onboardedById !== managerId || await db.credentialToken.findFirst({ where: { userId: user.id, purpose: 'INVITE', usedAt: { not: null } } })) throw new AppError('Invitation cannot be renewed.', 409);
            await db.credentialToken.updateMany({ where: { userId: user.id, purpose: 'INVITE', usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
            const invitation = await db.credentialToken.create({ data: { tokenHash: hashToken(token), purpose: 'INVITE', email: user.email, role: 'TECHNICIAN', userId: user.id, authVersion: user.authVersion, createdById: managerId, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) }, select: { id: true, expiresAt: true } });
            await db.accountEvent.create({ data: { userId: user.id, actorId: managerId, action: 'INVITE_REISSUED' } });
            return { ...invitation, email: user.email };
        });
        return { id: result.id, expiresAt: result.expiresAt, ...await deliverManagerInvitation(result.email, token) };
    },
    context: async (token: string, purpose: 'INVITE' | 'RESET') => {
        const record = await prisma.credentialToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
        if (!record || record.purpose !== purpose || record.usedAt || record.revokedAt || record.expiresAt <= new Date() || record.email !== record.user.email || record.role !== record.user.role || record.authVersion !== record.user.authVersion || (purpose === 'INVITE' ? record.user.active || record.user.role !== 'TECHNICIAN' : !record.user.active)) throw unavailable();
        return purpose === 'INVITE' ? { name: record.user.name, email: record.email, role: 'TECHNICIAN' } : { valid: true };
    },
    complete: async (input: z.infer<typeof completeInput>, purpose: 'INVITE' | 'RESET') => {
        passwordConfirmation.parse({ password: input.password, confirmation: input.confirmation });
        const password = await bcrypt.hash(input.password, 10);
        return prisma.$transaction(async db => {
            const record = await db.credentialToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
            if (!record || record.purpose !== purpose) throw unavailable();
            await lockStaff(db, record.userId);
            const user = await db.user.findUniqueOrThrow({ where: { id: record.userId } });
            if (user.email !== record.email || user.role !== record.role || user.authVersion !== record.authVersion || (purpose === 'INVITE' ? user.active || user.role !== 'TECHNICIAN' : !user.active)) throw unavailable();
            const consumed = await db.credentialToken.updateMany({ where: { id: record.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
            if (consumed.count !== 1) throw unavailable();
            await db.user.update({ where: { id: user.id }, data: { password, active: true, authVersion: { increment: 1 } } });
            await db.credentialToken.updateMany({ where: { userId: user.id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
            await db.accountEvent.create({ data: { userId: user.id, actorId: user.id, action: purpose === 'INVITE' ? 'INVITE_ACCEPTED' : 'PASSWORD_RESET' } });
            return { completed: true };
        });
    },
    requestReset: async (email: string) => {
        const token = randomBytes(32).toString('hex');
        const user = await prisma.user.findUnique({ where: { email } });
        if (user?.active) {
            const created = await prisma.$transaction(async db => {
                await lockStaff(db, user.id);
                const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
                if (!current.active) return false;
                await db.credentialToken.updateMany({ where: { userId: user.id, purpose: 'RESET', usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
                await db.credentialToken.create({ data: { tokenHash: hashToken(token), purpose: 'RESET', email: current.email, role: current.role, userId: current.id, authVersion: current.authVersion, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
                return true;
            });
            if (created) await deliverCredential({ purpose: 'RESET', email, token });
        }
        return { message: recoveryMessage };
    },
    changePassword: async (id: string, version: number, input: z.infer<typeof changeInput>) => {
        passwordConfirmation.parse({ password: input.password, confirmation: input.confirmation });
        const password = await bcrypt.hash(input.password, 10);
        return prisma.$transaction(async db => {
            await lockStaff(db, id);
            const user = await db.user.findUniqueOrThrow({ where: { id } });
            if (!user.active || user.authVersion !== version) throw new AppError('Session expired. Sign in again.', 401);
            if (!await bcrypt.compare(input.currentPassword, user.password)) throw new AppError('Current password is incorrect', 400);
            await db.user.update({ where: { id }, data: { password, authVersion: { increment: 1 } } });
            await db.credentialToken.updateMany({ where: { userId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
            await db.accountEvent.create({ data: { userId: id, actorId: id, action: 'PASSWORD_CHANGED' } });
            return { changed: true };
        });
    },
    status: (managerId: string, id: string, input: z.infer<typeof statusInput>) => prisma.$transaction(async db => {
        await lockStaff(db, id);
        const user = await db.user.findUnique({ where: { id } });
        if (!user || user.role !== 'TECHNICIAN' || user.onboardedById !== managerId) throw new AppError('Technician not found', 404);
        if (user.authVersion !== input.expectedVersion || user.active === input.active) throw new AppError('Account changed. Refresh and retry.', 409);
        if (input.active && !await db.credentialToken.findFirst({ where: { userId: id, purpose: 'INVITE', usedAt: { not: null } } })) throw new AppError('The technician must accept their invitation first.', 409);
        if (!input.active && await db.ticket.count({ where: { assignedToId: id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } })) throw new AppError('Reassign all active work before deactivation.', 409);
        await db.user.update({ where: { id }, data: { active: input.active, authVersion: { increment: 1 } } });
        await db.credentialToken.updateMany({ where: { userId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        await db.accountEvent.create({ data: { userId: id, actorId: managerId, action: input.active ? 'STAFF_REACTIVATED' : 'STAFF_DEACTIVATED' } });
        return db.user.findUniqueOrThrow({ where: { id }, select: accountSelect });
    }),
};
