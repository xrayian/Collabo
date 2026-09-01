/**
 * app/room/[meetingId]/page.tsx
 * Active meeting room orchestrating WebSocket signaling, mediasoup SFU, live drawing,
 * audio conferencing, and presenter handoff.
 */
'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Peer, Stroke, StrokePoint, ServerMessage, ClientMessage, ServerErrorCode } from '@/lib/types';
import { MediasoupClientManager } from '@/lib/mediasoup-client';
import { ScreenView } from '@/components/room/ScreenView';
import { ControlBar } from '@/components/room/ControlBar';
import { ParticipantStrip } from '@/components/room/ParticipantStrip';
import { ColorLegend } from '@/components/room/ColorLegend';
import { MeetingInfoModal } from '@/components/room/MeetingInfoModal';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default function MeetingRoomPage() {
  const params = useParams();
  const { showToast } = useToast();

  const [meetingId, setMeetingId] = useState<string>('');
  const [authCode, setAuthCode] = useState<string>('');

  // Room State
  const [myPeerId, setMyPeerIdState] = useState<string>('');
  const myPeerIdRef = useRef<string>('');
  const setMyPeerId = (id: string) => {
    myPeerIdRef.current = id;
    setMyPeerIdState(id);
  };

  const [myName, setMyName] = useState<string>('');
  const [myColor, setMyColor] = useState<string>('#2563eb');

  const [isHost, setIsHostState] = useState<boolean>(false);
  const isHostRef = useRef<boolean>(false);
  const setIsHost = (h: boolean) => {
    isHostRef.current = h;
    setIsHostState(h);
  };

  const [peers, setPeersState] = useState<Peer[]>([]);
  const peersRef = useRef<Peer[]>([]);
  const setPeers = (updater: Peer[] | ((prev: Peer[]) => Peer[])) => {
    if (typeof updater === 'function') {
      setPeersState((prev) => {
        const next = updater(prev);
        peersRef.current = next;
        return next;
      });
    } else {
      peersRef.current = updater;
      setPeersState(updater);
    }
  };

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  const [isSharingScreen, setIsSharingScreenState] = useState<boolean>(false);
  const isSharingScreenRef = useRef<boolean>(false);
  const setIsSharingScreen = (s: boolean) => {
    isSharingScreenRef.current = s;
    setIsSharingScreenState(s);
  };
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  // Audio streams from remote peers
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Map<string, MediaStream>>(new Map());

  // Modals & UI status
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [errorMessage, setErrorMessage] = useState<{ code: ServerErrorCode; message: string } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFs);
    return () => document.removeEventListener('fullscreenchange', handleFs);
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen error:', err);
    }
  };

  // References
  const wsRef = useRef<WebSocket | null>(null);
  const sfuRef = useRef<MediasoupClientManager | null>(null);

  // Helper to send typed WS messages
  const sendWsMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Initialize and connect
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const parsedMeetingId =
      (params?.meetingId as string) || url.pathname.split('/').filter(Boolean).pop() || '';
    const parsedName = url.searchParams.get('name') || '';
    const parsedAuthCode = (url.searchParams.get('code') || url.searchParams.get('authCode') || '').toUpperCase();

    if (!parsedName || !parsedAuthCode) {
      if (parsedMeetingId) {
        window.location.href = `/join/${parsedMeetingId}`;
      }
      return;
    }

    setMeetingId(parsedMeetingId);
    setMyName(parsedName);
    setAuthCode(parsedAuthCode);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    console.log('[Room] Connecting to WS:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sfu = new MediasoupClientManager(sendWsMessage, {
      onScreenStream: (stream) => {
        setScreenStream(stream);
        setIsSharingScreen(!!stream);
      },
      onAudioTrack: (peerId, stream) => {
        setRemoteAudioStreams((prev) => {
          const next = new Map(prev);
          next.set(peerId, stream);
          return next;
        });
      },
      onAudioTrackRemoved: (peerId) => {
        setRemoteAudioStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      },
      onScreenShareStopped: () => {
        setIsSharingScreen(false);
        setScreenStream(null);
        showToast('Screen sharing stopped', 'info');
      },
      onError: (err) => {
        showToast(err.message || 'Media connection error', 'error');
      },
    });
    sfuRef.current = sfu;

    ws.onopen = () => {
      console.log('[Room] WS Connected. Sending join request...', {
        meetingId: parsedMeetingId,
        name: parsedName,
        authCode: parsedAuthCode,
      });
      try {
        ws.send(
          JSON.stringify({
            type: 'join',
            meetingId: parsedMeetingId,
            name: parsedName,
            authCode: parsedAuthCode,
          })
        );
      } catch (err: any) {
        console.error('[Room] Failed to send join request:', err);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        console.log('[Room] Received WS message:', msg.type);
        await handleServerMessage(msg, sfu);
      } catch (err: any) {
        console.error('[Room] Failed to handle WS message:', err);
      }
    };

    ws.onclose = (ev) => {
      console.log('[Room] WS Disconnected:', ev.code, ev.reason);
    };

    ws.onerror = (err) => {
      console.error('[Room] WS Error:', err);
    };

    return () => {
      sfu.close();
      ws.close();
    };
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleServerMessage = async (msg: ServerMessage, sfu: MediasoupClientManager) => {
    switch (msg.type) {
      case 'join-ack': {
        console.log('[Room] Join acknowledged:', msg.you);
        setMyPeerId(msg.you.id);
        setMyName(msg.you.name);
        setMyColor(msg.you.color);
        setIsHost(msg.you.isHost);
        setPeers(msg.room.peers);
        setStrokes(msg.room.strokes);
        setIsConnecting(false);

        try {
          // Load mediasoup client Device
          await sfu.initDevice(msg.routerRtpCapabilities);

          // Create send & receive transports
          sendWsMessage({ type: 'create-transport', direction: 'send' });
          sendWsMessage({ type: 'create-transport', direction: 'recv' });
        } catch (deviceErr: any) {
          console.warn('[Room] Mediasoup Device initialization note:', deviceErr.message);
        }
        break;
      }

      case 'transport-created': {
        if (msg.direction === 'send') {
          sfu.setupSendTransport(msg);
          // Start local microphone audio
          try {
            await sfu.startAudio();
            console.log('[Room] Local audio stream started.');
          } catch (audioErr: any) {
            console.warn('[Room] Could not start microphone:', audioErr.message);
            showToast('Microphone access denied or unavailable', 'info');
          }
        } else {
          sfu.setupRecvTransport(msg);
        }
        break;
      }

      case 'produced': {
        // Dispatch custom event for pending producer promises
        window.dispatchEvent(
          new CustomEvent('collabo:produced', {
            detail: { producerId: msg.producerId, kind: msg.kind },
          })
        );
        break;
      }

      case 'new-producer': {
        // Request to consume audio or screen video from other peers
        sfu.requestConsume(msg.producerId);
        break;
      }

      case 'consumed': {
        await sfu.handleConsumed(msg);
        break;
      }

      case 'producer-closed': {
        sfu.handleProducerClosed(msg.producerId, msg.peerId, msg.kind);
        break;
      }

      case 'peer-joined': {
        setPeers((prev) => {
          if (prev.some((p) => p.id === msg.peer.id)) return prev;
          return [...prev, msg.peer];
        });
        showToast(`${msg.peer.name} joined the meeting`, 'info');
        break;
      }

      case 'peer-left': {
        setPeers((prev) => {
          const leavingPeer = prev.find((p) => p.id === msg.peerId);
          if (leavingPeer) {
            showToast(`${leavingPeer.name} left the meeting`, 'info');
          }
          return prev.filter((p) => p.id !== msg.peerId);
        });
        break;
      }

      case 'peer-updated': {
        setPeers((prev) =>
          prev.map((p) => (p.id === msg.peer.id ? { ...p, ...msg.peer } : p))
        );
        break;
      }

      case 'host-changed': {
        const amIHost = msg.hostId === myPeerIdRef.current;
        setIsHost(amIHost);
        setPeers((prev) =>
          prev.map((p) => ({
            ...p,
            isHost: p.id === msg.hostId,
          }))
        );

        if (amIHost) {
          showToast('You are now the presenter. Click "Share Screen" to present.', 'success', 6000);
        } else {
          // If previous host was sharing locally, stop local stream
          if (isSharingScreenRef.current) {
            sfu.stopScreenShare().catch(() => {});
            setIsSharingScreen(false);
            setScreenStream(null);
          }
          const newHostPeer = peersRef.current.find((p) => p.id === msg.hostId);
          if (newHostPeer) {
            showToast(`${newHostPeer.name} is now the presenter`, 'info');
          }
        }
        break;
      }

      case 'draw-stroke': {
        if (!msg.points || msg.points.length === 0) {
          // Finalization event: refresh timestamp so full 5s lifetime begins upon stroke completion
          setStrokes((prev) =>
            prev.map((s) => (s.id === msg.strokeId ? { ...s, timestamp: Date.now() } : s))
          );
          break;
        }
        setStrokes((prev) => {
          const existing = prev.find((s) => s.id === msg.strokeId);
          if (existing) {
            return prev.map((s) =>
              s.id === msg.strokeId
                ? { ...s, points: [...s.points, ...msg.points], timestamp: Date.now() }
                : s
            );
          } else {
            return [
              ...prev,
              {
                id: msg.strokeId,
                peerId: msg.peerId,
                color: msg.color,
                points: msg.points,
                timestamp: Date.now(),
              },
            ];
          }
        });
        break;
      }

      case 'clear-strokes': {
        if (msg.scope === 'all') {
          setStrokes([]);
          showToast('All annotations cleared', 'info');
        } else if (msg.peerId) {
          setStrokes((prev) => prev.filter((s) => s.peerId !== msg.peerId));
        }
        break;
      }

      case 'error': {
        setErrorMessage({ code: msg.code, message: msg.message });
        setIsConnecting(false);
        break;
      }
    }
  };

  // Periodic pruning of expired annotations older than 5.5s (5s life + 0.5s fade)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setStrokes((prev) => {
        const active = prev.filter((s) => now - (s.timestamp || now) < 5500);
        return active.length === prev.length ? prev : active;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Drawing event handler from DrawCanvas
  const handleSendStroke = (points: StrokePoint[], strokeId: string, isEnd = false) => {
    sendWsMessage({
      type: 'draw-stroke',
      strokeId,
      points,
      isEnd,
    });

    // Update local strokes state if new points provided
    if (points && points.length > 0) {
      setStrokes((prev) => {
        const existing = prev.find((s) => s.id === strokeId);
        if (existing) {
          return prev.map((s) =>
            s.id === strokeId
              ? { ...s, points: [...s.points, ...points], timestamp: Date.now() }
              : s
          );
        } else {
          return [
            ...prev,
            {
              id: strokeId,
              peerId: myPeerIdRef.current,
              color: myColor,
              points,
              timestamp: Date.now(),
            },
          ];
        }
      });
    } else if (isEnd) {
      // Stroke complete: start 5s lifetime countdown from release
      setStrokes((prev) =>
        prev.map((s) => (s.id === strokeId ? { ...s, timestamp: Date.now() } : s))
      );
    }
  };

  // Clear own strokes
  const handleClearMyStrokes = () => {
    sendWsMessage({ type: 'clear-strokes', scope: 'own' });
    setStrokes((prev) => prev.filter((s) => s.peerId !== myPeerIdRef.current));
  };

  // Clear all strokes (host only)
  const handleClearAllStrokes = () => {
    if (!isHostRef.current) return;
    sendWsMessage({ type: 'clear-strokes', scope: 'all' });
    setStrokes([]);
  };

  // Toggle audio mute
  const handleToggleAudio = async () => {
    if (!sfuRef.current) return;
    const nextMuted = !isAudioMuted;
    await sfuRef.current.setAudioMuted(nextMuted);
    setIsAudioMuted(nextMuted);
    showToast(nextMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
  };

  // Toggle screen share (host only)
  const handleToggleShare = async () => {
    if (!sfuRef.current || !isHostRef.current) return;

    if (isSharingScreenRef.current) {
      await sfuRef.current.stopScreenShare();
      setIsSharingScreen(false);
      setScreenStream(null);
    } else {
      try {
        const stream = await sfuRef.current.startScreenShare();
        setScreenStream(stream);
        setIsSharingScreen(true);
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          showToast(err.message || 'Could not share screen', 'error');
        }
      }
    }
  };

  // Transfer host privileges
  const handleGrantHost = (targetPeerId: string) => {
    if (!isHostRef.current) return;
    sendWsMessage({ type: 'grant-host', targetPeerId });
  };

  // Leave meeting
  const handleLeave = () => {
    sendWsMessage({ type: 'leave' });
    sfuRef.current?.close();
    window.location.href = '/';
  };

  if (errorMessage) {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-red-600/10 border border-red-500/20 text-red-500 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-zinc-100 mb-2">Unable to Join Meeting</h2>
          <p className="text-sm text-zinc-400 mb-6">{errorMessage.message}</p>
          <Button
            variant="primary"
            onClick={() => { window.location.href = '/'; }}
            className="w-full"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Return to Home
          </Button>
        </div>
      </main>
    );
  }

  if (isConnecting) {
    return (
      <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-10 h-10 border-2 border-zinc-700 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-zinc-400 font-medium">Connecting to meeting {meetingId}...</p>
        </div>
      </main>
    );
  }

  // Dominant Main Stage: Screen View + Draw Canvas Overlay
  return (
    <main className="h-screen w-screen bg-zinc-950 flex flex-col overflow-hidden select-none">
      {/* Hidden audio tags playing audio from remote participants */}
      <div className="hidden" aria-hidden="true">
        {Array.from(remoteAudioStreams.entries()).map(([peerId, stream]) => (
          <AudioPlayer key={peerId} stream={stream} />
        ))}
      </div>

      {/* Top Header Bar: Room details, Legend, and Participant Strip */}
      <header className="shrink-0 flex items-center justify-between gap-4 p-3 bg-zinc-950/80 border-b border-zinc-900 z-20">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-zinc-100 tracking-tight">Collabo</span>
          <div className="hidden sm:flex items-center gap-2 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400">
            <span>ID: {meetingId}</span>
            <span className="text-zinc-600">•</span>
            <span>Code: {authCode}</span>
          </div>
        </div>

        <ParticipantStrip
          peers={peers}
          myPeerId={myPeerId}
          isHost={isHost}
          onGrantHost={handleGrantHost}
          className="max-w-xl"
        />

        <div className="hidden md:block">
          <ColorLegend peers={peers} />
        </div>
      </header>

      {/* Dominant Main Stage: Screen View + Draw Canvas Overlay */}
      <section className="flex-1 relative w-full h-full overflow-hidden flex items-center justify-center p-2 sm:p-4">
        <ScreenView
          stream={screenStream}
          isHost={isHost}
          isSharing={isSharingScreen}
          myColor={myColor}
          strokes={strokes}
          meetingId={meetingId}
          authCode={authCode}
          onStartShare={handleToggleShare}
          onSendStroke={handleSendStroke}
        />
      </section>

      {/* Floating Bottom Control Bar */}
      <footer className="shrink-0 p-3 flex justify-center items-center z-30">
        <ControlBar
          isMuted={isAudioMuted}
          isHost={isHost}
          isSharing={isSharingScreen}
          onToggleAudio={handleToggleAudio}
          onToggleShare={isHost ? handleToggleShare : undefined}
          onClearMyStrokes={handleClearMyStrokes}
          onClearAllStrokes={isHost ? handleClearAllStrokes : undefined}
          onOpenInvite={() => setIsInviteOpen(true)}
          onToggleFullscreen={handleToggleFullscreen}
          isFullscreen={isFullscreen}
          onLeave={handleLeave}
        />
      </footer>

      {/* Invite Modal */}
      <MeetingInfoModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        meetingId={meetingId}
        authCode={authCode}
      />
    </main>
  );
}

/**
 * Clean audio playback component for remote peer audio streams.
 */
function AudioPlayer({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => {
        console.warn('[Audio] Autoplay prevented:', err);
      });
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
