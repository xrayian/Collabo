# init.md — Collabo (Screen-Draw Meeting Platform: Web + Desktop Host App)

## 1. Product Overview

**Collabo** is an invite-only meeting tool built around one core interaction:
**one person shares their screen, everyone else draws on top of it in real
time, and everyone talks over audio.** Presenting rights ("host") can be
handed to anyone in the room.

This is not a Zoom/Meet clone. There is no face video and no text chat — the
product is deliberately narrow: **shared screen + live multi-user annotation +
voice.**

**This is a hybrid product, not a pure web app:**

- **Joining, viewing, and drawing** — fully browser-based. Anyone can open a
  link and participate with nothing to install.
- **Hosting (actively sharing your screen)** — requires **Collabo Desktop**,
  a small Electron app. This is not optional tooling on top of the web
  version — it's the only way to satisfy the actual requirement: other
  people's annotations must appear directly on the **host's real display**,
  visible even while the host is working in a completely different
  application, not just inside a browser tab. No web page can render
  anything outside its own tab — that's a hard boundary of the browser
  sandbox, not a missing permission — so achieving a true on-screen overlay
  requires a native, OS-level, always-on-top window. See §6 for the full
  design.

## 2. Explicit Non-Goals

Do not build these, even if they seem like natural additions:

- Webcam / face video
- Text chat
- Meeting recording or transcription
- User accounts / persistent login
- Persistent drawing history across sessions
- Sharing a specific application window with the live overlay (v1 supports
  **full-display** capture only — see §6.2 for why)

## 3. Core Feature List

1. **Host a meeting** — any user can start a meeting from the web app. This
   generates a unique meeting link (`/join/[meetingId]`) and a short auth
   code (e.g. 6-char alphanumeric). Actually going live as presenter happens
   in Collabo Desktop (see §6.5).
2. **Join a meeting** — user opens the link in a browser, enters **name +
   auth code**. No accounts.
3. **Returning-user convenience** — if the browser has previously stored a
   display name in `sessionStorage`, pre-fill it on the join form.
4. **Screen sharing** — the current host shares their entire screen from
   Collabo Desktop; everyone else sees it live in-browser, delivered via the
   SFU.
5. **Presenter handoff** — host role can be transferred to any other
   participant at any time. If they don't already have Collabo Desktop
   running, they're prompted to launch/install it before the handoff
   completes (see §6.5).
6. **Live drawing overlay** — every participant can draw directly on top of
   the shared screen, and it appears live for everyone, **including on the
   host's actual physical display, regardless of what application the host
   currently has focused** — the same way Slack huddle annotation works, but
   truly system-wide for the host rather than confined to a browser tab.
   Each participant is assigned a distinct color for the lifetime of the
   call; their strokes always render in that color.
7. **Audio conferencing** — all participants can talk to each other
   simultaneously (mic on/off toggle, no video), routed through the SFU.
8. **Capacity** — support up to **10 concurrent participants** per meeting.
9. **Mobile-friendly UI** — the browser side (joining, viewing, drawing,
   talking) is fully usable on a phone-sized viewport. Hosting is a
   desktop-app-only capability and is out of scope for mobile.

## 4. Tech Stack

- **Next.js** (App Router) — the browser-facing app: landing, join, viewer
  room, meeting-creation API
- **Electron** — Collabo Desktop, the host-only native app (see §6)
- **A custom Node server** hosting the WebSocket signaling layer and the
  **mediasoup** SFU — see §14, this cannot run on Vercel-style serverless
  functions
- **mediasoup** — the SFU. Runs identically regardless of whether the
  producer is a browser tab or an Electron renderer process, since Electron
  is Chromium under the hood — no special-casing needed on the server side
  for "desktop vs. web" participants.
- **Canvas API** (`<canvas>` + Pointer Events) for the draw layer — reused
  in three places: the browser viewer's overlay-on-video, the browser host's
  own picker/preview UI, and the Electron overlay window's rendering (see
  §6.1)
