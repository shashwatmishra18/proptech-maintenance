import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { privateFileStorage, uploadRoot } from '@/lib/attachment-storage';
import { z } from 'zod';
import { requireRole } from '@/lib/roles';
import { errorResponse, successResponse, handleApiError } from '@/lib/errors/api-response';
import { imageType, storedUploadUrl, cleanupUnattachedUploads } from '@/lib/attachments';

export async function POST(req: NextRequest) {
    const written: string[] = [];
    try {
        const session = await requireRole(req, ['TENANT']);
        if (session instanceof Response) return session;
        const formData = await req.formData();
        const files = formData.getAll('file');
        if (files.length === 0 || files.length > 5) return errorResponse('Upload 1 to 5 images', 400);
        const validated = [];
        for (const file of files) {
            if (typeof file === 'string' || file.size === 0 || file.size > 5 * 1024 * 1024) {
                return errorResponse('Max 5MB per image', 400);
            }
            const bytes = Buffer.from(await file.arrayBuffer());
            const type = imageType(bytes);
            if (!type || type !== file.type) return errorResponse('Only JPG/PNG images allowed', 400);
            validated.push({ bytes, extension: type === 'image/png' ? 'png' : 'jpg' });
        }
        const root = uploadRoot();
        const storage = privateFileStorage(root);
        const imageUrls = [];
        for (const file of validated) {
            const filename = session.userId + '-' + randomUUID() + '.' + file.extension;
            const path = join(root, filename);
            try {
                await storage.write(filename, file.bytes);
            } catch (error) {
                // A failed write can leave a partial new file; never remove a pre-existing collision.
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) written.push(path);
                throw error;
            }
            written.push(path);
            imageUrls.push(storedUploadUrl(filename));
        }
        return successResponse({ imageUrls });
    } catch {
        for (const path of written) {
            try { await unlink(path); } catch (error) {
                if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
                    console.warn('Partial upload cleanup could not complete.');
                }
            }
        }
        return errorResponse('Upload failed', 500);
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await requireRole(req, ['TENANT']);
        if (session instanceof Response) return session;
        const { imageUrls } = z.object({ imageUrls: z.array(z.string().startsWith('/api/attachments/files/')).max(5) }).parse(await req.json());
        await cleanupUnattachedUploads(imageUrls, session.userId);
        return successResponse({ message: 'Unlinked uploads cleaned up' });
    } catch (error) {
        return handleApiError(error);
    }
}
