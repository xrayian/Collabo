# init.md — Collabo (Screen-Draw Meeting Platform, SFU-based)

## 1. Product Overview

**Collabo** is a browser-based, invite-only meeting tool built around one
core interaction: **one person shares their screen, everyone else draws on
top of it in real time, and everyone talks over audio.** Presenting rights
("host") can be handed to anyone in the room.

This is not a Zoom/Meet clone. There is no face video and no text chat — the
product is deliberately narrow: **shared screen + live multi-user annotation +
voice.**

**Architecture note:** media (audio + screen video) is routed through a
server-side SFU (Selective Forwarding Unit), not a peer-to-peer mesh. Each
client has exactly one WebRTC connection — to the server — which fans media
out to everyone else. The server forwards RTP packets without decoding or
transcoding them, so it's cheap to run, but it does mean media is no longer
literally peer-to-peer at the network level. Keep that distinction in mind
when naming things internally — the *product* still feels like a direct
call between people, the *transport* is now client↔server↔client.

## 2. Explicit Non-Goals

Do not build these, even if they seem like natural additions:

- Webcam / face video
- Text chat
- Meeting recording or transcription
- User accounts / persistent login
- Persistent drawing history across sessions

## 3. Core Feature List

1. **Host a meeting** — any user can start a meeting. This generates:
   - a unique meeting link (`/join/[meetingId]`)
   - a short auth code (e.g. 6-char alphanumeric)
2. **Join a meeting** — user opens the link, enters **name + auth code**. No
   accounts.
3. **Returning-user convenience** — if the browser has previously stored a
   display name in `sessionStorage`, pre-fill it on the join form.
4. **Screen sharing** — the current host shares their screen; everyone else
   sees it live, delivered via the SFU.
5. **Presenter handoff** — host role (and therefore who is screen-sharing)
   can be transferred to any other participant at any time.
6. **Live drawing overlay** — every participant can draw directly on top of
   the shared screen, and those drawings appear live for **everyone in the
   call, including the current host** — the same way Slack huddle screen
   annotation works. Each participant is assigned a distinct color for the
   lifetime of the call; their strokes always render in that color.
7. **Audio conferencing** — all participants can talk to each other
   simultaneously (mic on/off toggle, no video), routed through the SFU.
8. **Capacity** — support up to **10 concurrent participants** per meeting.
9. **Mobile-friendly UI** — fully usable (viewing, drawing, talking) on a
   phone-sized viewport. Screen-*sharing* is a secondary concern on mobile
   (see §13).

## 4. Tech Stack

- **Next.js** (App Router) — UI, routing, meeting-creation API route
- **A custom Node server** hosting both the WebSocket signaling layer and the
  **mediasoup** SFU — see §13, this cannot run on Vercel-style serverless
  functions
- **mediasoup** — the SFU itself. Recommended over LiveKit/Janus for this
  project specifically because it's a Node.js library, not a separate
  service in another language, so it lives in the same codebase/process
  family as your signaling server. (If you'd rather not hand-write the
  producer/consumer signaling flow yourself, **LiveKit** is the easier
  turnkey alternative — self-hosted or cloud, with a very clean client SDK —
  at the cost of running a separate Go-based service.)
- **WebRTC browser APIs** (`getDisplayMedia`, `getUserMedia`,
  `RTCPeerConnection` under the hood via mediasoup-client) — capture only;
  actual routing is server-side
- **Canvas API** (`<canvas>` + Pointer Events) for the draw overlay
- **Tailwind CSS** for styling
- **lucide-react** for all icons — no other icon set, no emoji
- **`sessionStorage`** for remembering the user's display name between visits

## 5. Architecture

### 5.1 One server process, three jobs

- **Next.js** serves pages and a small REST/API surface (create meeting,
  validate a meeting exists).
- **WebSocket signaling** is the source of truth for *room state* and also
  carries the mediasoup handshake:
  - who's in the room, their assigned color, who is host
  - relays the mediasoup transport/producer/consumer handshake (see §5.2)
  - relays drawing strokes to the room
  - enforces the 10-participant cap and auth-code check
- **mediasoup** does the actual media work: one `Router` per meeting room,
  `WebRtcTransport`s per client, `Producer`s for outgoing tracks, `Consumer`s
  for incoming ones.

