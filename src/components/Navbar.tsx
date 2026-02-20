import Link from 'next/link';
import { Button } from './ui/button';
import { getSession } from '@/lib/auth';
import { NotificationBell } from './NotificationBell';

export async function Navbar() {
    const session = await getSession();

    let dashboardPath = '/dashboard';
    if (session?.role === 'MANAGER') dashboardPath = '/manager/dashboard';
    if (session?.role === 'TECHNICIAN') dashboardPath = '/tech/dashboard';

    return (
        <nav className="border-b bg-white shadow-sm px-6 py-4 flex items-center justify-between">
            <Link href={session ? dashboardPath : '/'} className="text-xl font-bold tracking-tight text-blue-600">
                PropManage
            </Link>
            <div className="flex items-center space-x-4">
                {session ? (
                    <>
                        <NotificationBell />
                        <div className="text-sm font-medium mr-4">Role: {session.role}</div>
                        <form action="/api/auth/logout" method="POST">
                            <Button type="submit" variant="outline" size="sm">Logout</Button>
                        </form>
                    </>
                ) : (
                    <>
                        <Link href="/login">
                            <Button variant="outline" size="sm">Login</Button>
                        </Link>
                        <Link href="/register">
                            <Button size="sm">Register</Button>
                        </Link>
                    </>
                )}
            </div>
        </nav>
    );
}
