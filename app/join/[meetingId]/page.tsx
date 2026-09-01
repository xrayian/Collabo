/**
 * app/join/[meetingId]/page.tsx
 * Direct Join page for invited participants.
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Users, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getStoredDisplayName, setStoredDisplayName } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';

export default function JoinMeetingPage() {
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();

  const meetingId = (params.meetingId as string) || '';

  const [name, setName] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    const savedName = getStoredDisplayName();
    if (savedName) {
      setName(savedName);
    }
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedCode = authCode.trim().toUpperCase();

    if (!trimmedName) {
      showToast('Please enter your display name', 'error');
      return;
    }
    if (!trimmedCode) {
      showToast('Please enter the 6-character auth code', 'error');
      return;
    }

    setIsJoining(true);
    setStoredDisplayName(trimmedName);

    window.location.href = `/room/${meetingId}?name=${encodeURIComponent(trimmedName)}&code=${encodeURIComponent(trimmedCode)}`;
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Join Meeting</h1>
            <p className="text-xs text-zinc-400 font-mono">ID: {meetingId}</p>
          </div>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <Input
            label="Your Display Name"
            placeholder="e.g. Rayian"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />

          <Input
            label="6-Character Auth Code"
            placeholder="9F2K7Q"
            maxLength={6}
            value={authCode}
            onChange={(e) => setAuthCode(e.target.value.toUpperCase())}
            monospace
            required
          />

          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleJoin}
            isLoading={isJoining}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold mt-2"
          >
            Enter Call <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </form>
      </div>
    </main>
  );
}