- **Tailwind CSS** for styling (web app + Electron control window)
- **lucide-react** for all icons — no other icon set, no emoji
- **`sessionStorage`** for remembering the user's display name between visits
- **Monorepo (pnpm workspaces recommended)** — put shared logic (draw-sync
  helpers, the mediasoup-client wrapper, the minimal UI kit) in a shared
  package so both the Next.js app and the Electron renderer processes import
  the same code instead of duplicating it. See §12 for suggested layout.

## 5. Server-Side Architecture

### 5.1 One server process, three jobs

- **Next.js** serves pages and a small REST/API surface (create meeting,
  validate a meeting exists).
- **WebSocket signaling** is the source of truth for *room state* and also
  carries the mediasoup handshake:
  - who's in the room, their assigned color, who is host
  - relays the mediasoup transport/producer/consumer handshake
  - relays drawing strokes to the room
  - enforces the 10-participant cap and auth-code check
- **mediasoup** does the actual media work: one `Router` per meeting room,
  `WebRtcTransport`s per client, `Producer`s for outgoing tracks, `Consumer`s
  for incoming ones. It does not care or need to know whether a given
  participant is a browser tab or the Electron host app — both look like
  ordinary WebRTC endpoints to it.

Room state (and its mediasoup `Router`) lives in memory (a
`Map<meetingId, RoomState>`) — no database needed for v1.

### 5.2 Media topology (server-relayed, star not mesh)

Every client has one connection to the server (a send transport + a receive
transport):

- **Everyone produces one audio track** (their mic).
- **The current host additionally produces one video track** (their full
  screen, captured natively by Electron — see §6.2 — not via the browser's
  `getDisplayMedia`).
- **Every client consumes**: all other participants' audio, plus the host's
  video (skipped for the host itself, which never consumes its own feed
  back — see §6.1).

### 5.3 Drawing sync goes over the WebSocket, not through mediasoup

Stroke points are small, infrequent, and need a single authoritative order
and an easy way to replay current state to a late joiner. Keep drawing
coordination on the plain WebSocket layer, separate from the mediasoup media
path, regardless of whether the eventual renderer is a browser canvas or the
Electron overlay window — they're just two different subscribers to the
same `draw-stroke` broadcast.

### 5.4 Two different places drawings actually render

- **Every non-host viewer**: a transparent `<canvas>` layered exactly over
  the `<video>` element playing the host's screen, inside their browser tab
  — unchanged from earlier design.
- **The host**: strokes render inside a **native, transparent, always-on-top
  overlay window** managed by Collabo Desktop, positioned over the actual
  physical display being captured — not inside any video element, because
  the host isn't watching a video representation of their own screen, they
  *are* the screen. Full design in §6.1.

Both renderers consume the identical `draw-stroke` messages and the same
normalized (0–1) coordinate scheme — only what they scale those coordinates
against differs (a video element's rendered size vs. the overlay window's
physical pixel bounds).

## 6. Collabo Desktop (Electron Host App)

This is the part of the product that doesn't exist as a normal web feature.
Treat it as its own module with its own care, not an afterthought bolted
onto the web app.

### 6.1 Two windows, two jobs

Collabo Desktop runs **two separate `BrowserWindow`s** while hosting:

1. **Control window** — a normal, framed window. Holds the meeting UI the
   host actually interacts with: display picker, mic mute, leave, hand-off
   host, color legend, participant list. This is where the host's own
   mediasoup producer/consumer logic lives (audio in/out, video producer for
   the captured screen).
2. **Overlay window** — frameless, transparent background, always-on-top,
   **click-through** (`setIgnoreMouseEvents(true, { forward: true })`),
   sized and positioned to exactly cover the physical bounds of the display
   being shared (from `screen.getAllDisplays()`). Its only job is rendering
   incoming strokes on a canvas. It should never intercept clicks or
   keystrokes — the host must be able to use whatever app is underneath
   completely normally.

**Critical requirement — exclude both windows from the host's own screen
capture.** Without this, the overlay (and the control window) would appear
*inside* the video feed being broadcast to everyone else — a visually broken,
recursive result, and it would also double up with each viewer's own local
canvas rendering the same strokes on top of that already-annotated video.
Electron exposes this directly: call `win.setContentProtection(true)` on
both windows (implemented via `NSWindow.sharingType = .none` on macOS and
`SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)` on Windows under the
hood). Verify this empirically against whatever capture path §6.2 ends up
using — display-affinity exclusion has version-dependent behavior on
Windows, so treat it as something to test early, not assume works.

