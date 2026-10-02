import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { requireRole } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';
import { imageType, storedUploadUrl } from '@/lib/attachments';

export async function POST(req: NextRequest) {
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
        const root = join(process.cwd(), 'storage/uploads');
        await mkdir(root, { recursive: true });
        const imageUrls = [];
        for (const file of validated) {
            const filename = session.userId + '-' + randomUUID() + '.' + file.extension;
            await writeFile(join(root, filename), file.bytes, { flag: 'wx' });
            imageUrls.push(storedUploadUrl(filename));
        }
        return successResponse({ imageUrls });
    } catch {
        return errorResponse('Upload failed', 500);
    }
}
