import { z } from 'zod';
export const passwordPolicy = z.string().min(10, 'Use at least 10 characters').refine(value => value.trim().length > 0, 'Password cannot be blank').refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const passwordConfirmation = z.object({ password: passwordPolicy, confirmation: z.string() }).strict().refine(value => value.password === value.confirmation, 'Passwords must match');
