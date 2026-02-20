import { removeSessionCookie } from '@/lib/auth';
import { successResponse } from '@/lib/errors/api-response';

export async function POST() {
    removeSessionCookie();
    return successResponse({ message: 'Logged out' });
}
