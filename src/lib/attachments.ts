import { join } from 'path';
import { privateFileStorage, uploadRoot } from './attachment-storage';
import { AppError } from './errors/api-response';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const privatePrefix = '/api/attachments/files/';
const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,200}$/;

export function attachmentUrl(id: string) {
    return `/api/attachments/${encodeURIComponent(id)}`;
}

export function imageType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    return null;
}

export function storedUploadUrl(filename: string) {
    return privatePrefix + filename;
}

export async function readAttachment(storedUrl: string) {
    const legacy = storedUrl.startsWith('/uploads/');
    const prefix = legacy ? '/uploads/' : privatePrefix;
    if (!storedUrl.startsWith(prefix)) throw new AppError('Attachment not found', 404);
    const filename = storedUrl.slice(prefix.length);
    if (!filenamePattern.test(filename) || filename.includes('..')) throw new AppError('Attachment not found', 404);
    const bytes = await privateFileStorage(legacy ? (process.env.LEGACY_UPLOAD_ROOT || join(process.cwd(), 'public/uploads')) : uploadRoot()).read(filename);
    const type = imageType(bytes);
    if (!type) throw new AppError('Attachment not found', 404);
    return { bytes, type };
}

export async function validateOwnedUploads(urls: string[], userId: string) {
    for (const url of urls) {
        const filename = url.slice(privatePrefix.length);
        if (!url.startsWith(privatePrefix) || !filename.startsWith(userId + '-') ||
            !filenamePattern.test(filename) || filename.includes('..')) {
            throw new AppError('Invalid attachment', 400);
        }
        try { await readAttachment(url); } catch { throw new AppError('Invalid attachment', 400); }
    }
}

// Serialize attachment consumption and cleanup for the same uploader. Both
// operations hold this database row lock until their transaction completes.
export async function lockUploader(db: Prisma.TransactionClient, userId: string) {
    await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}

export async function cleanupUnattachedUploads(urls: string[], userId: string) {
    if (urls.length === 0) return;
    await prisma.$transaction(async db => {
        await lockUploader(db, userId);
        for (const url of Array.from(new Set(urls))) {
            const filename = url.slice(privatePrefix.length);
            if (!url.startsWith(privatePrefix) || !filename.startsWith(userId + '-') ||
                !filenamePattern.test(filename) || filename.includes('..')) throw new AppError('Invalid attachment', 400);
            if (await db.ticketImage.findFirst({ where: { imageUrl: url }, select: { id: true } })) continue;
            try {
                await privateFileStorage(uploadRoot()).remove(filename);
            } catch (error) {
                if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue;
                throw error;
            }
        }
    });
}
