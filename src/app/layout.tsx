import './globals.css';
import { Inter } from 'next/font/google';
import { Navbar } from '@/components/Navbar';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'PropManage - Maintenance App',
  description: 'A mobile-first property maintenance management system.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className + " bg-slate-50 text-slate-900"}>
        <Navbar />
        <main className="min-h-screen px-4 py-8 md:px-8 max-w-7xl mx-auto">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
