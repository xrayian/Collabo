# AGENTS.md — Collabo Developer & Agent Guidelines

## 1. Project Overview & Philosophy

**Collabo** is a focused, invite-only screen-draw meeting web application:
- **Core interaction:** One participant shares their screen, everyone else draws on top in real time, and everyone communicates via high-quality audio.
- **Presenter handoff:** Host privileges (screen-sharing rights) can be transferred seamlessly to any participant.
- **Topology:** Star architecture via server-side SFU (**mediasoup**). Clients maintain 1 WebRTC connection (send/receive transports) to the server rather than a peer-to-peer mesh.
- **Drawing sync:** Managed over standard WebSockets (`ws`) with normalized 0–1 coordinates for resolution and device independence.
- **Design tone:** Restrained, modern, clean, utility-first design using Tailwind CSS and `lucide-react` exclusively.

### Explicit Non-Goals (DO NOT BUILD)
- ❌ Webcam / face video
- ❌ Text chat
- ❌ Meeting recording or transcription
- ❌ Persistent user accounts / authentication databases
- ❌ Persistent drawing history across sessions

---

## 2. Tech Stack & Key Libraries

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js (App Router, TypeScript) | Page routing, UI rendering, API routes |
| **Styling & UI** | Tailwind CSS + Lucide React | Minimal component kit, responsive layout |
| **SFU Engine** | mediasoup (Node.js) | Worker/Router/Transport management, audio & screen-video RTP routing |
| **WebRTC Client** | mediasoup-client | Client-side Device initialization, Send/Receive transports |
| **Signaling & State**| WebSocket (`ws`) | Room state, join validation, drawing stroke sync, presenter handoffs |
| **Drawing Canvas** | HTML5 Canvas + Pointer Events | Normalized drawing overlay, touch & pen support |
| **Session Cache** | `sessionStorage` | Storing display name for pre-filling join inputs (auth code NOT persisted) |

---

## 3. Directory Structure

```
Collabo/
├── app/
│   ├── layout.tsx                # Root layout with fonts, metadata, toast provider
│   ├── page.tsx                  # Landing page (Host a meeting / Join a meeting)
│   ├── join/[meetingId]/page.tsx # Direct join page (Name + Auth Code)
│   ├── room/[meetingId]/page.tsx # Active meeting room UI
│   └── api/
│       └── meetings/route.ts     # Create / validate meeting API
├── server/
│   ├── ws-server.ts              # Custom Node.js server orchestrating Next.js + WS + mediasoup
│   ├── rooms.ts                  # In-memory RoomManager, peer state, color assignment, auth checks
│   ├── sfu.ts                    # mediasoup SFU worker, router, and transport lifecycle manager
│   └── config.ts                 # Port ranges, listen IPs, mediasoup RTP capabilities & worker settings
├── lib/
│   ├── mediasoup-client.ts       # Client-side Device, Transports, Audio & Screen Producers/Consumers
│   ├── draw-sync.ts              # Canvas stroke synchronization, normalized coordinate math, rendering
│   ├── session.ts                # sessionStorage helpers for display name persistence
│   └── types.ts                  # Shared TypeScript interfaces (Room, Peer, Strokes, WS messages)
├── components/
│   ├── ui/                       # Minimal custom UI kit (Button, IconButton, Input, Modal, Toast, Avatar)
│   └── room/                     # ScreenView, DrawCanvas, ControlBar, ParticipantStrip, ColorLegend
├── public/                       # Static assets
├── .agy/tmp/                     # Agent temporary files and scratch storage
├── AGENTS.md                     # Agent developer guide (this file)
└── init.md                       # Product requirement specification
```

---

## 4. Architecture & Data Flow

### 4.1 Signaling & Room Management
- **In-Memory State (`Map<string, RoomState>`):** Rooms exist entirely in server memory. When the last participant disconnects, the room and its associated mediasoup `Router` are torn down.
- **Room Capacity:** Capped at **10 concurrent participants**. Attempted joins past 10 are rejected with `ROOM_FULL`.
- **Auth Code:** A 6-character alphanumeric code generated at meeting creation. Joins with incorrect codes are rejected with `BAD_AUTH_CODE`.
- **Palette & Color Assignment:** Fixed palette of 10 high-contrast, colorblind-friendly colors. Assigned dynamically upon joining and freed upon leaving.

### 4.2 SFU Media Topology (Star Network)
- Each client opens:
  1. **Send Transport** (produces audio, and video if host)
  2. **Receive Transport** (consumes peers' audio + host's screen video)
