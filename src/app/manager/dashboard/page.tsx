import { Suspense } from 'react';
import { LoadingState } from '@/components/RequestState';
import { Dashboard } from '@/components/Dashboard';

export default function Page() { return <Suspense fallback={<LoadingState label="Loading ticket dashboard…" />}><Dashboard role="MANAGER" /></Suspense>; }
