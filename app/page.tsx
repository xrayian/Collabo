/**
 * app/page.tsx
 * Landing page: Host a new meeting or Join an existing meeting.
 */
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Monitor, Users, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getStoredDisplayName, setStoredDisplayName } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';

export default function HomePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [hostName, setHostName] = useState('');
  const [joinMeetingId, setJoinMeetingId] = useState('');
  const [joinAuthCode, setJoinAuthCode] = useState('');
  const [joinName, setJoinName] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // Pre-fill display name from sessionStorage if available
  useEffect(() => {
    const savedName = getStoredDisplayName();
    if (savedName) {
      setHostName(savedName);
      setJoinName(savedName);
    }
  }, []);

  const handleHostMeeting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostName.trim()) {
      showToast('Please enter your display name', 'error');
      return;
    }

    setIsCreating(true);
    setStoredDisplayName(hostName.trim());

    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();
      if (data.success && data.meetingId && data.authCode) {
        window.location.href = `/room/${data.meetingId}?name=${encodeURIComponent(hostName.trim())}&code=${encodeURIComponent(data.authCode)}`;
      } else {
        showToast(data.error || 'Failed to create meeting', 'error');
        setIsCreating(false);
      }
    } catch (err: any) {
      showToast(err.message || 'Network error creating meeting', 'error');
      setIsCreating(false);
    }
  };

  const handleJoinMeeting = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedId = joinMeetingId.trim();
    const trimmedCode = joinAuthCode.trim().toUpperCase();
    const trimmedName = joinName.trim();

    if (!trimmedId) {
      showToast('Please enter the Meeting ID', 'error');
      return;
    }
    if (!trimmedCode) {
      showToast('Please enter the 6-character Auth Code', 'error');
      return;
    }
    if (!trimmedName) {
      showToast('Please enter your display name', 'error');
      return;
    }

    setIsJoining(true);
    setStoredDisplayName(trimmedName);

    window.location.href = `/room/${trimmedId}?name=${encodeURIComponent(trimmedName)}&code=${encodeURIComponent(trimmedCode)}`;
  };

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 sm:p-8">
      {/* Brand Header */}
      <div className="text-center max-w-xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 font-medium mb-4">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          SFU-Powered Screen Draw & Voice Platform
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-3">
          Collabo
        </h1>
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
          One person shares screen, everyone annotates in real time, and everyone communicates over clear audio. Capped at 10 participants.
        </p>
      </div>

      {/* Main Action Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
        {/* Host Meeting Card */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 flex flex-col justify-between shadow-xl">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
              <Monitor className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-1">Host a Meeting</h2>
            <p className="text-xs text-zinc-400 mb-6">
              Create an instant meeting room and receive a shareable link and 6-character auth code.
            </p>

            <form onSubmit={handleHostMeeting} className="space-y-4">
              <Input
                label="Your Display Name"
                placeholder="e.g. Rayian"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                required
              />

              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleHostMeeting}
                isLoading={isCreating}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Host Meeting <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </form>
          </div>
        </div>

        {/* Join Meeting Card */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 flex flex-col justify-between shadow-xl">
          <div>
            <div className="w-10 h-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
              <Users className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-1">Join a Meeting</h2>
            <p className="text-xs text-zinc-400 mb-6">
              Enter the meeting ID and the 6-character auth code provided by your host.
            </p>

            <form onSubmit={handleJoinMeeting} className="space-y-3.5">
              <Input
                label="Meeting ID"
                placeholder="e.g. e4f91b2c"
                value={joinMeetingId}
                onChange={(e) => setJoinMeetingId(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Auth Code"
                  placeholder="6-CHARS"
                  maxLength={6}
                  value={joinAuthCode}
                  onChange={(e) => setJoinAuthCode(e.target.value.toUpperCase())}
                  monospace
                  required
                />
                <Input
                  label="Your Name"
                  placeholder="e.g. Alex"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  required
                />
              </div>

              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={handleJoinMeeting}
                isLoading={isJoining}
                className="w-full mt-2 font-semibold"
              >
                Join Meeting
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Feature Pills Footer */}
      <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-zinc-400" /> Invite-only auth codes
        </span>
        <span className="flex items-center gap-1.5">
          <Monitor className="w-4 h-4 text-zinc-400" /> Star topology SFU
        </span>
        <span className="flex items-center gap-1.5">
          <Users className="w-4 h-4 text-zinc-400" /> Max 10 concurrent peers
        </span>
      </div>
    </main>
  );
}
