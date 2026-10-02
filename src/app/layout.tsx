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
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4 focus:underline">Skip to content</a>
        <Navbar />
        <main id="main-content" tabIndex={-1} className="min-h-screen px-4 py-6 md:py-8 md:px-8 max-w-7xl mx-auto">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
