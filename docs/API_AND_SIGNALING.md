# Collabo API & WebSocket Signaling Specification

Collabo provides a lightweight REST API for session creation and a unified WebSocket protocol for signaling, WebRTC negotiation, drawing synchronization, and presence.

---

## 1. REST API Endpoints

### `POST /api/meetings`
Creates a new meeting room in memory and allocates a Mediasoup SFU Router.

#### Response
```json
{
  "success": true,
  "meetingId": "c5284ca8",
  "authCode": "LXA7FF",
  "createdAt": 1788303065559
}
```

---

### `GET /api/meetings?meetingId=[id]`
Validates whether a meeting ID exists and has active capacity.

#### Response
```json
{
  "exists": true,
  "meetingId": "c5284ca8",
  "peerCount": 3,
  "capacity": 10
}
```

---

## 2. WebSocket Signaling Protocol (`ws://host/ws`)

### 2.1 Client -> Server Messages

| Message Type | Parameters | Purpose |
| :--- | :--- | :--- |
| `join` | `{ meetingId, name, authCode }` | Authenticate and join room |
| `create-transport` | `{ direction: 'send' \| 'recv' }` | Request WebRTC transport from SFU |
| `connect-transport` | `{ transportId, dtlsParameters }` | Complete DTLS handshake |
| `produce` | `{ transportId, kind: 'audio' \| 'video', rtpParameters }` | Produce mic audio or screen video |
| `consume` | `{ producerId, rtpCapabilities }` | Consume remote peer audio or video |
| `resume-consumer` | `{ consumerId }` | Resume receiving RTP packets |
| `pause-producer` | `{ producerId }` | Mute audio without tearing down transport |
| `resume-producer` | `{ producerId }` | Unmute audio track |
| `close-producer` | `{ producerId }` | Stop screen share or audio producer |
| `draw-stroke` | `{ strokeId, points: [[x,y]...], isEnd?: boolean }` | Stream drawing stroke delta |
| `clear-strokes` | `{ scope: 'own' \| 'all' }` | Clear drawing strokes |
| `grant-host` | `{ targetPeerId }` | Hand off presenter role |
| `leave` | `{}` | Disconnect and free assigned color |

---

### 2.2 Server -> Client Messages

| Message Type | Parameters | Purpose |
| :--- | :--- | :--- |
| `join-ack` | `{ you: { id, name, color, isHost }, room, routerRtpCapabilities }` | Confirm join and return initial state |
| `peer-joined` | `{ peer: { id, name, color, isHost } }` | Notify room of new participant |
| `peer-left` | `{ peerId }` | Notify room of disconnected peer |
| `transport-created` | `{ direction, id, iceParameters, iceCandidates, dtlsParameters }` | WebRTC transport configuration |
| `produced` | `{ producerId, kind }` | Confirm producer ID |
| `new-producer` | `{ peerId, producerId, kind }` | Notify viewers of active audio/video |
| `consumed` | `{ consumerId, producerId, kind, rtpParameters, peerId }` | RTP parameters to consume remote track |
| `producer-closed` | `{ producerId, peerId, kind }` | Remote audio or screen stopped |
| `draw-stroke` | `{ peerId, color, strokeId, points, isEnd }` | Broadcast stroke coordinates |
| `clear-strokes` | `{ peerId, scope }` | Broadcast stroke clear request |
| `host-changed` | `{ hostId }` | Broadcast new presenter ID |
| `error` | `{ code, message }` | Emit operational error |

---

## 3. Error Codes

- `BAD_AUTH_CODE`: The 6-character auth code provided does not match the meeting.
- `ROOM_FULL`: The room has reached its maximum limit of 10 concurrent participants.
- `ROOM_NOT_FOUND`: The requested meeting ID does not exist in memory.
- `UNAUTHORIZED`: Attempted host-only action (e.g. `clear-strokes: 'all'`) by a regular participant.
- `SERVER_ERROR`: Internal SFU or transport allocation failure.
