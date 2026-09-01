/**
 * lib/types.ts
 * Shared TypeScript definitions, constants, and WebSocket message schemas.
 */

// 10 distinct, high-contrast, colorblind-friendly colors
export const PEER_COLORS: readonly string[] = [
  '#2563eb', // Blue
  '#dc2626', // Red
  '#16a34a', // Green
  '#d97706', // Amber
  '#9333ea', // Purple
  '#0891b2', // Cyan
  '#ea580c', // Orange
  '#db2777', // Pink
  '#4f46e5', // Indigo
  '#059669', // Emerald
] as const;

export interface Peer {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  joinedAt: number;
  audioMuted?: boolean;
  screenSharing?: boolean;
}

export type StrokePoint = [number, number]; // [x, y] normalized 0.0 - 1.0

export interface Stroke {
  id: string;
  peerId: string;
  color: string;
  points: StrokePoint[];
  timestamp: number;
}

export interface RoomState {
  meetingId: string;
  authCode: string;
  hostId: string;
  peers: Peer[];
  strokes: Stroke[];
  createdAt: number;
}

// WebSocket message protocols
export type ClientMessage =
  | { type: 'join'; meetingId: string; name: string; authCode: string }
  | { type: 'create-transport'; direction: 'send' | 'recv' }
  | { type: 'connect-transport'; transportId: string; dtlsParameters: any }
  | { type: 'produce'; transportId: string; kind: 'audio' | 'video'; rtpParameters: any; appData?: any }
  | { type: 'consume'; producerId: string; rtpCapabilities: any }
  | { type: 'resume-consumer'; consumerId: string }
  | { type: 'pause-producer'; producerId: string }
  | { type: 'resume-producer'; producerId: string }
  | { type: 'close-producer'; producerId: string }
  | { type: 'draw-stroke'; strokeId: string; points: StrokePoint[]; isEnd?: boolean }
  | { type: 'clear-strokes'; scope: 'own' | 'all' }
  | { type: 'request-host' }
  | { type: 'grant-host'; targetPeerId: string }
  | { type: 'leave' };

export type ServerErrorCode =
  | 'BAD_AUTH_CODE'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'INVALID_MESSAGE'
  | 'SERVER_ERROR';

export type ServerMessage =
  | {
      type: 'join-ack';
      you: { id: string; name: string; color: string; isHost: boolean };
      room: RoomState;
      routerRtpCapabilities: any;
    }
  | { type: 'transport-created'; direction: 'send' | 'recv'; id: string; iceParameters: any; iceCandidates: any; dtlsParameters: any; sctpParameters?: any }
  | { type: 'transport-connected'; transportId: string }
  | { type: 'produced'; producerId: string; kind: 'audio' | 'video' }
  | {
      type: 'consumed';
      consumerId: string;
      producerId: string;
      kind: 'audio' | 'video';
      rtpParameters: any;
      peerId: string;
      appData?: any;
    }
  | { type: 'peer-joined'; peer: Peer }
  | { type: 'peer-left'; peerId: string }
  | { type: 'peer-updated'; peer: Peer }
  | { type: 'new-producer'; peerId: string; producerId: string; kind: 'audio' | 'video' }
  | { type: 'producer-closed'; producerId: string; peerId: string; kind: 'audio' | 'video' }
  | { type: 'producer-paused'; producerId: string; peerId: string }
  | { type: 'producer-resumed'; producerId: string; peerId: string }
  | { type: 'draw-stroke'; peerId: string; color: string; strokeId: string; points: StrokePoint[]; isEnd?: boolean }
  | { type: 'clear-strokes'; peerId?: string; scope: 'own' | 'all' }
  | { type: 'host-changed'; hostId: string }
  | { type: 'error'; code: ServerErrorCode; message: string };

export interface ElectronScreenSource {
  id: string;
  name: string;
  display_id: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
}

export interface ElectronAPI {
  isElectron: boolean;
  getScreenSources: () => Promise<ElectronScreenSource[]>;
  startOverlay: (displayId?: string) => Promise<{ success: boolean; bounds: any }>;
  stopOverlay: () => Promise<{ success: boolean }>;
  relayStrokeToOverlay: (stroke: any) => void;
  relayClearToOverlay: (scope: any) => void;
  onDeepLinkMeeting: (callback: (data: { meetingId: string; authCode: string }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    overlayAPI?: any;
  }
}
