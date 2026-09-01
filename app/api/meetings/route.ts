/**
 * app/api/meetings/route.ts
 * API route for creating new meetings and checking meeting status.
 */
import { NextResponse } from 'next/server';
import { roomManager } from '@/server/rooms';

export async function POST(request: Request) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is allowed
    }

    const { meetingId, authCode } = body;
    const room = roomManager.createRoom(meetingId, authCode);

    return NextResponse.json({
      success: true,
      meetingId: room.meetingId,
      authCode: room.authCode,
      createdAt: room.createdAt,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create meeting' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const meetingId = searchParams.get('meetingId');

  if (!meetingId) {
    return NextResponse.json(
      { success: false, error: 'Meeting ID is required' },
      { status: 400 }
    );
  }

  const room = roomManager.getRoom(meetingId);

  if (!room) {
    return NextResponse.json({
      exists: false,
    });
  }

  return NextResponse.json({
    exists: true,
    meetingId: room.meetingId,
    peerCount: room.peers.length,
    isFull: room.peers.length >= 10,
  });
}
