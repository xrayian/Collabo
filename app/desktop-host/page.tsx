'use client';

/**
 * app/desktop-host/page.tsx
 * Collabo Desktop UI supporting both Presenter (Host) and Viewer (Participant) modes.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Monitor,
  MonitorOff,
  Mic,
  MicOff,
  Trash2,
  Share2,
  PhoneOff,
  Copy,
  Check,
  Crown,
  Users,
  Layers,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { ColorLegend } from '@/components/room/ColorLegend';
import { ParticipantStrip } from '@/components/room/ParticipantStrip';
import { ScreenView } from '@/components/room/ScreenView';
import { MediasoupClientManager } from '@/lib/mediasoup-client';
import {
  ClientMessage,
  ServerMessage,
  Peer,
  RoomState,
  ServerErrorCode,
  ElectronScreenSource,
  Stroke,
  StrokePoint,
} from '@/lib/types';

export default function DesktopHostPage() {
  const { showToast } = useToast();

  // Mode tab before connecting
  const [activeTab, setActiveTab] = useState<'host' | 'participant'>('host');

  // Connection parameters
  const [meetingId, setMeetingId] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [displayName, setDisplayName] = useState('Presenter (Desktop)');

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Server URL
  const [serverUrl, setServerUrl] = useState<string>('');

  // Room state
  const [myPeerId, setMyPeerId] = useState('');
  const myPeerIdRef = useRef('');
  const [myColor, setMyColor] = useState('#2563eb');
  const [isHost, setIsHost] = useState(false);
  const isHostRef = useRef(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;

  const [isAudioMuted, setIsAudioMuted] = useState(false);

  // Participant Mode: Remote screen & audio streams
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const [remoteAudioStreams, setRemoteAudioStreams] = useState<Map<string, MediaStream>>(new Map());
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  // Host Mode: Screen Sources
  const [screenSources, setScreenSources] = useState<ElectronScreenSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const sfuRef = useRef<MediasoupClientManager | null>(null);

  const sendWsMessage = useCallback((msg: ClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // Fetch available displays from Electron main process
  const refreshScreenSources = async () => {
    if (typeof window !== 'undefined' && window.electronAPI?.getScreenSources) {
      try {
        const sources = await window.electronAPI.getScreenSources();
        setScreenSources(sources);
        if (sources.length > 0 && !selectedSourceId) {
          setSelectedSourceId(sources[0].id);
        }
      } catch (err) {
        console.warn('[DesktopHost] Could not fetch screen sources:', err);
      }
    }
  };

  // Pruning expired drawing annotations (5s lifetime + 0.5s fade)
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

  useEffect(() => {
    async function init() {
      if (typeof window !== 'undefined') {
        if (window.electronAPI?.getServerUrl) {
          try {
            const url = await window.electronAPI.getServerUrl();
            if (url) {
              setServerUrl(url.replace(/\/+$/, ''));
            } else {
              setServerUrl(window.location.origin);
            }
          } catch {
            setServerUrl(window.location.origin);
          }
        } else {
          setServerUrl(window.location.origin);
        }
      }
      refreshScreenSources();
    }
    init();

    // Listen for deep link events from main process (collabo://host/... or collabo://join/...)
    if (typeof window !== 'undefined' && window.electronAPI?.onDeepLinkMeeting) {
      const cleanup = window.electronAPI.onDeepLinkMeeting((data) => {
        if (data.meetingId) {
          setMeetingId(data.meetingId);
          if (data.authCode) setAuthCode(data.authCode);
          if (data.mode === 'join') {
            setActiveTab('participant');
            setDisplayName((prev) => (prev.includes('Presenter') ? 'Participant (Desktop)' : prev));
          } else {
            setActiveTab('host');
            setDisplayName((prev) => (prev.includes('Participant') ? 'Presenter (Desktop)' : prev));
          }
          showToast(`Loaded meeting ${data.meetingId} from deep link`, 'info');
        }
      });
      return cleanup;
    }
  }, []);

  // Handle incoming WS messages
  const handleServerMessage = async (msg: ServerMessage) => {
    const sfu = sfuRef.current;
    if (!sfu) return;

    switch (msg.type) {
      case 'join-ack': {
        setMyPeerId(msg.you.id);
        myPeerIdRef.current = msg.you.id;
        setMyColor(msg.you.color);
        setIsHost(msg.you.isHost);
        isHostRef.current = msg.you.isHost;
        setPeers(msg.room.peers);
        setStrokes(msg.room.strokes || []);
        setIsConnected(true);
        setIsConnecting(false);

        try {
          if (msg.routerRtpCapabilities) {
            await sfu.initDevice(msg.routerRtpCapabilities);
            sendWsMessage({ type: 'create-transport', direction: 'send' });
            sendWsMessage({ type: 'create-transport', direction: 'recv' });
          }
        } catch (err: any) {
          console.warn('[DesktopHost] Device init error:', err?.message);
        }
        break;
      }

      case 'transport-created': {
        if (msg.direction === 'send') {
          sfu.setupSendTransport(msg);
          // Once send transport is established, start microphone audio
          sfu.startAudio().catch((err) => {
            console.warn('[DesktopHost] Audio produce note:', err?.message);
          });
        } else {
          sfu.setupRecvTransport(msg);
        }
        break;
      }

      case 'produced': {
        window.dispatchEvent(
          new CustomEvent('collabo:produced', {
            detail: { producerId: msg.producerId, kind: msg.kind },
          })
        );
        break;
      }

      case 'new-producer': {
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
        setPeers((prev) => [...prev.filter((p) => p.id !== msg.peer.id), msg.peer]);
        showToast(`${msg.peer.name} joined the meeting`, 'info');
        break;
      }

      case 'peer-left': {
        const leaving = peersRef.current.find((p) => p.id === msg.peerId);
        setPeers((prev) => prev.filter((p) => p.id !== msg.peerId));
        if (leaving) {
          showToast(`${leaving.name} left`, 'info');
        }
        break;
      }

      case 'draw-stroke': {
        // Relay stroke to native desktop overlay window
        if (window.electronAPI?.relayStrokeToOverlay) {
          window.electronAPI.relayStrokeToOverlay(msg);
        }

        // Also track in local strokes state for participant screen view
        if (!msg.points || msg.points.length === 0) {
          setStrokes((prev) =>
            prev.map((s) => (s.id === msg.strokeId ? { ...s, timestamp: Date.now() } : s))
          );
        } else {
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
        }
        break;
      }

      case 'clear-strokes': {
        if (window.electronAPI?.relayClearToOverlay) {
          window.electronAPI.relayClearToOverlay(msg);
        }
        if (msg.scope === 'all') {
          setStrokes([]);
        } else if (msg.peerId) {
          setStrokes((prev) => prev.filter((s) => s.peerId !== msg.peerId));
        }
        break;
      }

      case 'host-changed': {
        const amIHost = msg.hostId === myPeerIdRef.current;
        setIsHost(amIHost);
        isHostRef.current = amIHost;
        setPeers((prev) =>
          prev.map((p) => ({
            ...p,
            isHost: p.id === msg.hostId,
          }))
        );

        if (amIHost) {
          showToast('You are now the presenter! Select a display below to broadcast with native OS overlay.', 'success', 7000);
          refreshScreenSources();
        } else {
          if (isSharingScreen) {
            stopScreenShare();
          }
          const newHost = peersRef.current.find((p) => p.id === msg.hostId);
          if (newHost) {
            showToast(`${newHost.name} is now presenting`, 'info');
          }
        }
        break;
      }

      case 'error': {
        setErrorMessage(msg.message);
        setIsConnecting(false);
        showToast(msg.message, 'error');
        break;
      }
    }
  };

  // Connect to room (Host or Participant)
  const connectToMeeting = (targetMeetingId: string, targetAuthCode: string, name: string) => {
    if (!targetMeetingId.trim() || !targetAuthCode.trim()) {
      showToast('Please enter Meeting ID and Auth Code', 'error');
      return;
    }

    setIsConnecting(true);
    setErrorMessage(null);

    const base = serverUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    const wsBase = base.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/ws`;

    console.log('[DesktopHost] Connecting to WS:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sfu = new MediasoupClientManager(sendWsMessage, {
      onAudioTrack: (peerId, stream) => {
        setRemoteAudioStreams((prev) => new Map(prev).set(peerId, stream));
      },
      onAudioTrackRemoved: (peerId) => {
        setRemoteAudioStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      },
      onScreenStream: (stream) => {
        setRemoteScreenStream(stream);
      },
      onScreenShareStopped: () => {
        setRemoteScreenStream(null);
        if (isSharingScreen) {
          stopScreenShare();
        }
      },
      onError: (err) => {
        showToast(err.message || 'Media connection error', 'error');
      },
    });
    sfuRef.current = sfu;

    ws.onopen = () => {
      sendWsMessage({
        type: 'join',
        meetingId: targetMeetingId.trim(),
        name: name.trim() || (activeTab === 'host' ? 'Presenter (Desktop)' : 'Participant (Desktop)'),
        authCode: targetAuthCode.trim().toUpperCase(),
      });
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        await handleServerMessage(data);
      } catch (err) {
        console.error('[DesktopHost] WS parse error:', err);
      }
    };

    ws.onerror = () => {
      setIsConnecting(false);
      setErrorMessage(`Could not connect to Collabo server at ${base}`);
    };

    ws.onclose = () => {
      setIsConnected(false);
      setIsConnecting(false);
    };
  };

  // Quick action: Create new meeting from desktop app
  const handleCreateMeeting = async () => {
    setIsConnecting(true);
    try {
      const base = serverUrl || (typeof window !== 'undefined' ? window.location.origin : '');
      const res = await fetch(`${base}/api/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success && data.meetingId && data.authCode) {
        setMeetingId(data.meetingId);
        setAuthCode(data.authCode);
        connectToMeeting(data.meetingId, data.authCode, displayName);
      } else {
        throw new Error(data.message || 'Failed to create meeting');
      }
    } catch (err: any) {
      setIsConnecting(false);
      showToast(err.message || 'Error creating meeting', 'error');
    }
  };

  // Start Screen Share + Native Desktop Overlay (Host)
  const startScreenShare = async () => {
    if (!selectedSourceId) {
      showToast('Please select a screen to share', 'error');
      return;
    }

    try {
      const selectedSource = screenSources.find((s) => s.id === selectedSourceId);

      // Capture native screen via Electron desktopCapturer source ID
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selectedSourceId,
            minWidth: 1280,
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160,
            frameRate: { max: 30 },
          },
        },
      });

      setActiveStream(stream);

      // Produce video track to Mediasoup SFU
      if (sfuRef.current) {
        await sfuRef.current.startScreenShareFromStream(stream);
      }

      // Launch native transparent click-through overlay over the selected display
      if (window.electronAPI?.startOverlay) {
        await window.electronAPI.startOverlay(selectedSource?.display_id);
      }

      setIsSharingScreen(true);
      showToast('Screen share active! Participants can now draw directly on your desktop.', 'success', 5000);
    } catch (err: any) {
      console.error('[DesktopHost] Failed to start native screen share:', err);
      showToast(err.message || 'Could not start screen sharing', 'error');
    }
  };

  // Stop Screen Share + Close Desktop Overlay (Host)
  const stopScreenShare = async () => {
    if (activeStream) {
      activeStream.getTracks().forEach((t) => t.stop());
      setActiveStream(null);
    }

    if (sfuRef.current) {
      await sfuRef.current.stopScreenShare().catch(() => {});
    }

    if (window.electronAPI?.stopOverlay) {
      await window.electronAPI.stopOverlay();
    }

    setIsSharingScreen(false);
    showToast('Screen share stopped. Desktop overlay closed.', 'info');
  };

  // Toggle audio
  const handleToggleAudio = async () => {
    if (!sfuRef.current) return;
    const nextMuted = !isAudioMuted;
    await sfuRef.current.setAudioMuted(nextMuted);
    setIsAudioMuted(nextMuted);
    showToast(nextMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
  };

  // Participant: Send drawn stroke to server
  const handleSendStroke = (points: StrokePoint[], strokeId: string, isEnd = false) => {
    sendWsMessage({
      type: 'draw-stroke',
      strokeId,
      points,
      isEnd,
    });

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
      setStrokes((prev) =>
        prev.map((s) => (s.id === strokeId ? { ...s, timestamp: Date.now() } : s))
      );
    }
  };

  // Clear annotations (All for host, Own for participant)
  const handleClearStrokes = () => {
    if (isHost) {
      sendWsMessage({ type: 'clear-strokes', scope: 'all' });
      if (window.electronAPI?.relayClearToOverlay) {
        window.electronAPI.relayClearToOverlay({ scope: 'all' });
      }
      setStrokes([]);
      showToast('All annotations cleared', 'info');
    } else {
      sendWsMessage({ type: 'clear-strokes', scope: 'own' });
      setStrokes((prev) => prev.filter((s) => s.peerId !== myPeerIdRef.current));
      showToast('Your annotations cleared', 'info');
    }
  };

  // Copy share invite link
  const handleCopyInvite = () => {
    const base = serverUrl || window.location.origin;
    const webUrl = `${base}/join/${meetingId}?code=${authCode}`;
    const text = `Join my Collabo Screen-Draw Meeting!\nWeb Link: ${webUrl}\nMeeting ID: ${meetingId}\nAuth Code: ${authCode}\nCollabo Desktop Deep Link: collabo://join/${meetingId}?code=${authCode}`;
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    showToast('Meeting invite copied to clipboard!', 'success');
  };

  // Leave meeting
  const handleLeave = () => {
    if (isSharingScreen) {
      stopScreenShare();
    }
    if (wsRef.current) {
      sendWsMessage({ type: 'leave' });
      wsRef.current.close();
      wsRef.current = null;
    }
    if (sfuRef.current) {
      sfuRef.current.close();
      sfuRef.current = null;
    }
    setIsConnected(false);
    setRemoteScreenStream(null);
    setRemoteAudioStreams(new Map());
    setStrokes([]);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col select-none font-sans">
      {/* App Header */}
      <header className="flex items-center justify-between px-5 py-3.5 bg-zinc-900/70 backdrop-blur border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              Collabo Desktop
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
                {isConnected ? (isHost ? 'PRESENTER' : 'PARTICIPANT') : 'DESKTOP APP'}
              </span>
            </h1>
            <p className="text-xs text-zinc-400">
              {isConnected
                ? isHost
                  ? 'Broadcasting screen with native OS overlay'
                  : 'Viewing screen & drawing live annotations'
                : 'Host or join screen-drawing sessions'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Server Indicator */}
          {serverUrl && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900/90 border border-zinc-800 text-[11px] text-zinc-400 font-mono"
              title={`Collabo Server: ${serverUrl}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="truncate max-w-[190px]">
                {serverUrl.replace(/^https?:\/\//, '')}
              </span>
            </div>
          )}

          {isConnected && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono">
                <span className="text-zinc-400">ID: {meetingId}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400">Code: {authCode}</span>
              </div>
              <Button size="sm" variant="secondary" onClick={handleCopyInvite}>
                {copiedLink ? <Check className="w-3.5 h-3.5 mr-1.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                {copiedLink ? 'Copied' : 'Invite'}
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      {!isConnected ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full p-6 sm:p-8 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-2xl space-y-6">
            {/* Mode Tab Switcher */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-zinc-950 border border-zinc-800/90 text-xs font-medium">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('host');
                  if (displayName === 'Participant (Desktop)') setDisplayName('Presenter (Desktop)');
                }}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg transition-all ${
                  activeTab === 'host'
                    ? 'bg-blue-600 text-white font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                Host Session
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('participant');
                  if (displayName === 'Presenter (Desktop)') setDisplayName('Participant (Desktop)');
                }}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg transition-all ${
                  activeTab === 'participant'
                    ? 'bg-blue-600 text-white font-semibold shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                Join Session
              </button>
            </div>

            {/* Header info per mode */}
            <div className="text-center space-y-1.5">
              <h2 className="text-lg font-bold text-zinc-100">
                {activeTab === 'host' ? 'Present with Native OS Overlay' : 'Join Screen-Draw Session'}
              </h2>
              <p className="text-xs text-zinc-400">
                {activeTab === 'host'
                  ? 'Annotations from participants appear directly over your physical desktop screen.'
                  : 'Watch the presenter’s screen, draw annotations in real-time, and talk via voice.'}
              </p>
            </div>

            {/* Inputs & Action per mode */}
            {activeTab === 'host' ? (
              <div className="space-y-4">
                <Input
                  label="Presenter Display Name"
                  placeholder="e.g. Alex (Presenter)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />

                <div className="pt-1">
                  <Button
                    onClick={handleCreateMeeting}
                    disabled={isConnecting}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl shadow-lg"
                  >
                    {isConnecting ? 'Starting Host Session...' : 'Start New Meeting as Presenter'}
                  </Button>
                </div>

                <div className="relative flex items-center justify-center py-1">
                  <div className="border-t border-zinc-800 w-full" />
                  <span className="bg-zinc-900 px-3 text-[10px] font-mono text-zinc-500 uppercase tracking-wider absolute">
                    Or Connect to Existing
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Meeting ID"
                    placeholder="e.g. abc123"
                    value={meetingId}
                    onChange={(e) => setMeetingId(e.target.value)}
                  />
                  <Input
                    label="Auth Code"
                    placeholder="e.g. 6-char"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value.toUpperCase())}
                  />
                </div>

                <Button
                  variant="secondary"
                  onClick={() => connectToMeeting(meetingId, authCode, displayName)}
                  disabled={isConnecting || !meetingId.trim() || !authCode.trim()}
                  className="w-full"
                >
                  Connect as Presenter
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Input
                  label="Your Display Name"
                  placeholder="e.g. Jordan"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Meeting ID"
                    placeholder="e.g. abc123"
                    value={meetingId}
                    onChange={(e) => setMeetingId(e.target.value)}
                  />
                  <Input
                    label="Auth Code"
                    placeholder="e.g. 6-char"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value.toUpperCase())}
                  />
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => connectToMeeting(meetingId, authCode, displayName)}
                    disabled={isConnecting || !meetingId.trim() || !authCode.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl shadow-lg"
                  >
                    {isConnecting ? 'Joining Meeting...' : 'Join Meeting as Participant'}
                  </Button>
                </div>
              </div>
            )}

            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center">
                {errorMessage}
              </div>
            )}
          </div>
        </div>
      ) : isHost ? (
        /* ======================== HOST VIEW ======================== */
        <div className="flex-1 p-6 flex flex-col max-w-5xl mx-auto w-full gap-6 overflow-y-auto">
          {/* Top Stage: Screen Sharing Selector & Status */}
          <section className="p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-blue-400" />
                  Select Display for Screen Sharing & Desktop Overlay
                </h2>
                <p className="text-xs text-zinc-400">
                  Choose which physical monitor to broadcast and overlay annotations on.
                </p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={refreshScreenSources}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Refresh Displays
              </Button>
            </div>

            {/* Display Picker Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {screenSources.map((source) => {
                const isSelected = selectedSourceId === source.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    disabled={isSharingScreen}
                    onClick={() => setSelectedSourceId(source.id)}
                    className={`flex flex-col p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40'
                        : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
                    } ${isSharingScreen ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="w-full aspect-video rounded-lg overflow-hidden bg-black mb-2.5 border border-zinc-900 flex items-center justify-center">
                      {source.thumbnailUrl ? (
                        <img
                          src={source.thumbnailUrl}
                          alt={source.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Monitor className="w-8 h-8 text-zinc-700" />
                      )}
                    </div>
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-medium text-zinc-200 truncate">{source.name}</span>
                      {source.width && (
                        <span className="text-[10px] font-mono text-zinc-500">
                          {source.width}x{source.height}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Screen Share Action Button */}
            <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
              <div className="flex items-center gap-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    isSharingScreen ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'
                  }`}
                />
                <span className="text-xs font-medium text-zinc-300">
                  {isSharingScreen
                    ? 'Broadcasting Screen & Native Overlay Active'
                    : 'Not Sharing'}
                </span>
              </div>

              {!isSharingScreen ? (
                <Button
                  onClick={startScreenShare}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 shadow-lg"
                >
                  <Monitor className="w-4 h-4 mr-2" />
                  Start Screen Share & Overlay
                </Button>
              ) : (
                <Button
                  variant="danger"
                  onClick={stopScreenShare}
                  className="font-medium px-5 shadow-lg"
                >
                  <MonitorOff className="w-4 h-4 mr-2" />
                  Stop Screen Sharing
                </Button>
              )}
            </div>
          </section>

          {/* Participants Strip */}
          <section className="p-6 rounded-2xl bg-zinc-900/80 border border-zinc-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-blue-400" />
                In Call ({peers.length}/10)
              </h3>
              <ColorLegend peers={peers} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {peers.map((peer) => {
                const isMe = peer.id === myPeerId;
                return (
                  <div
                    key={peer.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/60 border border-zinc-800"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="relative">
                        <Avatar name={peer.name} color={peer.color} size="sm" />
                        {peer.isHost && (
                          <div className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-amber-500 text-black">
                            <Crown className="w-2.5 h-2.5" />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-zinc-200">
                          {peer.name} {isMe && '(You)'}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {peer.isHost ? 'Presenter' : 'Participant'}
                        </span>
                      </div>
                    </div>

                    {!isMe && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => sendWsMessage({ type: 'grant-host', targetPeerId: peer.id })}
                        className="text-[11px] text-zinc-400 hover:text-white"
                        title="Make Presenter"
                      >
                        Pass Host
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bottom Floating Control Bar */}
          <div className="flex items-center justify-center gap-3 py-2">
            <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl">
              <IconButton
                label={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
                variant={isAudioMuted ? 'danger' : 'default'}
                onClick={handleToggleAudio}
              >
                {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              <IconButton
                label="Clear all annotations from screen"
                variant="default"
                onClick={handleClearStrokes}
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </IconButton>

              <IconButton
                label="Copy invite info"
                variant="default"
                onClick={handleCopyInvite}
              >
                {copiedLink ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5 text-blue-400" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              <IconButton
                label="Leave meeting"
                variant="danger"
                onClick={handleLeave}
              >
                <PhoneOff className="w-5 h-5" />
              </IconButton>
            </div>
          </div>
        </div>
      ) : (
        /* ======================== PARTICIPANT VIEW ======================== */
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Top Bar: Participant Strip & Color Legend */}
          <div className="px-4 py-2.5 flex items-center justify-between gap-3 bg-zinc-900/60 border-b border-zinc-800 shrink-0">
            <ParticipantStrip
              peers={peers}
              myPeerId={myPeerId}
              isHost={false}
              onGrantHost={() => {}}
              className="bg-transparent border-0 p-0 shadow-none"
            />
            <ColorLegend peers={peers} />
          </div>

          {/* Interactive Screen View & Drawing Area */}
          <div className="flex-1 relative overflow-hidden bg-zinc-950 flex items-center justify-center">
            <ScreenView
              stream={remoteScreenStream}
              isHost={false}
              isSharing={!!remoteScreenStream}
              myColor={myColor}
              strokes={strokes}
              onSendStroke={handleSendStroke}
            />
          </div>

          {/* Participant Control Bar */}
          <div className="py-3 px-6 flex items-center justify-center gap-3 bg-zinc-900/80 backdrop-blur border-t border-zinc-800 shrink-0">
            <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-xl">
              <IconButton
                label={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
                variant={isAudioMuted ? 'danger' : 'default'}
                onClick={handleToggleAudio}
              >
                {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              <IconButton
                label="Clear my annotations"
                variant="default"
                onClick={handleClearStrokes}
              >
                <Trash2 className="w-5 h-5 text-amber-400" />
              </IconButton>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  sendWsMessage({ type: 'request-host' });
                  showToast('Presenter rights requested from host', 'info');
                }}
                className="text-xs text-zinc-300 hover:text-white"
                title="Request Presenter Rights"
              >
                <Crown className="w-3.5 h-3.5 mr-1 text-amber-400" />
                Request Presenter
              </Button>

              <IconButton
                label="Copy invite info"
                variant="default"
                onClick={handleCopyInvite}
              >
                {copiedLink ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5 text-blue-400" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              <IconButton
                label="Leave meeting"
                variant="danger"
                onClick={handleLeave}
              >
                <PhoneOff className="w-5 h-5" />
              </IconButton>
            </div>
          </div>
        </div>
      )}

      {/* Remote Audio Players */}
      {Array.from(remoteAudioStreams.entries()).map(([peerId, stream]) => (
        <AudioPlayer key={peerId} stream={stream} />
      ))}
    </main>
  );
}

/**
 * Audio playback component for remote peer streams.
 */
function AudioPlayer({ stream }: { stream: MediaStream }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play().catch((err) => {
        console.warn('[AudioPlayer] Autoplay note:', err);
      });
    }
  }, [stream]);

  return <audio ref={audioRef} autoPlay playsInline />;
}
