/**
 * electron/main.ts
 * Main process for Collabo Desktop (Host App with native transparent overlay).
 */
import { app, BrowserWindow, ipcMain, screen, desktopCapturer, session } from 'electron';
import * as path from 'path';

let controlWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let activeDisplayId: string | null = null;
let pendingDeepLink: { meetingId: string; authCode: string } | null = null;

// Protocol registration for collabo://
const PROTOCOL_NAME = 'collabo';
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_NAME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_NAME);
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (controlWindow) {
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    }
    const deepLinkUrl = commandLine.find((arg) => arg.startsWith(`${PROTOCOL_NAME}://`));
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

function parseCollaboUrl(rawUrl: string): { meetingId: string; authCode: string } | null {
  try {
    // e.g. collabo://host/abc123?code=XY78ZT or collabo://join/abc123?authCode=...
    const url = new URL(rawUrl);
    const meetingId = url.pathname.replace(/^\/+/, '').split('/')[0] || url.host;
    const authCode = url.searchParams.get('code') || url.searchParams.get('authCode') || '';
    if (meetingId) {
      return { meetingId, authCode };
    }
  } catch (err) {
    console.warn('[Main] Failed to parse deep link URL:', rawUrl, err);
  }
  return null;
}

function handleDeepLink(urlStr: string) {
  const parsed = parseCollaboUrl(urlStr);
  if (!parsed) return;

  if (controlWindow && !controlWindow.isDestroyed() && controlWindow.webContents) {
    controlWindow.webContents.send('deep-link-meeting', parsed);
  } else {
    pendingDeepLink = parsed;
  }
}

// Handle macOS open-url
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

/**
 * Creates the Host Control Window.
 */
function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Collabo Desktop Host',
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // Protect control window from being captured into screen share (§6.1)
  try {
    controlWindow.setContentProtection(true);
  } catch (err) {
    console.warn('[Main] setContentProtection on control window:', err);
  }

  // Load Desktop Host URL from environment or local dev server
  const hostUrl = process.env.COLLABO_HOST_URL || 'http://localhost:3000/desktop-host';
  controlWindow.loadURL(hostUrl);

  controlWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink && controlWindow) {
      controlWindow.webContents.send('deep-link-meeting', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null;
    }
  });
}

/**
 * Creates or updates the native transparent overlay window over the target display.
 */
function createOrUpdateOverlayWindow(targetDisplayId?: string) {
  const displays = screen.getAllDisplays();
  let targetDisplay = displays.find((d) => String(d.id) === String(targetDisplayId));
  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay();
  }

  activeDisplayId = String(targetDisplay.id);
  const bounds = targetDisplay.bounds;

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setBounds(bounds);
    overlayWindow.showInactive();
    overlayWindow.webContents.send('display-bounds-changed', bounds);
    return bounds;
  }

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-overlay.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Always on top above all windows / full-screen apps (§6.1)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // Click-through: ignore all mouse events and pass through to underlying desktop apps (§6.1, §6.4)
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Exclude overlay window from screen capture so annotations don't get captured into outgoing video (§6.1)
  try {
    overlayWindow.setContentProtection(true);
  } catch (err) {
    console.warn('[Main] setContentProtection on overlay window:', err);
  }

  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return bounds;
}

/**
 * IPC Handlers
 */
function setupIpc() {
  // Enumerate physical screen capture sources
  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });

    const displays = screen.getAllDisplays();

    return sources.map((source, index) => {
      // Cross-reference display
      let matchedDisplay = displays.find((d) => String(d.id) === String(source.display_id));
      if (!matchedDisplay && displays[index]) {
        matchedDisplay = displays[index];
      }

      return {
        id: source.id,
        name: source.name || `Screen ${index + 1}`,
        display_id: source.display_id || (matchedDisplay ? String(matchedDisplay.id) : ''),
        thumbnailUrl: source.thumbnail ? source.thumbnail.toDataURL() : '',
        width: matchedDisplay?.bounds.width,
        height: matchedDisplay?.bounds.height,
      };
    });
  });

  // Start / Show Desktop Overlay
  ipcMain.handle('start-overlay', async (_event, displayId?: string) => {
    const bounds = createOrUpdateOverlayWindow(displayId);
    return { success: true, bounds };
  });

  // Stop / Hide Desktop Overlay
  ipcMain.handle('stop-overlay', async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
      overlayWindow = null;
    }
    return { success: true };
  });

  // Relay stroke to overlay window
  ipcMain.on('relay-stroke', (_event, stroke) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('draw-stroke', stroke);
    }
  });

  // Relay clear to overlay window
  ipcMain.on('relay-clear', (_event, scope) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('clear-strokes', scope);
    }
  });
}

// Display metrics change tracking
screen?.on('display-metrics-changed', () => {
  if (overlayWindow && !overlayWindow.isDestroyed() && activeDisplayId) {
    createOrUpdateOverlayWindow(activeDisplayId);
  }
});

app.whenReady().then(() => {
  setupIpc();
  createControlWindow();

  // Handle deep link from launch argv
  const deepLinkArg = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_NAME}://`));
  if (deepLinkArg) {
    handleDeepLink(deepLinkArg);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createControlWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
