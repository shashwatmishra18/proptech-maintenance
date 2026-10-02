import { prisma } from '../prisma';
import bcrypt from 'bcrypt';
import { AppError } from '../errors/api-response';
import { setSessionCookie } from '../auth';

export const AuthService = {
    login: async (email: string, pass: string) => {
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) throw new AppError('Invalid credentials', 400);

        const valid = await bcrypt.compare(pass, user.password);
        if (!valid) throw new AppError('Invalid credentials', 400);

        const payload = {
            userId: user.id,
            role: user.role,
            exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
        };

        await setSessionCookie(payload);

        return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
        };
    },

    register: async (email: string, pass: string, name: string) => {
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) throw new AppError('Email already exists', 400);

        const hashed = await bcrypt.hash(pass, 10);

        try { return await prisma.user.create({
            data: {
                email,
                password: hashed,
                name,
                role: 'TENANT',
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
            }
        }); } catch (error) {
            // A concurrent registration may win after the initial lookup.
            if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
                throw new AppError('Email already exists', 400);
            }
            throw error;
        }
    }
};
