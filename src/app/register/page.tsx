'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardContent, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMutation } from '@/hooks/use-mutation';
import { requestData } from '@/lib/client-request';
import { useToast } from '@/hooks/use-toast';

export default function Register() {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const { toast } = useToast();
    const router = useRouter();
    const { pending, run } = useMutation();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        await run(async () => {
            await requestData('/api/auth/register', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name }),
            });
            toast({ title: 'Registration successful. Please login.' });
            router.push('/login');
        }, 'Registration failed');
    };

    return (
        <div className="flex justify-center items-center min-h-[80vh]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <h1 className="text-2xl font-semibold">Register</h1>
                    <CardDescription>Create a tenant account to report maintenance issues.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form aria-busy={pending} onSubmit={handleRegister} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="register-name">Name</Label>
                            <Input type="text" id="register-name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="register-email">Email</Label>
                            <Input type="email" id="register-email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="register-password">Password</Label>
                            <Input type="password" id="register-password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                        </div>
                        <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating account…" : "Create account"}</Button>
                    </form><p className="mt-5 text-sm text-slate-600">Already registered? <a className="text-blue-700 underline" href="/login">Sign in</a></p>
                </CardContent>
            </Card>
        </div>
    );
}
