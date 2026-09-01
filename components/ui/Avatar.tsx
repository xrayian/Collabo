'use client';

/**
 * components/ui/Avatar.tsx
 * Peer avatar with assigned stroke color, initial, and status badges.
 */
import React from 'react';
import { MicOff, Crown } from 'lucide-react';
import { clsx } from 'clsx';

export interface AvatarProps {
  name: string;
  color: string;
  isHost?: boolean;
  isMuted?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  color,
  isHost,
  isMuted,
  size = 'md',
  className,
}) => {
  const initial = (name || '?').trim().charAt(0).toUpperCase();

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base font-semibold',
  };

  return (
    <div className="relative inline-flex items-center justify-center select-none">
      <div
        className={clsx(
          'flex items-center justify-center rounded-full text-white font-medium shadow-sm transition-transform',
          sizeClasses[size],
          className
        )}
        style={{ backgroundColor: color }}
        title={name}
      >
        {initial}
      </div>

      {isHost && (
        <span
          title="Presenter (Host)"
          className="absolute -top-1 -right-1 bg-amber-500 text-zinc-950 p-0.5 rounded-full ring-2 ring-zinc-900 shadow"
        >
          <Crown className="w-2.5 h-2.5" />
        </span>
      )}

      {isMuted && (
        <span
          title="Microphone muted"
          className="absolute -bottom-1 -right-1 bg-red-600 text-white p-0.5 rounded-full ring-2 ring-zinc-900 shadow"
        >
          <MicOff className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
};
