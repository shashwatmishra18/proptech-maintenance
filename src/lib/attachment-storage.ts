import { mkdir, readFile, realpath, stat, unlink, writeFile } from 'fs/promises';
import { join, sep } from 'path';

// Shared interface for development files and production persistent private mounts.
// Ticket services use opaque stored references; they do not access this backend.
export interface AttachmentStorage {
    read(filename: string): Promise<Buffer>;
    write(filename: string, bytes: Buffer): Promise<void>;
    remove(filename: string): Promise<void>;
}

export function uploadRoot() {
    return process.env.UPLOAD_ROOT || join(process.cwd(), 'storage/uploads');
}

export function privateFileStorage(directory: string): AttachmentStorage {
    function validate(filename: string) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,200}$/.test(filename) || filename.includes('..')) throw Error('Invalid storage key');
    }
    async function existingPath(filename: string) {
        validate(filename);
        const root = await realpath(directory);
        const path = await realpath(join(root, filename));
        if (!path.startsWith(root + sep)) throw Error('Invalid storage path');
        return path;
    }
    return {
        async read(filename) {
            const path = await existingPath(filename);
            const info = await stat(path);
            if (!info.isFile() || info.size > 5 * 1024 * 1024) throw Error('Invalid stored attachment');
            return readFile(path);
        },
        async write(filename, bytes) {
            validate(filename);
            if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw Error('Invalid upload size');
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, filename), bytes, { flag: 'wx', mode: 0o600 });
        },
        async remove(filename) { await unlink(await existingPath(filename)); },
    };
}
