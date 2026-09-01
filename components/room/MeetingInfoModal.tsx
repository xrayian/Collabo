'use client';

/**
 * components/room/MeetingInfoModal.tsx
 * Modal displaying shareable link, auth code, and quick copy actions.
 */
import React, { useState } from 'react';
import { Copy, Check, Link as LinkIcon, KeyRound } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

export interface MeetingInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingId: string;
  authCode: string;
}

export const MeetingInfoModal: React.FC<MeetingInfoModalProps> = ({
  isOpen,
  onClose,
  meetingId,
  authCode,
}) => {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const getJoinUrl = () => {
    if (typeof window === 'undefined') return `/join/${meetingId}`;
    return `${window.location.origin}/join/${meetingId}`;
  };

  const copyToClipboard = async (text: string, type: 'link' | 'code' | 'all') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else if (type === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    } catch {
      // Fallback
    }
  };

  const joinUrl = getJoinUrl();
  const fullInvite = `Join our Collabo meeting:\nLink: ${joinUrl}\nAuth Code: ${authCode}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Invite Participants"
      description="Anyone with the link and auth code can join and annotate your screen."
    >
      <div className="space-y-4 pt-2">
        {/* Meeting Link */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
            <LinkIcon className="w-3.5 h-3.5" /> Meeting Link
          </label>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={joinUrl}
              className="flex-1 bg-zinc-100 border border-zinc-300 rounded-lg px-3 py-2 text-xs text-zinc-800 font-mono select-all focus:outline-none"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(joinUrl, 'link')}
            >
              {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Auth Code */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5" /> Auth Code
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-zinc-900 text-white rounded-lg px-4 py-2 text-center font-mono font-bold tracking-widest text-lg select-all">
              {authCode}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyToClipboard(authCode, 'code')}
            >
              {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Copy All Button */}
        <div className="space-y-2 pt-2">
          <Button
            variant="primary"
            className="w-full"
            onClick={() => copyToClipboard(fullInvite, 'all')}
          >
            {copiedAll ? (
              <>
                <Check className="w-4 h-4 mr-2 text-emerald-400" />
                Copied Full Invite!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy Full Invitation
              </>
            )}
          </Button>

          {/* Open in Collabo Desktop Option */}
          <a
            href={`collabo://host/${meetingId}?code=${authCode}`}
            className="block w-full text-center py-2 px-3 rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-xs font-medium text-zinc-700 transition-colors"
          >
            🖥️ Open in Collabo Desktop (Live OS Overlay)
          </a>
        </div>
      </div>
    </Modal>
  );
};
