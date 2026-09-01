/**
 * app/layout.tsx
 * Root application layout.
 */
import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'Collabo — Real-time Screen-Draw & Voice Meetings',
  description: 'Invite-only, SFU-powered screen sharing with real-time multi-user drawing annotations and crystal-clear voice.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-blue-600 selection:text-white">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
