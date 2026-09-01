/**
 * electron/preload-overlay.ts
 * Preload script for the transparent click-through desktop overlay window.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('overlayAPI', {
  onDrawStroke: (callback: (stroke: any) => void) => {
    const handler = (_event: any, stroke: any) => callback(stroke);
    ipcRenderer.on('draw-stroke', handler);
    return () => ipcRenderer.removeListener('draw-stroke', handler);
  },
  onClearStrokes: (callback: (data: { peerId?: string; scope: 'own' | 'all' }) => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('clear-strokes', handler);
    return () => ipcRenderer.removeListener('clear-strokes', handler);
  },
  onResizeDisplay: (callback: (bounds: { width: number; height: number }) => void) => {
    const handler = (_event: any, bounds: any) => callback(bounds);
    ipcRenderer.on('display-bounds-changed', handler);
    return () => ipcRenderer.removeListener('display-bounds-changed', handler);
  },
});
