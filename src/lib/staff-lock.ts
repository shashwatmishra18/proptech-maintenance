import type { Prisma } from '@prisma/client';
export async function lockStaff(db: Prisma.TransactionClient, id: string) {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;
}