Room state (and its mediasoup `Router`) lives in memory (a
`Map<meetingId, RoomState>`) — no database needed for v1. A meeting and its
router are torn down when the last participant leaves.

### 5.2 Media topology (server-relayed, star not mesh)

Every client has **one** connection to the server (in mediasoup terms, a
send transport + a receive transport), not a connection per peer:

- **Everyone produces one audio track** (their mic) to the server.
- **The current host additionally produces one video track** (their screen).
  Non-host participants never produce video.
- **Every client consumes**: all other participants' audio tracks, plus the
  host's video track (skipped for the host itself — see §5.4, the host uses
  a local self-preview instead of consuming its own video back).

So for N=10: 10 audio producers + 1 video producer flowing into the server;
the server fans those back out as consumers to whoever needs them. Nobody's
browser manages more than one underlying transport pair, regardless of room
size — this is the main win over mesh, both for client CPU and for the
host's upload, which is now a single stream instead of nine.

### 5.3 Drawing sync goes over the WebSocket, not through mediasoup

Stroke points are small, infrequent, and need a single authoritative order
and an easy way to replay current state to a late joiner — the signaling
server already has room membership, so it's the natural relay point. This
choice is independent of the media architecture: keep drawing coordination
on the plain WebSocket layer rather than routing it through mediasoup data
producers/consumers — it's simpler and there's no latency-sensitive reason
to do otherwise.

### 5.4 The host sees drawings live too (Slack-huddle-annotation behavior)

Annotations are not viewer-only — the current host must see everyone's
strokes appear on their own display in real time, same as everyone else.
This is a rendering detail, not a new sync mechanism: every client (host
included) subscribes to the same `draw-stroke` broadcast and renders it on
the same canvas overlay component.

The only thing that differs for the host is what sits *underneath* the
canvas: the host plays their own local `getDisplayMedia` `MediaStream` in a
muted `<video>` element (a self-preview), rather than consuming their own
video back from the SFU — don't round-trip the host's video through the
server to itself, it's wasteful and adds latency for no benefit. Everyone
else's canvas sits on top of the *remote* video track they consume from the
server. Build one `<ScreenView>` component that takes a video source (local
stream or a mediasoup `Consumer` track) and always renders the shared
`<DrawCanvas>` on top of it, used identically for host and viewers.

## 6. Roles & Permissions

- **Host**: the current presenter. Captures and shares their screen. Can hand
  off the host role to any other participant (that person's browser then
  prompts them for `getDisplayMedia` — there is no way to grab someone's
  screen without their explicit action, so the handoff UI must clearly ask
  the new host to click "Share screen"). On handoff, the old host closes its
  video producer and the new host opens one — the server-side router doesn't
  care who's producing, just that there's at most one active video producer
  per room.
- **Everyone else**: sees the host's screen, can draw on it, can talk. Cannot
  draw-erase other people's strokes (only their own, or a host-only "clear
  all").

## 7. Meeting Creation & Join Flow

1. Landing page → **"Host a meeting"** button.
2. Server generates `meetingId` (short slug, e.g. nanoid) + `authCode`
   (6-char alphanumeric), creates the room, and spins up its mediasoup
   `Router`.
3. Host is prompted for a display name (pre-filled from `sessionStorage` if
   present), joins automatically as host, and sees the shareable link + auth
   code to send to others.
4. Invitee opens the link → form asks for **Name** + **Auth Code** (name
   field pre-filled from `sessionStorage` if set).
5. Client sends `{ meetingId, name, authCode }` to the WS server:
   - wrong code → inline error, no join
   - room already at 10 → inline "meeting full" error
   - success → server assigns a color, returns current room state (who's in
     the call, who's host, current strokes) plus the router's RTP
     capabilities (needed to initialize the mediasoup client device), client
     saves name to `sessionStorage`.
6. Client then completes the mediasoup handshake: create send/receive
   transports, produce its audio (and video, if host), consume everyone
   else's already-active producers.

Do **not** persist the auth code itself in `sessionStorage` — only the
display name.

## 8. Drawing Overlay — Implementation Notes

- A transparent `<canvas>` is layered exactly over the `<video>` element
  showing the host's screen — for every participant, host included (see
  §5.4 for why the host's underlying video source is a local self-preview,
  not a consumed SFU track).
