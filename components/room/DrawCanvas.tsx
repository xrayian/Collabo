'use client';

/**
 * components/room/DrawCanvas.tsx
 * Transparent HTML5 Canvas overlay for real-time stroke capture and rendering.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Stroke, StrokePoint } from '@/lib/types';
import { getNormalizedPointerPos, renderAllStrokes } from '@/lib/draw-sync';

export interface DrawCanvasProps {
  strokes: Stroke[];
  myColor: string;
  isDrawingEnabled?: boolean;
  onSendStroke: (points: StrokePoint[], strokeId: string, isEnd?: boolean) => void;
  className?: string;
}

export const DrawCanvas: React.FC<DrawCanvasProps> = ({
  strokes,
  myColor,
  isDrawingEnabled = true,
  onSendStroke,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Active stroke being drawn by local user
  const isPointerDownRef = useRef(false);
  const currentStrokeIdRef = useRef<string | null>(null);
  const currentStrokePointsRef = useRef<StrokePoint[]>([]);

  // Remote active strokes in progress
  const [inProgressStrokes, setInProgressStrokes] = useState<Map<string, Stroke>>(new Map());

  // Canvas internal dimensions
  const [dimensions, setDimensions] = useState({ width: 1280, height: 720 });

  // Update canvas size to match container perfectly
  const updateSize = useCallback(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (width > 0 && height > 0) {
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      setDimensions({ width, height });
    }
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(() => {
      updateSize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [updateSize]);

  // Smooth 60fps animation frame loop for real-time 5s lifetime + 0.5s blur-fade
  useEffect(() => {
    let animFrameId: number;

    const renderLoop = () => {
      if (canvasRef.current) {
        const localStroke: Stroke | undefined =
          currentStrokeIdRef.current && currentStrokePointsRef.current.length > 0
            ? {
                id: currentStrokeIdRef.current,
                peerId: 'local',
                color: myColor,
                points: currentStrokePointsRef.current,
                timestamp: Date.now(),
              }
            : undefined;

        const allInProgress = new Map(inProgressStrokes);
        if (localStroke) {
          allInProgress.set(localStroke.id, localStroke);
        }

        renderAllStrokes(canvasRef.current, strokes, allInProgress, Date.now());
      }

      animFrameId = requestAnimationFrame(renderLoop);
    };

    animFrameId = requestAnimationFrame(renderLoop);
    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [strokes, inProgressStrokes, dimensions, myColor]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingEnabled || !canvasRef.current) return;

    // Capture pointer to track movements outside bounds
    e.currentTarget.setPointerCapture(e.pointerId);

    isPointerDownRef.current = true;
    const strokeId = 's_' + Math.random().toString(36).substring(2, 9);
    currentStrokeIdRef.current = strokeId;

    const pt = getNormalizedPointerPos(e, canvasRef.current);
    currentStrokePointsRef.current = [pt];

    onSendStroke([pt], strokeId, false);

    // Trigger local redraw
    if (canvasRef.current) {
      renderAllStrokes(canvasRef.current, strokes, [
        {
          id: strokeId,
          peerId: 'local',
          color: myColor,
          points: [pt],
          timestamp: Date.now(),
        },
      ]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current || !canvasRef.current || !currentStrokeIdRef.current) return;

    const pt = getNormalizedPointerPos(e, canvasRef.current);
    currentStrokePointsRef.current.push(pt);

    onSendStroke([pt], currentStrokeIdRef.current, false);

    // Render local progress
    renderAllStrokes(canvasRef.current, strokes, [
      {
        id: currentStrokeIdRef.current,
        peerId: 'local',
        color: myColor,
        points: currentStrokePointsRef.current,
        timestamp: Date.now(),
      },
    ]);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPointerDownRef.current || !currentStrokeIdRef.current) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    isPointerDownRef.current = false;
    const strokeId = currentStrokeIdRef.current;

    // Send finalization message with empty delta points so existing points are not duplicated
    onSendStroke([], strokeId, true);

    currentStrokeIdRef.current = null;
    currentStrokePointsRef.current = [];
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
  };

  return (
    <div ref={containerRef} className={`absolute inset-0 w-full h-full overflow-hidden ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      />
    </div>
  );
};
