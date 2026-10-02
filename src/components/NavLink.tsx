'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
    const pathname = usePathname();
    const active = pathname === href || (href === '/manager/properties' && pathname.startsWith(href + '/'));
    return <Link href={href} aria-current={active ? 'page' : undefined} className={'inline-flex min-h-11 items-center rounded-md px-2.5 text-sm font-medium transition-colors ' + (active ? 'bg-blue-50 text-blue-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950')}>{children}</Link>;
}
