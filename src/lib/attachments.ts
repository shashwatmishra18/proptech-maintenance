import { readFile, realpath, stat } from 'fs/promises';
import { join, sep } from 'path';
import { AppError } from './errors/api-response';

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
    const root = await realpath(join(process.cwd(), legacy ? 'public/uploads' : 'storage/uploads'));
    const path = await realpath(join(root, filename));
    if (!path.startsWith(root + sep)) throw new AppError('Attachment not found', 404);
    const info = await stat(path);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new AppError('Attachment not found', 404);
    const bytes = await readFile(path);
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
