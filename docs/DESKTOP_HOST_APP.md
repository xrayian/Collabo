# Collabo Desktop (Electron Host App)

Collabo Desktop is a native application for presenters on **Windows and macOS** that enables real-time collaborative drawing over the host's actual operating system desktop.

---

## 1. Why a Native Desktop App is Required

In modern web browsers, the security sandbox strictly confines rendering to the browser's own viewport. A web page cannot render floating transparent pixels over external OS applications such as VS Code, Figma, Terminal, or CAD tools.

Collabo Desktop bridges this gap using a **Two-Window Native Architecture**:

```
+-------------------------------------------------------------+
| Physical Monitor (1920x1080 / 4K)                           |
|                                                             |
|  +-------------------------------------------------------+  |
|  | Underlying OS Applications (VS Code, Browser, etc.)   |  |
|  | [Fully interactive — mouse clicks pass straight here] |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  + - - - - - - - - - - - - - - - - - - - - - - - - - - - +  |
|  | Native Transparent Overlay Window                     |  |
|  | - transparent: true, frame: false                     |  |
|  | - alwaysOnTop: true ('screen-saver' level)            |  |
|  | - setIgnoreMouseEvents(true, { forward: true })       |  |
|  | - setContentProtection(true)                          |  |
|  |                                                       |  |
|  |   [Live Annotations from Participants Render Here]    |  |
|  + - - - - - - - - - - - - - - - - - - - - - - - - - - - +  |
+-------------------------------------------------------------+
```

---

## 2. Window Roles & Implementation Details

### 2.1 Control Window ([`electron/main.ts`](file:///C:/projects/Collabo/electron/main.ts), [`app/desktop-host/page.tsx`](file:///C:/projects/Collabo/app/desktop-host/page.tsx))
- Framed utility window for meeting management.
- Features physical monitor picker (`desktopCapturer.getSources`), microphone mute toggle, attendee list, color legend, clear all annotations, and presenter handoff.
- Protected with `setContentProtection(true)` so the control dashboard is not captured into the shared screen video feed.

### 2.2 Transparent Overlay Window ([`electron/overlay.html`](file:///C:/projects/Collabo/electron/overlay.html), [`electron/preload-overlay.ts`](file:///C:/projects/Collabo/electron/preload-overlay.ts))
- Frameless, background-transparent, always-on-top window sized to match the physical monitor bounds.
- Configured with `setIgnoreMouseEvents(true, { forward: true })` so all keyboard and mouse interactions pass unimpeded to the host's underlying applications.
- Configured with `setContentProtection(true)` to prevent recursive screen-in-screen video capture.
- Runs a 60fps `requestAnimationFrame` render loop executing the 5s lifetime + 0.5s blur-fade-away transition.

---

## 3. Deep Linking (`collabo://` Protocol)

Collabo Desktop registers the custom protocol handler `collabo`:

```
collabo://host/[meetingId]?code=[authCode]
```

When a host creates a meeting or is granted presenter rights from a web browser, clicking **"Host with Desktop App"** invokes the operating system protocol handler, focusing Collabo Desktop and joining the session seamlessly.