- Store and transmit stroke coordinates **normalized to 0–1** relative to the
  video's intrinsic width/height, not raw pixels — this keeps drawings
  aligned across viewers with different window sizes / mobile vs desktop.
- Use Pointer Events (not just mouse events) so touch drawing works on
  mobile.
- Color assignment is server-side, from a small fixed palette (10
  colorblind-considerate, visually distinct colors), assigned on join and
  released on leave — never two active users with the same color.
- Provide a visible **color legend** (name + swatch) somewhere in the UI so
  people know whose annotation is whose.
- Give each user a "clear my strokes" control; give the host a "clear all"
  control. Strokes otherwise persist until manually cleared (they're
  meant to support an ongoing discussion, not disappear on their own).

## 9. Audio Conferencing — UI Notes

- Mic on/off toggle (lucide `Mic` / `MicOff`) — pauses/resumes the client's
  mediasoup audio producer rather than tearing it down, so re-enabling is
  instant.
- Simple per-participant speaking indicator is a nice-to-have (Web Audio
  `AnalyserNode` on each consumed audio track) — not required for v1.

## 10. UI/UX Requirements

- **Visual language**: professional and restrained. Neutral palette
  (grays/one accent color), clear typography, real whitespace, subtle
  borders/shadows. No gradients-as-decoration, no glow effects, no
  bouncing/pulsing micro-animations, no illustration-heavy empty states —
  avoid anything that reads as generic "AI app" template design.
- **Icons**: `lucide-react` exclusively.
- **Screens**:
  1. Landing — "Host a meeting" / "Join a meeting"
  2. Create-meeting confirmation — link + auth code, copy buttons
  3. Join form — name + auth code
  4. Meeting room — shared screen + draw canvas (dominant), a slim control
     bar (mute, leave, "make me host" / "hand off host", color legend), a
     compact participant strip
- **Mobile**: control bar collapses to icon-only / a bottom sheet on small
  viewports; the shared screen + canvas remain the dominant element; touch
  drawing must work.
- **Component set stays minimal** — build a small reusable kit (Button,
  IconButton, Input, Modal, Toast, Avatar-with-initial-and-color) rather than
  pulling in a heavy component library.

## 11. Suggested Project Structure

```
app/
  page.tsx                     landing
  join/[meetingId]/page.tsx    name + auth code form
  room/[meetingId]/page.tsx    main call UI
  api/meetings/route.ts        create + validate meetings

server/
  ws-server.ts                 custom node server (Next.js + ws)
  rooms.ts                     in-memory room state, color assignment, auth checks
  sfu.ts                       mediasoup worker/router/transport lifecycle management

lib/
  mediasoup-client.ts          client-side Device setup, transport/producer/consumer helpers
  draw-sync.ts                 stroke send/receive + canvas rendering helpers
  session.ts                   sessionStorage read/write helpers

components/
  ui/         Button, IconButton, Input, Modal, Toast, Avatar
  room/       ScreenView, DrawCanvas, ControlBar, ParticipantStrip, ColorLegend
```

## 12. WebSocket Message Schema (starting point)

The mediasoup-specific messages below map directly onto mediasoup's
documented client/server flow (`createWebRtcTransport`, `connect`,
`produce`, `consume`) — follow mediasoup's own docs for the exact
parameter shapes rather than inventing them; the room/draw messages are
this project's own.

