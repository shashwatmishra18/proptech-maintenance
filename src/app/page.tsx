import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export default async function Home() {
    const session = await getSession();
    if (session) redirect(session.role === 'MANAGER' ? '/manager/dashboard' : session.role === 'TECHNICIAN' ? '/tech/dashboard' : '/dashboard');
    return <section className="max-w-2xl mx-auto rounded-xl border bg-white p-6 sm:p-10 space-y-6 mt-8">
        <p className="text-sm font-semibold text-blue-700">PropManage</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Keep maintenance moving.</h1>
        <p className="text-slate-600 leading-relaxed">Report an issue, follow ticket updates, and coordinate repairs in one place.</p>
        <div className="flex flex-col sm:flex-row gap-3"><Button asChild className="bg-blue-600 hover:bg-blue-700"><Link href="/login">Sign in</Link></Button><Button asChild variant="outline"><Link href="/register">Create a tenant account</Link></Button></div>
        <p className="text-sm text-slate-600">Managers and technicians can sign in with their existing accounts.</p>
    </section>;
}
