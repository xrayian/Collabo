/**
 * electron/preload.ts
 * Preload script for the Collabo Desktop Host Control Window.
 */
import { contextBridge, ipcRenderer } from 'electron';

export interface ScreenSourceInfo {
  id: string;
  name: string;
  display_id: string;
  thumbnailUrl: string;
  width?: number;
  height?: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Get server URL injected or configured for this client
  getServerUrl: async (): Promise<string> => {
    return ipcRenderer.invoke('get-server-url');
  },

  // Query physical screens
  getScreenSources: async (): Promise<ScreenSourceInfo[]> => {
    return ipcRenderer.invoke('get-screen-sources');
  },

  // Desktop overlay management
  startOverlay: async (displayId?: string): Promise<{ success: boolean; bounds: any }> => {
    return ipcRenderer.invoke('start-overlay', displayId);
  },

  stopOverlay: async (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('stop-overlay');
  },

  // Relay stroke annotations to the native overlay window
  relayStrokeToOverlay: (stroke: any) => {
    ipcRenderer.send('relay-stroke', stroke);
  },

  relayClearToOverlay: (scope: any) => {
    ipcRenderer.send('relay-clear', scope);
  },

  // Listen for deep-linked meeting invites (collabo://host/... or collabo://join/...)
  onDeepLinkMeeting: (callback: (data: { meetingId: string; authCode: string; mode?: 'host' | 'join' }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('deep-link-meeting', handler);
    return () => ipcRenderer.removeListener('deep-link-meeting', handler);
  },
});