```jsonc
// client -> server
{ "type": "join", "meetingId": "abc123", "name": "Rayian", "authCode": "9F2K7Q" }
{ "type": "create-transport", "direction": "send" | "recv" }
{ "type": "connect-transport", "transportId": "t1", "dtlsParameters": { /* ... */ } }
{ "type": "produce", "transportId": "t1", "kind": "audio" | "video", "rtpParameters": { /* ... */ } }
{ "type": "consume", "producerId": "p2-audio", "rtpCapabilities": { /* ... */ } }
{ "type": "resume-consumer", "consumerId": "c1" }
{ "type": "draw-stroke", "points": [[0.12,0.44],[0.13,0.45]], "strokeId": "s1" }
{ "type": "clear-strokes", "scope": "own" }        // or "all" (host only)
{ "type": "request-host" }                          // or "grant-host", "to": "peerId"
{ "type": "leave" }

// server -> client
{ "type": "join-ack", "you": { "id": "p1", "color": "#2563eb" }, "room": { /* full state */ }, "routerRtpCapabilities": { /* ... */ } }
{ "type": "peer-joined", "peer": { "id": "p2", "name": "...", "color": "#..." } }
{ "type": "peer-left", "peerId": "p2" }
{ "type": "new-producer", "peerId": "p2", "producerId": "p2-audio", "kind": "audio" }
{ "type": "producer-closed", "producerId": "p2-audio" }
{ "type": "draw-stroke", "peerId": "p2", "points": [...], "strokeId": "s1" }
{ "type": "clear-strokes", "peerId": "p2", "scope": "own" }
{ "type": "host-changed", "hostId": "p2" }
{ "type": "error", "code": "BAD_AUTH_CODE" | "ROOM_FULL" | "ROOM_NOT_FOUND" }
```

## 13. Deployment & Infra Notes

- **The server needs a long-running process with a real public IP** — it
  cannot run as a Vercel-style serverless function, and this matters more
  than it did for a plain WebSocket relay: mediasoup's `WebRtcTransport`
  needs a `listenIp`/`announcedIp` it can hand out in ICE candidates, so if
  it's behind Docker/NAT you must explicitly set the announced public IP in
  its config, or clients won't be able to connect to it. Deploy this whole
  server (Next.js + WS + mediasoup) on a platform with a static public IP
  and control over exposed ports (a plain VPS is the simplest mental model;
  Fly.io/Render work too but read their docs on UDP/public-IP support
  first).
- **Open a UDP port range** for mediasoup's RTP traffic (commonly something
  like 40000–49999, configurable) in addition to your normal HTTPS/WS ports.
- **TURN is still worth having as a fallback**, but it's a much smaller
  concern than it was under mesh — there's now only one media hop per
  client (client↔server) instead of up to nine, so restrictive networks
  have far fewer chances to block something. A public STUN server plus an
  optional TURN fallback for the worst-case restrictive network is
  reasonable for v1.
- **HTTPS is required** in production for `getDisplayMedia` / `getUserMedia`
  to work at all.
- **Bandwidth is now a server capacity question, not a client one** — this
  is the main benefit of moving off mesh. The host uploads their screen
  exactly once; the server absorbs the fan-out cost of forwarding it (and
  everyone's audio) to the other participants. For a single 10-person room
  with screen capped around 1280×720 @ 8–12fps, total server egress lands
  in the low tens of Mbps — trivial for any real server, and it's a single
  place to monitor/scale rather than depending on each host's home upload
  speed. One `mediasoup Worker`/`Router` per active room is enough at this
  scale; you don't need multi-worker routing (piped transports across
  workers) unless you're running many simultaneous rooms on one box, which
  is a scaling concern beyond this v1's scope.

## 14. Suggested Build Order

1. Scaffold Next.js + Tailwind + lucide-react; landing, create, join, room
   pages/routes (no real functionality yet).
2. WebSocket server: room state, auth-code check, 10-person cap, color
   assignment.
3. Join flow wired end-to-end, including `sessionStorage` name persistence.
4. Stand up mediasoup: one `Worker` + `Router` per room, transport creation,
   and get audio-only conferencing working through the SFU first (every
   client produces + consumes audio).
5. Add the host's screen-share video producer + consumption by everyone
   else.
6. Draw canvas overlay + WebSocket stroke sync + color legend.
7. Presenter handoff flow (close old video producer, open new one).
8. Mobile responsive pass, TURN fallback, reconnect/error handling,
   "meeting full" / "invalid code" edge cases.

## 15. Assumptions to Confirm Before/While Building

- Hard cap is exactly 10 participants, enforced server-side.
- Auth code is valid only while the meeting/room is alive; nothing is
  persisted once everyone leaves.
- No recording, no chat, no face video — confirmed non-goals per §2.
- One mediasoup `Router` per room is sufficient at the 10-participant cap;
  no need for multi-worker/piped-router complexity in v1.