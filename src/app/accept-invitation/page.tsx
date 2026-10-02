import { CredentialCompletion } from '@/components/AccountForms';
export const metadata = { referrer: 'no-referrer' as const };
export default function Page() { return <CredentialCompletion purpose="INVITE" />; }
