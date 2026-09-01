'use client';

/**
 * app/desktop-host/page.tsx
 * Collabo Desktop Host Control Window UI.
 * Enumerate physical displays, starts native screen sharing, and synchronizes native desktop overlay.
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
import { MediasoupClientManager } from '@/lib/mediasoup-client';
import {
  ClientMessage,
  ServerMessage,
  Peer,
  RoomState,
  ServerErrorCode,
  ElectronScreenSource,
} from '@/lib/types';

export default function DesktopHostPage() {
  const { showToast } = useToast();
  const [meetingId, setMeetingId] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [hostName, setHostName] = useState('Presenter (Desktop)');

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Room state
  const [myPeerId, setMyPeerId] = useState('');
  const [myColor, setMyColor] = useState('#2563eb');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  // Screen Sources
  const [screenSources, setScreenSources] = useState<ElectronScreenSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const [copiedLink, setCopiedLink] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const sfuRef = useRef<MediasoupClientManager | null>(null);
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;

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

  useEffect(() => {
    refreshScreenSources();

    // Listen for deep link events from main process (collabo://host/[meetingId]?code=[authCode])
    if (typeof window !== 'undefined' && window.electronAPI?.onDeepLinkMeeting) {
      const cleanup = window.electronAPI.onDeepLinkMeeting((data) => {
        if (data.meetingId) {
          setMeetingId(data.meetingId);
          if (data.authCode) setAuthCode(data.authCode);
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
        setMyColor(msg.you.color);
        setPeers(msg.room.peers);
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
        break;
      }

      case 'clear-strokes': {
        if (window.electronAPI?.relayClearToOverlay) {
          window.electronAPI.relayClearToOverlay(msg);
        }
        break;
      }

      case 'host-changed': {
        const amIHost = msg.hostId === myPeerId;
        setPeers((prev) =>
          prev.map((p) => ({
            ...p,
            isHost: p.id === msg.hostId,
          }))
        );
        if (!amIHost && isSharingScreen) {
          stopScreenShare();
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

  // Connect to room as host
  const connectToMeeting = (targetMeetingId: string, targetAuthCode: string, name: string) => {
    if (!targetMeetingId.trim() || !targetAuthCode.trim()) {
      showToast('Please enter Meeting ID and Auth Code', 'error');
      return;
    }

    setIsConnecting(true);
    setErrorMessage(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const sfu = new MediasoupClientManager(sendWsMessage, {
      onAudioTrack: () => {},
      onAudioTrackRemoved: () => {},
      onScreenStream: () => {},
      onScreenShareStopped: () => {
        stopScreenShare();
      },
    });
    sfuRef.current = sfu;

    ws.onopen = () => {
      sendWsMessage({
        type: 'join',
        meetingId: targetMeetingId.trim(),
        name: name.trim() || 'Presenter (Desktop)',
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
      setErrorMessage('Could not connect to Collabo server.');
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
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success && data.meetingId && data.authCode) {
        setMeetingId(data.meetingId);
        setAuthCode(data.authCode);
        connectToMeeting(data.meetingId, data.authCode, hostName);
      } else {
        throw new Error(data.message || 'Failed to create meeting');
      }
    } catch (err: any) {
      setIsConnecting(false);
      showToast(err.message || 'Error creating meeting', 'error');
    }
  };

  // Start Screen Share + Native Desktop Overlay
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

  // Stop Screen Share + Close Desktop Overlay
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

  // Clear all annotations
  const handleClearAllStrokes = () => {
    sendWsMessage({ type: 'clear-strokes', scope: 'all' });
    if (window.electronAPI?.relayClearToOverlay) {
      window.electronAPI.relayClearToOverlay({ scope: 'all' });
    }
    showToast('All annotations cleared', 'info');
  };

  // Copy share invite link
  const handleCopyInvite = () => {
    const origin = window.location.origin;
    const webUrl = `${origin}/join/${meetingId}?code=${authCode}`;
    const text = `Join my Collabo Screen-Draw Meeting!\nWeb Link: ${webUrl}\nMeeting ID: ${meetingId}\nAuth Code: ${authCode}\nCollabo Desktop Deep Link: collabo://host/${meetingId}?code=${authCode}`;
    navigator.clipboard.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    showToast('Meeting invite copied to clipboard!', 'success');
  };

  // Leave meeting
  const handleLeave = () => {
    stopScreenShare();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col select-none font-sans">

      {/* App Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Monitor className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              Collabo Desktop Host
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
                PRESENTER APP
              </span>
            </h1>
            <p className="text-xs text-zinc-400">System-wide live drawing overlay for Windows & Mac</p>
          </div>
        </div>

        {isConnected && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono">
              <span className="text-zinc-400">ID: {meetingId}</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">Code: {authCode}</span>
            </div>
            <Button size="sm" variant="secondary" onClick={handleCopyInvite}>
              {copiedLink ? <Check className="w-3.5 h-3.5 mr-1.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copiedLink ? 'Copied' : 'Invite'}
            </Button>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      {!isConnected ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full p-8 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-2xl space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-400 mb-2">
                <Sparkles className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-zinc-100">Host Meeting with Desktop Overlay</h2>
              <p className="text-xs text-zinc-400">
                Drawings from participants will appear directly over your desktop screen in real-time.
              </p>
            </div>

            <div className="space-y-4">
              <Input
                label="Your Presenter Name"
                placeholder="e.g. Alex"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />

              <div className="pt-2">
                <Button
                  onClick={handleCreateMeeting}
                  disabled={isConnecting}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl shadow-lg"
                >
                  {isConnecting ? 'Starting Host Session...' : 'Start New Meeting as Presenter'}
                </Button>
              </div>

              <div className="relative flex items-center justify-center py-2">
                <div className="border-t border-zinc-800 w-full" />
                <span className="bg-zinc-900 px-3 text-[11px] font-mono text-zinc-500 uppercase tracking-wider absolute">
                  Or Join Existing
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
                onClick={() => connectToMeeting(meetingId, authCode, hostName)}
                disabled={isConnecting || !meetingId || !authCode}
                className="w-full"
              >
                Connect to Existing Meeting
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 p-6 flex flex-col max-w-5xl mx-auto w-full gap-6">
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

          {/* Participants & In-Call Strip */}
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
              {/* Mic Toggle */}
              <IconButton
                label={isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
                variant={isAudioMuted ? 'danger' : 'default'}
                onClick={handleToggleAudio}
              >
                {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              {/* Clear All Annotations */}
              <IconButton
                label="Clear all annotations from screen"
                variant="default"
                onClick={handleClearAllStrokes}
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </IconButton>

              {/* Copy Invite */}
              <IconButton
                label="Copy invite info"
                variant="default"
                onClick={handleCopyInvite}
              >
                {copiedLink ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5 text-blue-400" />}
              </IconButton>

              <div className="h-6 w-px bg-zinc-700/60 mx-1" />

              {/* Leave Meeting */}
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
    </main>
  );
}
