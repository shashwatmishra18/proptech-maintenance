'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMutation } from '@/hooks/use-mutation';
import { requestData } from '@/lib/client-request';
import { useToast } from '@/hooks/use-toast';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const { toast } = useToast();
    const router = useRouter();
    const { pending, run } = useMutation();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        await run(async () => {
            const user = await requestData<{ role: string }>('/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            toast({ title: 'Login successful' });
            router.push(user.role === 'MANAGER' ? '/manager/dashboard' : user.role === 'TECHNICIAN' ? '/tech/dashboard' : '/dashboard');
            router.refresh();
        }, 'Login failed');
    };

    return (
        <div className="flex justify-center items-center min-h-[80vh]">
            <Card className="w-full max-w-sm">
                <CardHeader>
                    <CardTitle className="text-2xl">Login</CardTitle>
                    <CardDescription>Enter your credentials to access your account</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                        </div>
                        <Button type="submit" disabled={pending} className="w-full">Sign In</Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
