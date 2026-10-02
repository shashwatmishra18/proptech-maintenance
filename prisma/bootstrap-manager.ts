import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { passwordPolicy } from '../src/lib/password-policy';

export const bootstrapSchema = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().email().max(254),
    password: passwordPolicy,
}).strict();

export async function bootstrapManager(db: PrismaClient, input: unknown) {
    const data = bootstrapSchema.parse(input);
    if (await db.user.findUnique({ where: { email: data.email } })) throw Error('Account already exists; no changes made');
    const password = await bcrypt.hash(data.password, 12);
    return db.user.create({ data: { ...data, password, role: 'MANAGER' }, select: { id: true } });
}

if (require.main === module) {
    if (!process.argv.includes('--confirm-bootstrap')) {
        console.error('Explicit --confirm-bootstrap required. Supply JSON through standard input; never use password arguments.');
        process.exitCode = 1;
    } else {
        const db = new PrismaClient({ log: [] });
        (async () => {
            let input = '';
            for await (const chunk of process.stdin) {
                input += chunk;
                if (Buffer.byteLength(input) > 4096) throw Error('Input too large');
            }
            await bootstrapManager(db, JSON.parse(input));
            console.info('Manager created. No other accounts modified.');
        })().catch(() => { console.error('Bootstrap failed: check input, unique email, password policy and database access. No existing account overwritten.'); process.exitCode = 1; }).finally(() => db.$disconnect());
    }
}
