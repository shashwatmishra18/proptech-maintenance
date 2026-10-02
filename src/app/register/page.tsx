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
                    <CardTitle className="text-2xl">Register</CardTitle>
                    <CardDescription>Create a new demo account</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleRegister} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Name</Label>
                            <Input type="text" value={name} onChange={e => setName(e.target.value)} required minLength={2} />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
                        </div>
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
                        </div>
                        <Button type="submit" disabled={pending} className="w-full">Register</Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
