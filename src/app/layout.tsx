import './globals.css';
import localFont from 'next/font/local';
import { Navbar } from '@/components/Navbar';
import { Toaster } from '@/components/ui/toaster';

// Use the bundled font so clean builds do not require Google Fonts access.
const font = localFont({ src: './fonts/GeistVF.woff', weight: '100 900' });

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
      <body className={font.className + " bg-slate-50 text-slate-900"}>
        <Navbar />
        <main className="min-h-screen px-4 py-8 md:px-8 max-w-7xl mx-auto">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
