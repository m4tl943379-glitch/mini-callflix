# MINI CALLFLIX

A small private two-person watch-party MVP.

## Features

- Create a private room with a random ID
- Join by room ID/link
- Maximum 2 participants enforced by the realtime server
- Real WebRTC video/audio
- Camera and microphone controls
- Host-controlled movie playback
- Play / pause / seek synchronization
- Late-joining guest playback synchronization
- Realtime chat
- ❤️ 😂 😱 🔥 reactions
- Leave/reconnect handling
- Responsive cinematic UI
- No database
- No authentication
- One local movie file

## Requirements

Node.js 18+ recommended.

## Install

From the project root:

```bash
npm install
```

## Add your movie

Put your movie at:

```text
public/movie/movie.mp4
```

The filename is intentionally fixed so you do not need to change application logic.

The browser should be able to play the format you provide. H.264/AAC MP4 is a practical choice for broad browser compatibility.

## Run locally

```bash
npm run dev:all
```

Frontend:

```text
http://localhost:5173
```

Signaling server:

```text
http://localhost:3001
```

Open the frontend in two separate browser windows/contexts. Create a room in one, copy the invite URL, and join it in the other.

## Architecture

```text
Browser A ── WebRTC media ── Browser B
     │                           │
     └──── Socket.IO signaling ──┘
                 │
          Node + Express
          in-memory rooms
```

Socket.IO only exchanges signaling/control events. Camera and microphone media are carried by WebRTC.

The server keeps:

```text
rooms
  roomId
    host
    guest
    playback
```

Restarting the server clears active rooms.

## Playback synchronization

The host is authoritative.

When the host plays, pauses, or seeks, the host sends:

- playing state
- current time

The guest applies those updates to its local `<video>` element.

When a guest joins after the movie has started, the current playback state stored in the room is returned by the server. For a more exact production implementation, a server timestamp / periodic drift correction can be added; this MVP already sends the authoritative position and state.

## WebRTC flow

1. Both users enter the same room.
2. Host creates the RTCPeerConnection when the guest joins.
3. Host creates an offer.
4. Offer is sent through Socket.IO.
5. Guest creates an answer.
6. Answer is sent through Socket.IO.
7. ICE candidates are exchanged through Socket.IO.
8. Audio/video travels directly between browsers through WebRTC.

For production deployments, configure a TURN server as well as STUN because some networks cannot establish a direct peer-to-peer route.

## Testing checklist

Test with two separate browser contexts:

- Create room
- Copy invite link
- Join from second browser
- Room reaches 2/2
- Third participant is rejected
- Local camera appears
- Remote camera appears
- Host can hear guest
- Guest can hear host
- Camera off/on
- Mic mute/unmute
- Host starts movie
- Host play/pause
- Host seek
- Guest follows playback
- Guest joins after playback started
- Chat sends in both directions
- Reactions appear
- Fullscreen browser video controls work
- Guest leaves and host gets a leave state
- Refresh/reconnect behavior

## Known MVP limitations

- Rooms are in memory only.
- No authentication.
- No persistent chat history.
- One movie only.
- The browser's native fullscreen/video controls are used.
- WebRTC uses a public STUN server; a TURN service is recommended for production.
- Exact playback drift correction is intentionally kept simple for this first version.
