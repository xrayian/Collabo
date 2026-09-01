'use client';

/**
 * components/room/ParticipantStrip.tsx
 * Horizontal/vertical participant list with presence, colors, and presenter handoff actions.
 */
import React from 'react';
import { Peer } from '@/lib/types';
import { Avatar } from '../ui/Avatar';
import { ArrowRightLeft } from 'lucide-react';

export interface ParticipantStripProps {
  peers: Peer[];
  myPeerId: string;
  isHost: boolean;
  onGrantHost: (peerId: string) => void;
  className?: string;
}

export const ParticipantStrip: React.FC<ParticipantStripProps> = ({
  peers,
  myPeerId,
  isHost,
  onGrantHost,
  className,
}) => {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto py-2 px-3 bg-zinc-900/90 backdrop-blur-md rounded-xl border border-zinc-800 shadow-lg ${className || ''}`}>
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 shrink-0 mr-1">
        In Call ({peers.length}/10)
      </span>

      <div className="flex items-center gap-3 overflow-x-auto">
        {peers.map((peer) => {
          const isMe = peer.id === myPeerId;

          return (
            <div
              key={peer.id}
              className="flex items-center gap-2 bg-zinc-800/80 px-2.5 py-1.5 rounded-lg border border-zinc-700/50 shrink-0"
            >
              <Avatar
                name={peer.name}
                color={peer.color}
                isHost={peer.isHost}
                isMuted={peer.audioMuted}
                size="sm"
              />

              <div className="flex flex-col">
                <span className="text-xs font-medium text-zinc-200 truncate max-w-[100px]">
                  {peer.name} {isMe && <span className="text-zinc-400 font-normal">(You)</span>}
                </span>
                {peer.isHost && (
                  <span className="text-[10px] text-amber-400 font-medium leading-none">Presenter</span>
                )}
              </div>

              {/* Presenter handoff trigger (host only, for other peers) */}
              {isHost && !isMe && (
                <button
                  onClick={() => onGrantHost(peer.id)}
                  title={`Make ${peer.name} the presenter`}
                  className="ml-1 p-1 text-zinc-400 hover:text-amber-300 hover:bg-zinc-700 rounded transition-colors"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