### 6.2 Screen capture: full display only in v1

Use Electron's `desktopCapturer.getSources({ types: ['screen'] })` to
enumerate physical displays (deliberately excluding individual application
windows from the picker). Capturing a single app window instead of a full
display is out of scope for v1 (see §2) because the overlay's positioning
model assumes a fixed, known-bounds target (a monitor) — a window can move,
resize, or be minimized mid-call, which would require continuously
re-tracking and repositioning the overlay, a meaningfully harder problem to
solve well. Full-display capture is also the more natural fit for the
stated use case (annotating whatever the host is doing, across apps).

Match the chosen capture source to a `screen.getAllDisplays()` entry so the
overlay window is placed over the *same* display being captured. Note that
cross-referencing `source.display_id` from `desktopCapturer` against
`Display.id` from the `screen` module is reliable on Windows/macOS but can
be flakier on Linux — fall back to matching by bounds/label if `display_id`
isn't populated, and test this specifically on whatever Linux desktop
environments you intend to support.

### 6.3 Multi-monitor and DPI scaling

- If the host has multiple displays, let them pick which one to share (and
  therefore which one gets the overlay) via the control window.
- Map normalized (0–1) stroke coordinates to the *physical* pixel bounds of
  the target display, accounting for `devicePixelRatio`/OS display-scaling
  settings — a stroke sent from a viewer's browser must land in the same
  relative spot on the host's actual monitor regardless of that monitor's
  scale factor.
- If the shared display is disconnected or its resolution changes mid-call,
  reposition or tear down the overlay window accordingly rather than leaving
  it stranded at stale bounds.

### 6.4 The overlay is always click-through

There's no scenario in this product where the host needs to click on their
own overlay — they're a *recipient* of annotations, not an author of them,
in this window. Keep click-through enabled unconditionally; don't build a
toggle for it unless a real need for one shows up later.

### 6.5 Presenting requires the desktop app — install/handoff flow

- **Creating a meeting** (getting a link + auth code) stays a lightweight
  web action — don't force a desktop install just to generate an invite.
