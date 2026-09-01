'use client';

/**
 * components/room/ScreenView.tsx
 * Screen presentation container with layered DrawCanvas overlay, Fullscreen, and Zoom controls.
 */
import React, { useRef, useEffect, useState } from 'react';
import {
  Monitor,
  Share2,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { DrawCanvas } from './DrawCanvas';
import { Stroke, StrokePoint } from '@/lib/types';
import { Button } from '../ui/Button';

export interface ScreenViewProps {
  stream: MediaStream | null;
  isHost: boolean;
  isSharing: boolean;
  myColor: string;
  strokes: Stroke[];
  meetingId?: string;
  authCode?: string;
  onStartShare?: () => void;
  onSendStroke: (points: StrokePoint[], strokeId: string, isEnd?: boolean) => void;
}

export const ScreenView: React.FC<ScreenViewProps> = ({
  stream,
  isHost,
  isSharing,
  myColor,
  strokes,
  meetingId,
  authCode,
  onStartShare,
  onSendStroke,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Attach stream to video element and trigger play
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      if (stream) {
        videoRef.current.play().catch((err) => {
          console.warn('[ScreenView] Video play note:', err?.message);
        });
      }
    }
  }, [stream]);

  // Track fullscreen changes from browser API or ESC key
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const updateAspectRatio = () => {
    if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
      const ratio = videoRef.current.videoWidth / videoRef.current.videoHeight;
      setAspectRatio(ratio);
      // Ensure video is actively playing
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const handleToggleFullscreen = async () => {
    if (!wrapperRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await wrapperRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('[ScreenView] Fullscreen error:', err);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(2.5, Number((prev + 0.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(1, Number((prev - 0.25).toFixed(2))));
  };

  const handleResetZoom = () => {
    setZoomLevel(1);
  };

  const hasActiveStream = !!stream;

  return (
    <div
      ref={wrapperRef}
      className={`relative w-full h-full flex items-center justify-center bg-zinc-950 select-none ${
        zoomLevel > 1 ? 'overflow-auto' : 'overflow-hidden'
      } p-1 sm:p-2`}
    >
      {hasActiveStream ? (
        <>
          {/* Zoom and Fullscreen Floating Toolbar */}
          <div className="absolute top-4 right-4 z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-zinc-900/90 backdrop-blur-md border border-zinc-800 shadow-2xl text-zinc-300">
            {/* Zoom Out */}
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoomLevel <= 1}
              className="p-1 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-zinc-300 hover:text-white"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            {/* Current Zoom Level / Reset */}
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-1.5 py-0.5 rounded text-xs font-mono font-medium hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
              title="Reset Zoom (Fit to Screen)"
            >
              {Math.round(zoomLevel * 100)}%
            </button>

            {/* Zoom In */}
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoomLevel >= 2.5}
              className="p-1 rounded-lg hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-zinc-300 hover:text-white"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="h-4 w-px bg-zinc-700/60 mx-0.5" />

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Zoom to Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Zoom to Fullscreen'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 text-blue-400" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Sized Presentation & Drawing Container */}
          <div
            className="relative max-w-full max-h-full flex items-center justify-center rounded-xl overflow-hidden shadow-2xl bg-black border border-zinc-900 transition-transform duration-150 ease-out"
            style={{
              aspectRatio: `${aspectRatio}`,
              transform: zoomLevel > 1 ? `scale(${zoomLevel})` : undefined,
              transformOrigin: 'center center',
            }}
          >
            {/* Screen Video Element (muted to guarantee autoplay and prevent audio loop) */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={updateAspectRatio}
              onLoadedData={updateAspectRatio}
              onPlay={updateAspectRatio}
              onPlaying={updateAspectRatio}
              onTimeUpdate={updateAspectRatio}
              onResize={updateAspectRatio}
              className="w-full h-full object-fill rounded-xl pointer-events-none"
            />

            {/* Interactive drawing overlay layered directly on top of video */}
            <DrawCanvas
              strokes={strokes}
              myColor={myColor}
              onSendStroke={onSendStroke}
            />
          </div>
        </>
      ) : (
        <div className="relative z-10 flex flex-col items-center justify-center p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-5 text-zinc-400">
            <Monitor className="w-8 h-8" />
          </div>

          <h3 className="text-xl font-medium text-zinc-200 mb-2">
            {isHost ? 'You are the presenter' : 'No screen is being shared'}
          </h3>

          <p className="text-sm text-zinc-400 mb-6">
            {isHost
              ? 'Start sharing your window or screen. All participants will see it and can draw annotations live.'
              : 'Waiting for the host to start sharing their screen. You will be able to view and draw once sharing begins.'}
          </p>

          {isHost && (
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center">
              {onStartShare && (
                <Button
                  onClick={onStartShare}
                  size="lg"
                  className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg w-full sm:w-auto"
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Screen in Browser
                </Button>
              )}

              {meetingId && (
                <a
                  href={`collabo://host/${meetingId}?code=${authCode || ''}`}
                  className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium text-zinc-200 transition-colors shadow-lg w-full sm:w-auto text-center"
                >
                  <Monitor className="w-4 h-4 mr-2 text-blue-400" />
                  Host with Desktop App (OS Overlay)
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
