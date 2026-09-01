'use client';

/**
 * app/page.tsx
 * Modern, business-facing landing page and quick session launcher for Collabo.
 */
import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Users,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Zap,
  Layers,
  Clock,
  Laptop,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Code2,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getStoredDisplayName, setStoredDisplayName } from '@/lib/session';
import { useToast } from '@/components/ui/Toast';

export default function HomePage() {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'host' | 'join'>('host');
  const [hostName, setHostName] = useState('');
  const [joinMeetingId, setJoinMeetingId] = useState('');
  const [joinAuthCode, setJoinAuthCode] = useState('');
  const [joinName, setJoinName] = useState('');

  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // Pre-fill display name from sessionStorage if previously used
  useEffect(() => {
    const savedName = getStoredDisplayName();
    if (savedName) {
      setHostName(savedName);
      setJoinName(savedName);
    }
  }, []);

  const handleHostMeeting = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!hostName.trim()) {
      showToast('Please enter your presenter name', 'error');
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
        window.location.href = `/room/${data.meetingId}?name=${encodeURIComponent(
          hostName.trim()
        )}&code=${encodeURIComponent(data.authCode)}`;
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

    window.location.href = `/room/${trimmedId}?name=${encodeURIComponent(
      trimmedName
    )}&code=${encodeURIComponent(trimmedCode)}`;
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Business Navigation Bar */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-sm">
              <Monitor className="w-4 h-4" />
            </div>
            <span className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              Collabo
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Enterprise SFU
              </span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">
              Platform Features
            </a>
            <a href="#architecture" className="hover:text-white transition-colors">
              SFU Topology
            </a>
            <a href="#desktop-app" className="hover:text-white transition-colors">
              Desktop OS Overlay
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setActiveTab('join');
                window.scrollTo({ top: 150, behavior: 'smooth' });
              }}
              className="text-xs font-medium"
            >
              Join Session
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setActiveTab('host');
                window.scrollTo({ top: 150, behavior: 'smooth' });
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md"
            >
              Host Meeting
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative px-6 pt-16 pb-20 max-w-7xl mx-auto w-full flex flex-col items-center text-center">
        {/* Decorative subtle backdrop glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-blue-600/10 blur-[120px] pointer-events-none -z-10 rounded-full" />

        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-medium mb-6 shadow-inner">
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>Real-Time Screen Collaboration & Live OS Desktop Overlay</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white max-w-4xl leading-[1.1] mb-6">
          High-Bandwidth Screen Sharing &{' '}
          <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-blue-500 bg-clip-text text-transparent">
            Multi-User Live Annotation
          </span>
        </h1>

        <p className="text-zinc-400 text-base sm:text-lg max-w-2xl leading-relaxed mb-12">
          Engineered for engineering design reviews, pair programming, and product walkthroughs. Zero installation for participants, native hardware click-through OS overlay for presenters, and star-topology SFU routing.
        </p>

        {/* Dual Mode Session Launch Card */}
        <div className="w-full max-w-xl bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl text-left">
          {/* Tab Switcher */}
          <div className="grid grid-cols-2 p-1 bg-zinc-950 rounded-xl border border-zinc-800/80 mb-6">
            <button
              type="button"
              onClick={() => setActiveTab('host')}
              className={`py-2 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'host'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Host Session
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('join')}
              className={`py-2 px-4 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2 ${
                activeTab === 'join'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Join Session
            </button>
          </div>

          {activeTab === 'host' ? (
            <form onSubmit={handleHostMeeting} className="space-y-4">
              <Input
                label="Your Presenter Name"
                placeholder="e.g. Rayian Mahi"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                required
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                isLoading={isCreating}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl shadow-lg"
              >
                Create Instant Session <ArrowRight className="w-4 h-4 ml-2" />
              </Button>

              <div className="pt-2 flex items-center justify-between text-[11px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-400" /> Ephemeral 6-char Auth Code
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-blue-400" /> Up to 10 Attendees
                </span>
              </div>
            </form>
          ) : (
            <form onSubmit={handleJoinMeeting} className="space-y-4">
              <Input
                label="Meeting ID"
                placeholder="e.g. c5284ca8"
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
                type="submit"
                variant="secondary"
                size="lg"
                isLoading={isJoining}
                className="w-full font-semibold py-3 rounded-xl shadow-lg"
              >
                Join Meeting <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          )}
        </div>
      </section>

      {/* Enterprise Feature Matrix */}
      <section id="features" className="px-6 py-20 border-t border-zinc-900 bg-zinc-950/60">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-16 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wider text-blue-400 font-bold">
              Core Capabilities
            </h2>
            <h3 className="text-3xl font-bold tracking-tight text-white">
              Built for Real-Time Technical Collaboration
            </h3>
            <p className="text-sm text-zinc-400">
              A deliberately focused platform delivering zero latency, uncluttered visuals, and deep OS integration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                <Laptop className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">Native OS Click-Through Overlay</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Collabo Desktop renders viewers' drawings directly over the presenter's active Windows & Mac screen, allowing seamless interaction with IDEs and native apps.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Zap className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">Mediasoup SFU Star Routing</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Server-relayed WebRTC media distribution eliminates mesh bandwidth bottlenecks, delivering crisp 4K screen sharing and low-latency voice conferencing.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-purple-600/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
                <Clock className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">5.0s Ephemeral Stroke TTL</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Strokes remain solid for 5.0 seconds before smoothly blurring and fading away over 0.5s, preventing screen clutter during rapid technical reviews.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-amber-600/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">Resolution-Independent Sync</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Normalized coordinate mapping $(0.0 - 1.0)$ guarantees millimeter precision across different display aspect ratios, resolutions, and devices.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-cyan-600/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">Invite-Only Security</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Rooms exist strictly in server memory with 6-character auth codes and a hard 10-participant capacity limit. No user accounts or persistent logs.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800/80 space-y-4 hover:border-zinc-700 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-rose-600/10 border border-rose-500/20 text-rose-400 flex items-center justify-center">
                <Code2 className="w-5 h-5" />
              </div>
              <h4 className="text-base font-semibold text-white">Smooth Presenter Handoff</h4>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Transfer host privileges to any participant instantly. Deep link protocols (`collabo://`) enable rapid presenter transitions without call restarts.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture & Desktop Deep Dive Section */}
      <section id="desktop-app" className="px-6 py-20 border-t border-zinc-900 bg-zinc-950">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono">
              COLLABO DESKTOP
            </div>
            <h3 className="text-3xl font-bold tracking-tight text-white leading-tight">
              Two-Window Native Architecture for Zero Input Obstruction
            </h3>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Standard web browsers cannot render graphics outside their active tab. Collabo Desktop decouples the presenter interface into two synchronized native windows:
            </p>

            <ul className="space-y-3.5 text-xs text-zinc-300">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Framed Host Controller:</strong> Monitor picker, microphone mute, attendee roster, and host handoff controls.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Click-Through Transparent Overlay:</strong> Frameless, always-on-top window forwarding all clicks and keystrokes directly to underlying desktop applications.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Content Protection:</strong> Excludes overlay strokes from being captured into the outgoing video stream, eliminating recursive visual loops.
                </span>
              </li>
            </ul>
          </div>

          {/* Code/Architecture Diagram Box */}
          <div className="p-6 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl font-mono text-xs text-zinc-300 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 text-zinc-500">
              <span>mediasoup-sfu-topology.ts</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">STAR SFU</span>
            </div>
            <div className="space-y-2 text-zinc-400">
              <p className="text-blue-400">// Mediasoup SFU Star Transport Configuration</p>
              <p>const router = await worker.createRouter(&#123; mediaCodecs &#125;);</p>
              <p>const hostSendTransport = await router.createWebRtcTransport(&#123; ... &#125;);</p>
              <p>const screenVideoProducer = await hostSendTransport.produce(&#123; kind: 'video' &#125;);</p>
              <p className="text-zinc-600">// Broadcast to N viewers with 0 transcoding overhead</p>
              <p>viewers.forEach(v =&gt; v.recvTransport.consume(&#123; producerId: screenVideoProducer.id &#125;));</p>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise Footer */}
      <footer className="mt-auto border-t border-zinc-900 bg-zinc-950 px-6 py-12 text-zinc-500 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Monitor className="w-3.5 h-3.5" />
            </div>
            <span className="font-semibold text-zinc-300">Collabo Platform</span>
            <span>— Open-source Screen-Draw Collaboration</span>
          </div>

          <div className="flex items-center gap-6">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-300 transition-colors"
            >
              GitHub Repository
            </a>
            <span className="text-zinc-800">•</span>
            <span>MIT License</span>
            <span className="text-zinc-800">•</span>
            <span>Rayian Mahi (rbsmahi@gmail.com)</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