- **Going live as presenter** does require Collabo Desktop. After creating
  a meeting, the web app should offer "Open Collabo Desktop to start
  sharing" — register a custom URL scheme (e.g. `collabo://host/<meetingId>
  ?authCode=...`) that deep-links straight into the app if it's installed,
  with a plain download link as the fallback if it isn't.
- **Handoff follows the same pattern.** If the host transfers presenting
  rights to a participant who's currently browser-only, show them the same
  "open Collabo Desktop to become presenter" prompt with the deep link.
  The outgoing host keeps presenting until the new host's app confirms it's
  live — don't drop the video producer preemptively and leave the room with
  no screen share while the new host is still installing/launching.

## 7. Roles & Permissions

- **Host**: currently presenting, running Collabo Desktop. Can hand off the
  host role to any other participant (subject to §6.5). On handoff, the
  outgoing host closes its video producer once the new host's producer is
  confirmed live.
- **Everyone else**: plain browser participants. See the host's screen, can
  draw on it, can talk. Can only clear their own strokes (host can clear
  all).

## 8. Meeting Creation & Join Flow

1. Landing page (web) → **"Host a meeting"** button.
2. Server generates `meetingId` + `authCode`, creates the room and its
   mediasoup `Router`.
3. Web app shows the link + code, plus the "Open Collabo Desktop to start
   sharing" deep link/download from §6.5.
4. Invitee opens the link in a browser → form asks for **Name** + **Auth
   Code** (name pre-filled from `sessionStorage` if set).
5. Client sends `{ meetingId, name, authCode }` to the WS server:
   - wrong code → inline error, no join
   - room already at 10 → inline "meeting full" error
   - success → server assigns a color, returns room state plus the router's
     RTP capabilities; client saves name to `sessionStorage`.
6. Client (browser or Electron control window — identical from here)
   completes the mediasoup handshake: create send/receive transports,
   produce audio (and video, only if it's the host's Electron app),
   consume everyone else's active producers.

Do **not** persist the auth code itself in `sessionStorage` — only the
display name.

## 9. Drawing Overlay — Browser-Side Implementation Notes

(For the Electron overlay window's implementation, see §6 instead — this
section covers the viewer-side rendering, and the host's own control-window
preview if you choose to show one.)

- A transparent `<canvas>` is layered exactly over the `<video>` element
  showing the host's screen.
- Store and transmit stroke coordinates **normalized to 0–1** relative to
  the video's intrinsic width/height, not raw pixels — this keeps drawings
  aligned across viewers with different window sizes, and is what lets the
  same messages drive the Electron overlay's very different coordinate
  space (§6.3).
- Use Pointer Events (not just mouse events) so touch drawing works on
  mobile.
- Color assignment is server-side, from a small fixed palette (10
  colorblind-considerate, visually distinct colors), assigned on join and
  released on leave.
- Provide a visible **color legend** (name + swatch) so people know whose
  annotation is whose.
- Give each user a "clear my strokes" control; give the host a "clear all"
  control (issued from the control window). Strokes persist until manually
  cleared.

## 10. Audio Conferencing — UI Notes

- Mic on/off toggle (lucide `Mic` / `MicOff`) — pauses/resumes the client's
  mediasoup audio producer rather than tearing it down, so re-enabling is
  instant.
- Simple per-participant speaking indicator is a nice-to-have (Web Audio
  `AnalyserNode` on each consumed audio track) — not required for v1.

## 11. UI/UX Requirements

- **Visual language**: professional and restrained. Neutral palette
  (grays/one accent color), clear typography, real whitespace, subtle
  borders/shadows. No gradients-as-decoration, no glow effects, no
  bouncing/pulsing micro-animations — avoid anything that reads as generic
  "AI app" template design. Keep the web app and the Electron control window
  visually consistent — they're the same product; the overlay window itself
  has no chrome at all, it's purely the strokes.
- **Icons**: `lucide-react` exclusively.
- **Browser screens**: Landing → Create-meeting confirmation (link + code +
  "open desktop app" prompt) → Join form → Viewer room (video + canvas,
  slim control bar, participant strip).
- **Electron control window**: display picker, mic mute, leave, hand-off
  host, color legend, participant list — deliberately plain, it's a utility
  window the host glances at occasionally, not the main focus.
- **Mobile** (browser side only): control bar collapses to icon-only / a
  bottom sheet on small viewports; touch drawing must work.
- **Component set stays minimal** and shared where possible between the web
  app and the Electron control window (Button, IconButton, Input, Modal,
  Toast, Avatar-with-initial-and-color).

## 12. Suggested Project Structure (monorepo)

```
apps/
  web/                          Next.js app
    app/
      page.tsx                  landing
      join/[meetingId]/page.tsx
      room/[meetingId]/page.tsx viewer room
      api/meetings/route.ts     create + validate meetings

  desktop/                      Collabo Desktop (Electron)
    src/
      main/
        index.ts                app entry, window lifecycle
        capture.ts              desktopCapturer + display enumeration (§6.2)
        overlay-window.ts        transparent/click-through/content-protected window (§6.1, §6.3)
        control-window.ts       host control UI window
        deep-link.ts            collabo:// protocol handling (§6.5)
      renderer/
        overlay/                overlay canvas renderer — consumes draw-stroke, maps to display bounds
        control/                host controls UI (mic, leave, hand-off, display picker)
      preload.ts                contextBridge IPC surface

server/
  ws-server.ts                  custom node server (Next.js + ws)
  rooms.ts                      in-memory room state, color assignment, auth checks
  sfu.ts                        mediasoup worker/router/transport lifecycle

packages/
  shared/
    lib/
      mediasoup-client.ts       Device setup, transport/producer/consumer helpers — used by both web viewers and the Electron control window
      draw-sync.ts              stroke send/receive + normalized-coordinate helpers — used by browser canvas, Electron overlay canvas, and any host-side preview
      session.ts                sessionStorage helpers (web only)
    ui/                         shared Button/IconButton/Input/Modal/Toast/Avatar kit
