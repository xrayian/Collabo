'use client';

/**
 * components/room/ControlBar.tsx
 * Meeting control bar for audio, screen share, stroke clearing, info, and exit.
 */
import React from 'react';
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  Eraser,
  Trash2,
  Share2,
  PhoneOff,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { IconButton } from '../ui/IconButton';

export interface ControlBarProps {
  isMuted: boolean;
  isHost: boolean;
  isSharing: boolean;
  onToggleAudio: () => void;
  onToggleShare?: () => void;
  onClearMyStrokes: () => void;
  onClearAllStrokes?: () => void;
  onOpenInvite: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  onLeave: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isMuted,
  isHost,
  isSharing,
  onToggleAudio,
  onToggleShare,
  onClearMyStrokes,
  onClearAllStrokes,
  onOpenInvite,
  onToggleFullscreen,
  isFullscreen,
  onLeave,
}) => {
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3 px-4 py-2.5 bg-zinc-900/90 backdrop-blur-md rounded-2xl border border-zinc-800 shadow-2xl">
      {/* Microphone Toggle */}
      <IconButton
        label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        variant={isMuted ? 'danger' : 'default'}
        onClick={onToggleAudio}
      >
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </IconButton>

      {/* Screen Share Toggle (Host only) */}
      {isHost && onToggleShare && (
        <IconButton
          label={isSharing ? 'Stop screen share' : 'Share screen'}
          variant={isSharing ? 'active' : 'default'}
          onClick={onToggleShare}
        >
          {isSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
        </IconButton>
      )}

      <div className="h-6 w-px bg-zinc-700/60 mx-1" />

      {/* Clear My Strokes */}
      <IconButton
        label="Clear my strokes"
        variant="default"
        onClick={onClearMyStrokes}
      >
        <Eraser className="w-5 h-5" />
      </IconButton>

      {/* Clear All Strokes (Host only) */}
      {isHost && onClearAllStrokes && (
        <IconButton
          label="Clear all annotations"
          variant="default"
          onClick={onClearAllStrokes}
        >
          <Trash2 className="w-5 h-5 text-red-400" />
        </IconButton>
      )}

      {/* Meeting Invite / Info */}
      <IconButton
        label="Share invite info"
        variant="default"
        onClick={onOpenInvite}
      >
        <Share2 className="w-5 h-5 text-blue-400" />
      </IconButton>

      {/* Fullscreen Toggle */}
      {onToggleFullscreen && (
        <IconButton
          label={isFullscreen ? 'Exit Fullscreen' : 'Zoom to Fullscreen'}
          variant="default"
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 className="w-5 h-5 text-blue-400" />
          ) : (
            <Maximize2 className="w-5 h-5" />
          )}
        </IconButton>
      )}

      <div className="h-6 w-px bg-zinc-700/60 mx-1" />

      {/* Leave Call */}
      <IconButton
        label="Leave meeting"
        variant="danger"
        onClick={onLeave}
      >
        <PhoneOff className="w-5 h-5" />
      </IconButton>
    </div>
  );
};
