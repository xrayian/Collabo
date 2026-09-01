/**
 * server/rooms.ts
 * In-memory room manager, peer state, color assignment, capacity enforcement, and stroke state.
 */
import { Peer, RoomState, Stroke, PEER_COLORS, ServerErrorCode } from '../lib/types';
import crypto from 'crypto';

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  /**
   * Generates a 6-character alphanumeric auth code using unambiguous characters.
   */
  public generateAuthCode(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excludes 0, 1, I, O
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  /**
   * Generates a short meeting ID slug (e.g. 'abc-def-ghi' or 8-char nanoid).
   */
  public generateMeetingId(): string {
    return crypto.randomBytes(4).toString('hex');
  }

  /**
   * Create a new room with specified or generated meeting ID and auth code.
   */
  public createRoom(meetingId?: string, authCode?: string): RoomState {
    const id = meetingId || this.generateMeetingId();
    const code = (authCode || this.generateAuthCode()).toUpperCase();

    const room: RoomState = {
      meetingId: id,
      authCode: code,
      hostId: '',
      peers: [],
      strokes: [],
      createdAt: Date.now(),
    };

    this.rooms.set(id, room);
    return room;
  }

  /**
   * Helper to prune expired annotations older than 5.5s (5s lifetime + 0.5s fade).
   */
  private pruneExpiredStrokes(room: RoomState): void {
    const now = Date.now();
    room.strokes = room.strokes.filter((s) => now - (s.timestamp || now) <= 5500);
  }

  /**
   * Get an existing room by ID and prune expired strokes.
   */
  public getRoom(meetingId: string): RoomState | undefined {
    const room = this.rooms.get(meetingId);
    if (room) {
      this.pruneExpiredStrokes(room);
    }
    return room;
  }

  /**
   * Check if a room exists.
   */
  public hasRoom(meetingId: string): boolean {
    return this.rooms.has(meetingId);
  }

  /**
   * Attempt to join a peer to a room.
   */
  public addPeer(
    meetingId: string,
    peerId: string,
    name: string,
    authCode: string
  ): { peer: Peer; room: RoomState } | { error: ServerErrorCode; message: string } {
    const room = this.rooms.get(meetingId);
    if (!room) {
      return { error: 'ROOM_NOT_FOUND', message: 'The meeting does not exist or has already ended.' };
    }

    this.pruneExpiredStrokes(room);

    if (room.authCode.toUpperCase() !== authCode.trim().toUpperCase()) {
      return { error: 'BAD_AUTH_CODE', message: 'Invalid authentication code.' };
    }

    if (room.peers.length >= 10) {
      return { error: 'ROOM_FULL', message: 'This meeting is already at maximum capacity (10 participants).' };
    }

    // Check if peerId is already in room (reconnect scenario)
    const existingIndex = room.peers.findIndex((p) => p.id === peerId);
    if (existingIndex !== -1) {
      const existingPeer = room.peers[existingIndex];
      existingPeer.name = name.trim() || existingPeer.name;
      return { peer: existingPeer, room };
    }

    // Assign color from available palette
    const usedColors = new Set(room.peers.map((p) => p.color));
    const availableColor = PEER_COLORS.find((c) => !usedColors.has(c)) || PEER_COLORS[0];

    const isFirstPeer = room.peers.length === 0;
    const isHost = isFirstPeer || room.hostId === '' || room.hostId === peerId;

    if (isHost) {
      room.hostId = peerId;
    }

    const peer: Peer = {
      id: peerId,
      name: name.trim() || `Guest ${room.peers.length + 1}`,
      color: availableColor,
      isHost,
      joinedAt: Date.now(),
      audioMuted: false,
      screenSharing: false,
    };

    room.peers.push(peer);
    return { peer, room };
  }

  /**
   * Remove a peer from a room.
   */
  public removePeer(
    meetingId: string,
    peerId: string
  ): { remainingPeersCount: number; newHostId?: string; freedColor?: string } | undefined {
    const room = this.rooms.get(meetingId);
    if (!room) return undefined;

    const peerIndex = room.peers.findIndex((p) => p.id === peerId);
    if (peerIndex === -1) return undefined;

    const [removedPeer] = room.peers.splice(peerIndex, 1);
    const remainingPeersCount = room.peers.length;

    let newHostId: string | undefined = undefined;

    if (remainingPeersCount === 0) {
      // Room empty -> delete
      this.rooms.delete(meetingId);
      return { remainingPeersCount: 0, freedColor: removedPeer.color };
    }

    // If removed peer was host, reassign host to the next oldest peer
    if (room.hostId === peerId) {
      const nextHost = room.peers[0];
      nextHost.isHost = true;
      room.hostId = nextHost.id;
      newHostId = nextHost.id;
    }

    return {
      remainingPeersCount,
      newHostId,
      freedColor: removedPeer.color,
    };
  }

  /**
   * Transfer host rights to a specific peer.
   */
  public setHost(meetingId: string, targetPeerId: string): boolean {
    const room = this.rooms.get(meetingId);
    if (!room) return false;

    const targetPeer = room.peers.find((p) => p.id === targetPeerId);
    if (!targetPeer) return false;

    for (const peer of room.peers) {
      peer.isHost = peer.id === targetPeerId;
    }
    room.hostId = targetPeerId;
    return true;
  }

  /**
   * Update peer attributes (e.g. mute status, screen share status)
   */
  public updatePeer(meetingId: string, peerId: string, updates: Partial<Peer>): Peer | undefined {
    const room = this.rooms.get(meetingId);
    if (!room) return undefined;

    const peer = room.peers.find((p) => p.id === peerId);
    if (!peer) return undefined;

    Object.assign(peer, updates);
    return peer;
  }

  /**
   * Record a drawing stroke into room state and prune expired annotations.
   */
  public addOrUpdateStroke(meetingId: string, stroke: Stroke): void {
    const room = this.rooms.get(meetingId);
    if (!room) return;

    const now = Date.now();
    // Prune expired strokes older than 5.5s (5s life + 0.5s fade)
    room.strokes = room.strokes.filter((s) => now - (s.timestamp || now) <= 5500);

    const existing = room.strokes.find((s) => s.id === stroke.id);
    if (existing) {
      if (stroke.points && stroke.points.length > 0) {
        existing.points = [...existing.points, ...stroke.points];
      }
      existing.timestamp = stroke.timestamp || now;
    } else {
      if (stroke.points && stroke.points.length > 0) {
        room.strokes.push({
          ...stroke,
          timestamp: stroke.timestamp || now,
        });
      }
    }
  }

  /**
   * Clear drawing strokes.
   */
  public clearStrokes(meetingId: string, peerId?: string, scope: 'own' | 'all' = 'own'): void {
    const room = this.rooms.get(meetingId);
    if (!room) return;

    if (scope === 'all') {
      room.strokes = [];
    } else if (peerId) {
      room.strokes = room.strokes.filter((s) => s.peerId !== peerId);
    }
  }

  /**
   * Delete room and its state.
   */
  public deleteRoom(meetingId: string): void {
    this.rooms.delete(meetingId);
  }
}

const globalForRooms = globalThis as unknown as {
  collaboRoomManager: RoomManager | undefined;
};

export const roomManager = globalForRooms.collaboRoomManager ?? new RoomManager();

globalForRooms.collaboRoomManager = roomManager;
