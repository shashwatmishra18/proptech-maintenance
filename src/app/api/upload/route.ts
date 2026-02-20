import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { requireAuth } from '@/lib/roles';
import { errorResponse, successResponse } from '@/lib/errors/api-response';

export async function POST(req: NextRequest) {
    try {
        const session = await requireAuth(req);
        if (session instanceof NextResponse) return session;

        const formData = await req.formData();
        const files = formData.getAll('file') as File[];

        if (!files || files.length === 0) {
            return errorResponse('No files uploaded', 400);
        }
        if (files.length > 5) {
            return errorResponse('Max 5 images allowed', 400);
        }

        const uploadDir = join(process.cwd(), 'public/uploads');

        try {
            await mkdir(uploadDir, { recursive: true });
        } catch (err) {
            // Ignore if exists
        }

        const imageUrls: string[] = [];

        for (const file of files) {
            if (!file.type.startsWith('image/jpeg') && !file.type.startsWith('image/png')) {
                return errorResponse('Only JPG/PNG allowed', 400);
            }
            if (file.size > 5 * 1024 * 1024) {
                return errorResponse('Max 5MB per file', 400);
            }

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);

            const fileName = `${Date.now()}-${session.userId}-${file.name.replace(/[^a-zA-Z0-9.\-]/g, '')}`;
            const path = join(uploadDir, fileName);

            await writeFile(path, buffer);
            imageUrls.push(`/uploads/${fileName}`);
        }

        return successResponse({ imageUrls });
    } catch (error: any) {
        console.error(error);
        return errorResponse('Upload failed', 500);
    }
}
