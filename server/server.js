import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";
import { Readable } from "stream";

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] }
});

const rooms = new Map();
const ROOM_IDLE_TTL_MS = Number(process.env.ROOM_IDLE_TTL_MS) || 30 * 60 * 1000;

const FILM_ACTION_TYPES = new Set(["play", "pause", "seek"]);

function cancelRoomCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room?.cleanupTimer) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function scheduleRoomCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.cleanupTimer) return;
  room.cleanupTimer = setTimeout(() => {
    rooms.delete(roomId);
    io.to(roomId).emit("room:expired", { roomId });
  }, ROOM_IDLE_TTL_MS);
  room.cleanupTimer.unref?.();
}

function createRoom() {
  let id;
  do {
    id = crypto.randomBytes(5).toString("base64url");
  } while (rooms.has(id));
  rooms.set(id, {
    host: null,
    guest: null,
    movieUrl: "",
    ready: {},
    movieStarted: false,
    playback: { playing: false, time: 0, updatedAt: Date.now() }
  });
  return id;
}

function sanitizeMovieUrl(value) {
  const url = String(value || "").trim().slice(0, 2000);
  if (!url) return "";
  if (url.startsWith("/")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return "";
}

function participantCount(room) {
  return Number(Boolean(room.host)) + Number(Boolean(room.guest));
}

function roleOf(room, socketId) {
  if (room.host?.socketId === socketId) return "host";
  if (room.guest?.socketId === socketId) return "guest";
  return null;
}

function readyFlags(room) {
  return {
    host: Boolean(room.host && room.ready[room.host.socketId]),
    guest: Boolean(room.guest && room.ready[room.guest.socketId])
  };
}

function publicState(room) {
  return {
    count: participantCount(room),
    host: room.host ? { name: room.host.name } : null,
    guest: room.guest ? { name: room.guest.name } : null,
    movieUrl: room.movieUrl,
    ready: readyFlags(room),
    movieStarted: room.movieStarted,
    playback: room.playback
  };
}

app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

function buildIceConfig() {
  const stuns = (process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const iceServers = [{ urls: stuns }];

  const turnUrls = (process.env.TURN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    if (!process.env.TURN_USERNAME || !process.env.TURN_CREDENTIAL) {
      for (const url of turnUrls) {
        const m = /^turns?:\/\/([^:@?]+):([^@?]+)@/.exec(url);
        if (m) {
          iceServers.push({ urls: url, username: decodeURIComponent(m[1]), credential: decodeURIComponent(m[2]) });
          continue;
        }
        iceServers.push({ urls: url, username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" });
      }
    } else {
      iceServers.push({
        urls: turnUrls,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }
  } else {
    // Public demo fallback (openrelayproject are shared demo creds, not secrets).
    iceServers.push(
      {
        urls: ["turn:openrelay.metered.ca:80?transport=udp", "turn:openrelay.metered.ca:80?transport=tcp", "turn:openrelay.metered.ca:443?transport=tcp"],
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
    );
  }
  return iceServers;
}

app.get("/api/ice-config", (_req, res) => {
  // Credentials are embedded in this payload — never cache it.
  res.set("Cache-Control", "no-store");
  res.json({ iceServers: buildIceConfig() });
});

if (process.env.TURN_URLS) {
  const count = process.env.TURN_URLS.split(",").filter((s) => s.trim()).length;
  console.log(`[ice] Using configured TURN servers (${count} URL(s)) from environment (credentials kept server-side).`);
} else {
  console.log("[ice] Using built-in demo TURN fallback (openrelay.metered.ca).");
}

// Video proxy: re-serves a remote mp4 (MOVIE_SOURCE_URL) with video/mp4 MIME
// and Range support so the browser <video> can play/seek it directly.
const MOVIE_SOURCE_URL =
  process.env.MOVIE_SOURCE_URL ||
  "https://github.com/m4tl943379-glitch/callflix-movie/releases/download/movie-1/movie.mp4";

async function proxyMovie(req, res) {
  try {
    const upstream = await fetch(MOVIE_SOURCE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (mini-callflix)",
        ...(req.headers.range ? { Range: req.headers.range } : {})
      },
      redirect: "follow"
    });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).end();
    }
    const h = upstream.headers;
    res.status(upstream.status === 206 ? 206 : 200);
    res.set("Content-Type", "video/mp4");
    res.set("Accept-Ranges", h.get("accept-ranges") || "bytes");
    res.set("Cache-Control", "public, max-age=3600");
    if (h.get("content-range")) res.set("Content-Range", h.get("content-range"));
    if (h.get("content-length")) res.set("Content-Length", h.get("content-length"));
    const stream = Readable.fromWeb(upstream.body);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(502).end();
    else res.destroy(err);
  }
}

app.get("/movie/movie.mp4", proxyMovie);

io.on("connection", (socket) => {
  socket.on("room:create", ({ name, movieUrl }, ack) => {
    const cleanName = String(name || "Host").trim().slice(0, 30) || "Host";
    const roomId = createRoom();
    const room = rooms.get(roomId);

    room.host = { socketId: socket.id, name: cleanName };
    room.movieUrl = sanitizeMovieUrl(movieUrl);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = "host";

    ack?.({ ok: true, roomId, role: "host", state: publicState(room) });
  });

  socket.on("room:join", ({ roomId, name }, ack) => {
    const id = String(roomId || "").trim();
    const room = rooms.get(id);

    if (!room) return ack?.({ ok: false, error: "ROOM_NOT_FOUND" });
    if (participantCount(room) >= 2) return ack?.({ ok: false, error: "ROOM_FULL" });

    const cleanName = String(name || "Guest").trim().slice(0, 30) || "Guest";
    room.guest = { socketId: socket.id, name: cleanName };
    socket.join(id);
    socket.data.roomId = id;
    socket.data.role = "guest";
    cancelRoomCleanup(id);

    ack?.({ ok: true, roomId: id, role: "guest", state: publicState(room) });
    socket.to(id).emit("room:participant-joined", {
      participant: { name: cleanName, role: "guest" },
      state: publicState(room)
    });
  });

  socket.on("webrtc:offer", ({ roomId, offer }) => {
    if (socket.data.roomId === roomId) socket.to(roomId).emit("webrtc:offer", { offer });
  });

  socket.on("webrtc:answer", ({ roomId, answer }) => {
    if (socket.data.roomId === roomId) socket.to(roomId).emit("webrtc:answer", { answer });
  });

  socket.on("webrtc:ice", ({ roomId, candidate }) => {
    if (socket.data.roomId === roomId) socket.to(roomId).emit("webrtc:ice", { candidate });
  });

  socket.on("media:state", ({ roomId, cameraEnabled, micEnabled }) => {
    if (socket.data.roomId !== roomId) return;
    socket.to(roomId).emit("media:state", {
      cameraEnabled: Boolean(cameraEnabled),
      micEnabled: Boolean(micEnabled),
      role: socket.data.role
    });
  });

  // Ready gate (squad-style): each member toggles readiness. The server is the
  // single authority: it keeps both flags, rebroadcasts {host, guest} so both
  // clients converge, and when BOTH are ready it broadcasts the synchronized
  // movie-start event exactly once (guarded by room.movieStarted).
  socket.on("ready:set", ({ roomId, ready }) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.roomId !== roomId) return;
    room.ready[socket.id] = Boolean(ready);
    io.to(roomId).emit("room:ready", { ready: readyFlags(room) });
    const r = readyFlags(room);
    if (r.host && r.guest && !room.movieStarted) {
      room.movieStarted = true;
      room.playback = { playing: true, time: 0, updatedAt: Date.now() };
      io.to(roomId).emit("movie:start");
    }
  });

  // Film sync: both participants are leaders. The server only relays the action
  // (stamped with the sender id for loop protection) and remembers the last state
  // so a late joiner can resume at the same time.
  socket.on("film:action", ({ roomId, type, currentTime }) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.roomId !== roomId) return;
    if (!FILM_ACTION_TYPES.has(type)) return;
    const time = Number(currentTime);
    if (!Number.isFinite(time) || time < 0) return;

    if (type === "seek") {
      room.playback = { ...room.playback, time, updatedAt: Date.now() };
    } else {
      room.playback = { playing: type === "play", time, updatedAt: Date.now() };
    }

    socket.to(roomId).emit("film:action", {
      type,
      currentTime: time,
      timestamp: Date.now(),
      from: socket.id
    });
  });

  // Lightweight periodic beat so both leaders re-converge on drift.
  socket.on("film:sync", ({ roomId, currentTime, playing }) => {
    if (socket.data.roomId !== roomId) return;
    const time = Number(currentTime);
    if (!Number.isFinite(time) || time < 0) return;
    socket.to(roomId).emit("film:sync", {
      currentTime: time,
      playing: Boolean(playing),
      from: socket.id
    });
  });

  socket.on("movie:set", ({ roomId, movieUrl }) => {
    const room = rooms.get(roomId);
    if (!room || socket.data.roomId !== roomId || socket.data.role !== "host") return;

    room.movieUrl = sanitizeMovieUrl(movieUrl);
    room.playback = { playing: false, time: 0, updatedAt: Date.now() };
    room.ready = {};
    room.movieStarted = false;
    io.to(roomId).emit("movie:url", { movieUrl: room.movieUrl });
    io.to(roomId).emit("room:ready", { ready: readyFlags(room) });
  });

  socket.on("chat:message", ({ roomId, message }) => {
    if (socket.data.roomId !== roomId) return;
    const text = String(message || "").trim().slice(0, 500);
    if (!text) return;
    const room = rooms.get(roomId);
    const sender = roleOf(room, socket.id);
    const user = sender === "host" ? room.host?.name : room.guest?.name;
    io.to(roomId).emit("chat:message", {
      id: crypto.randomUUID(),
      user: user || "Guest",
      role: sender,
      message: text,
      createdAt: Date.now()
    });
  });

  socket.on("reaction:send", ({ roomId, reaction }) => {
    if (socket.data.roomId !== roomId) return;
    const allowed = new Set(["❤️", "😂", "😱", "🔥"]);
    if (!allowed.has(reaction)) return;
    socket.to(roomId).emit("reaction:show", { reaction, id: crypto.randomUUID() });
  });

  // Private "feeling" signal between the two members (Salma experience).
  socket.on("feel:send", ({ roomId, value }) => {
    if (socket.data.roomId !== roomId) return;
    const text = String(value || "").trim().slice(0, 120);
    if (!text) return;
    const room = rooms.get(roomId);
    const sender = roleOf(room, socket.id);
    const user = sender === "host" ? room.host?.name : room.guest?.name;
    socket.to(roomId).emit("feel:show", {
      value: text,
      user: user || "Partner",
      from: socket.id,
      timestamp: Date.now()
    });
  });

  socket.on("room:leave", () => handleDisconnect(socket, true));
  socket.on("disconnect", () => handleDisconnect(socket, false));
});

function handleDisconnect(socket, explicitLeave) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  const role = roleOf(room, socket.id);
  const name = role === "host" ? room.host?.name : room.guest?.name;

  if (role === "host") room.host = null;
  if (role === "guest") room.guest = null;
  room.ready = {};

  socket.leave(roomId);
  socket.data.roomId = null;
  socket.data.role = null;

  socket.to(roomId).emit("room:participant-left", {
    name: name || "Participant",
    role,
    explicit: explicitLeave,
    state: publicState(room)
  });

  if (!room.host && !room.guest) {
    cancelRoomCleanup(roomId);
    rooms.delete(roomId);
    return;
  }

  scheduleRoomCleanup(roomId);
}

server.listen(PORT, () => {
  console.log(`MINI CALLFLIX signaling server running on http://localhost:${PORT}`);
});