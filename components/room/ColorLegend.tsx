'use client';

/**
 * components/room/ColorLegend.tsx
 * Color legend displaying participant stroke colors for attribution.
 */
import React from 'react';
import { Peer } from '@/lib/types';

export interface ColorLegendProps {
  peers: Peer[];
  className?: string;
}

export const ColorLegend: React.FC<ColorLegendProps> = ({ peers, className }) => {
  return (
    <div className={`flex flex-wrap items-center gap-2 px-3 py-1.5 bg-zinc-900/80 backdrop-blur rounded-lg border border-zinc-800 text-xs text-zinc-300 ${className || ''}`}>
      <span className="text-zinc-500 font-medium">Draw Colors:</span>
      {peers.map((peer) => (
        <div key={peer.id} className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-2.5 rounded-full ring-1 ring-zinc-700 shrink-0"
            style={{ backgroundColor: peer.color }}
          />
          <span className="truncate max-w-[80px] text-zinc-300">{peer.name}</span>
        </div>
      ))}
    </div>
  );
};
