import Link from 'next/link';
import { Button } from './ui/button';
import { getSession } from '@/lib/auth';
import { NotificationBell } from './NotificationBell';
import { LogoutButton } from './LogoutButton';
import { NavLink } from './NavLink';

export async function Navbar() {
    const session = await getSession();

    let dashboardPath = '/dashboard';
    if (session?.role === 'MANAGER') dashboardPath = '/manager/dashboard';
    if (session?.role === 'TECHNICIAN') dashboardPath = '/tech/dashboard';

    return (
        <nav aria-label="Main navigation" className="border-b bg-white shadow-sm px-4 sm:px-6 py-3 flex flex-wrap gap-3 items-center justify-between">
            <Link href={session ? dashboardPath : '/'} className="text-xl font-bold tracking-tight text-blue-600">
                FixNest
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                {session ? (
                    <>
                        <NavLink href={dashboardPath}>Dashboard</NavLink>
                        {session.role === 'MANAGER' && <NavLink href="/manager/properties">Properties</NavLink>}
                        {session.role === 'MANAGER' && <NavLink href="/manager/staff">Staff</NavLink>}
                        <NavLink href="/account">Account</NavLink>
                        <NotificationBell />
                        <span className="hidden sm:inline text-sm text-slate-600 capitalize">{session.role.toLowerCase()}</span>
                        <LogoutButton />
                    </>
                ) : (
                    <>
                        <Button asChild variant="outline" size="sm"><Link href="/login">Sign in</Link></Button>
                        <Button asChild size="sm"><Link href="/register">Register</Link></Button>
                    </>
                )}
            </div>
        </nav>
    );
}