```

## 13. WebSocket Message Schema (starting point)

The mediasoup-specific messages map directly onto mediasoup's documented
client/server flow (`createWebRtcTransport`, `connect`, `produce`,
`consume`) — follow mediasoup's own docs for exact parameter shapes; the
room/draw messages are this project's own, and are identical regardless of
whether the client is a browser tab or the Electron control window.

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

## 14. Deployment & Infra Notes

- **The server needs a long-running process with a real public IP.**
  mediasoup's `WebRtcTransport` needs a `listenIp`/`announcedIp` it can hand
  out in ICE candidates — if it's behind Docker/NAT you must explicitly set
  the announced public IP, or clients won't connect. A plain VPS is the
  simplest mental model.
- **Open a UDP port range** for mediasoup's RTP traffic (e.g. 40000–49999)
  in addition to your normal HTTPS/WS ports.
- **TURN as a fallback** for restrictive networks is worth having, though
  it's a smaller concern than under a mesh design — there's only one media
  hop per client now.
- **HTTPS is required** for `getUserMedia` (mic) even for browser-only
  viewers; Electron's `desktopCapturer` isn't subject to the same
  same-origin/HTTPS constraint since it's a privileged main-process API.
- **Bandwidth is a server capacity question**, not a client one — the host
  uploads their screen once; the server fans it out. Low tens of Mbps total
  for a single 10-person room at a capped ~1280×720 @ 8–12fps is a
  reasonable planning number.
- **Collabo Desktop needs its own build/release pipeline**, separate from
  the web app's deploy: package with `electron-builder` (or
  `electron-forge`), code-sign for macOS (notarization) and Windows (or
  users will hit scary "unknown publisher" warnings that will tank
  adoption), and wire up auto-updates (e.g. `electron-updater`) so a fix to
  the overlay/capture logic doesn't require everyone to manually reinstall.
- **Platform support caveat**: the transparent/click-through/always-on-top/
  content-protected overlay pattern is solid on **Windows and macOS**. On
  **Linux**, especially under Wayland, compositors deliberately restrict
  this kind of global overlay for security reasons — expect it to be
  unreliable or unsupported there, and treat X11-only as the realistic v1
  target if Linux hosting matters to you at all.

## 15. Suggested Build Order

1. Scaffold the monorepo (Next.js web app + empty Electron shell + shared
   package), Tailwind + lucide-react in both.
2. WebSocket server: room state, auth-code check, 10-person cap, color
   assignment.
3. Browser join flow end-to-end, including `sessionStorage` name
   persistence.
4. Stand up mediasoup: one `Worker`+`Router` per room; get audio-only
   conferencing working between browser clients first.
5. Build the Electron control window and get it producing audio through the
   same mediasoup flow as a browser client (proves the shared client logic
   works identically in both environments) — no capture or overlay yet.
6. Add `desktopCapturer`-based screen capture in Electron, publish it as the
   host's video producer, confirm browser viewers can see it.
7. Build the Electron overlay window: transparent, click-through, content-
   protected, positioned over the captured display; wire it to the same
   `draw-stroke` broadcast the browser viewers use.
8. Wire up the deep-link (`collabo://`) install/launch flow for going live
   and for handoff.
9. Multi-monitor + DPI-scaling correctness pass on the overlay.
10. Mobile responsive pass on the browser side; TURN fallback; reconnect/
    error handling; "meeting full" / "invalid code" edge cases.
11. Electron packaging, code signing, auto-update setup.

## 16. Assumptions to Confirm Before/While Building

- Hard cap is exactly 10 participants, enforced server-side.
- Auth code is valid only while the meeting/room is alive.
- No recording, no chat, no face video — confirmed non-goals per §2.
- v1 hosting supports full-display capture only, not a single application
  window (§6.2) — revisit if that turns out to matter to real usage.
- One mediasoup `Router` per room is sufficient at the 10-participant cap.
- Linux hosting (running Collabo Desktop as the presenter) is best-effort/
  X11-only for v1, per §14.