- **Audio:** Every peer produces 1 audio track. The server creates consumer tracks on all other peers. Muting uses `producer.pause()` / `producer.resume()`.
- **Video (Screen Share):** Only the current Host produces 1 screen video track.
  - Viewers consume the host's video track via their receive transport.
  - The Host renders a **local self-preview** via `getDisplayMedia` stream in a muted `<video>` to eliminate latency and save server bandwidth.

### 4.3 Drawing Synchronization
- **Coordinate System:** All stroke coordinates are normalized $(x, y \in [0.0, 1.0])$ relative to the video container aspect ratio.
- **Input Handling:** Pointer Events (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) provide native desktop mouse, stylus, and mobile touch support.
- **Relay Mechanism:** Broadcasted immediately through WebSockets to all room participants (including the host).
- **Stroke Clearing:**
  - Regular participant: Can trigger `clear-strokes` with `scope: "own"`.
  - Host: Can trigger `clear-strokes` with `scope: "all"` or `scope: "own"`.

---

## 5. WebSocket Protocol Specification

### Client -> Server
```typescript
type ClientMessage =
  | { type: 'join'; meetingId: string; name: string; authCode: string }
  | { type: 'create-transport'; direction: 'send' | 'recv' }
  | { type: 'connect-transport'; transportId: string; dtlsParameters: any }
  | { type: 'produce'; transportId: string; kind: 'audio' | 'video'; rtpParameters: any }
  | { type: 'consume'; producerId: string; rtpCapabilities: any }
  | { type: 'resume-consumer'; consumerId: string }
  | { type: 'pause-producer'; producerId: string }
  | { type: 'resume-producer'; producerId: string }
  | { type: 'close-producer'; producerId: string }
  | { type: 'draw-stroke'; strokeId: string; points: Array<[number, number]>; isEnd?: boolean }
  | { type: 'clear-strokes'; scope: 'own' | 'all' }
  | { type: 'request-host' }
  | { type: 'grant-host'; targetPeerId: string }
  | { type: 'leave' };
```

### Server -> Client
```typescript
type ServerMessage =
  | { type: 'join-ack'; you: { id: string; name: string; color: string; isHost: boolean }; room: RoomState; routerRtpCapabilities: any }
  | { type: 'peer-joined'; peer: { id: string; name: string; color: string; isHost: boolean } }
  | { type: 'peer-left'; peerId: string }
  | { type: 'new-producer'; peerId: string; producerId: string; kind: 'audio' | 'video' }
  | { type: 'producer-closed'; producerId: string; peerId: string; kind: 'audio' | 'video' }
  | { type: 'producer-paused'; producerId: string }
  | { type: 'producer-resumed'; producerId: string }
  | { type: 'draw-stroke'; peerId: string; color: string; strokeId: string; points: Array<[number, number]>; isEnd?: boolean }
  | { type: 'clear-strokes'; peerId?: string; scope: 'own' | 'all' }
  | { type: 'host-changed'; hostId: string }
  | { type: 'error'; code: 'BAD_AUTH_CODE' | 'ROOM_FULL' | 'ROOM_NOT_FOUND' | 'UNAUTHORIZED' | 'SERVER_ERROR'; message: string };
```

---

## 6. Development Workflow & Commands

- **Install dependencies:** `npm install`
- **Run development server (Next.js + Custom WS/SFU server):** `npm run dev` or `tsx server/ws-server.ts`
- **Build production bundle:** `npm run build`
- **Build desktop host app:** `npm run build:electron`
- **Run desktop host app:** `npm run desktop` or `npm run electron:start`
- **Run all automated tests:** `npm test`
  - E2E Room & SFU suite: `npm run test:e2e`
  - Freeform open curve drawing: `npm run test:freeform`
  - 5s lifetime + 0.5s blur-fade-away TTL: `npm run test:ttl`
- **Run production server:** `npm start`
- **Typecheck:** `npm run typecheck` or `npx tsc --noEmit`

---

## 7. Operational & Implementation Rules for Agents

1. **Keep UI Restrained:** Use standard Tailwind neutral colors (`slate`, `zinc`), clean monospace for codes, rounded borders, crisp typography, and `lucide-react` icons. No gimmicky animations or unnecessary visual clutter.
2. **Handle Edge Cases Gracefully:**
   - Host leaves room -> Server auto-promotes next participant to host.
   - Screen-share stopped by browser UI (native browser "Stop Sharing" button) -> Clean up video producer, notify room.
   - Network reconnects / invalid codes -> Show explicit, clear error messages with return-to-home actions.
3. **Responsive Mobile Experience:** Screen + draw canvas scale smoothly while retaining aspect ratio; control bar collapses cleanly to mobile-friendly icon layout.
