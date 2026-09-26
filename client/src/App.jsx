import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import MoviePlayer from "./MoviePlayer";

/* ── cinematic SVG control icons ── */
const icCommon = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
function IconCam({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} aria-hidden="true">
      <path d="M3 7h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="m16 10 4.2-2.6a1 1 0 0 1 1.55.83V15.8a1 1 0 0 1-1.55.83L16 14" />
    </svg>
  );
}
function IconCamOff({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} aria-hidden="true">
      <path d="M3 7h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="m16 10 4.2-2.6a1 1 0 0 1 1.55.83V15.8a1 1 0 0 1-1.55.83L16 14" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
function IconMic({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
function IconMicOff({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 10.9 5.9" />
      <path d="M12 18v3" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
function IconChat({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function IconFullscreen({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} strokeWidth="2" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
function IconShrink({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" {...icCommon} strokeWidth="2" aria-hidden="true">
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const isMobileViewport = () => window.matchMedia("(max-width: 600px)").matches || (window.matchMedia("(pointer: coarse)").matches && window.innerHeight < 500);
const MOVIE_SRC = `${SERVER_URL}/movie/movie.mp4`;
const socket = io(SERVER_URL, { autoConnect: true });

/* Refresh recovery: the room identity survives a page reload in sessionStorage
   (tab-scoped, so it never bleeds into other tabs / browser instances). */
const SESSION_KEY = "cf:room";
function readStoredSession() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.roomId !== "string" || !s.roomId) return null;
    return s;
  } catch { return null; }
}
function writeStoredSession(s) {
  try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}
function clearStoredSession() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch {}
}
const REJOIN_MAX_ATTEMPTS = 5; // recovery retries for ROOM_FULL (old socket slot must free)
const REJOIN_BACKOFF_MS = 700;

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
  { urls: ["turn:openrelay.metered.ca:80?transport=udp", "turn:openrelay.metered.ca:80?transport=tcp", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
];
// openrelayproject / openrelayproject above are PUBLIC DEMO credentials
// belonging to OpenRelay (metered.ca). The real, reliable TURN config is
// always loaded server-side via GET /api/ice-config (never from source).
const MAX_ICE_RESTARTS = 6;
const CUSTOM_TURN_URLS = (import.meta.env.VITE_TURN_URLS || "").split(",").filter(Boolean);
if (CUSTOM_TURN_URLS.length) {
  ICE_SERVERS.push({
    urls: CUSTOM_TURN_URLS,
    username: import.meta.env.VITE_TURN_USERNAME || "",
    credential: import.meta.env.VITE_TURN_CREDENTIAL || ""
  });
}

let fetchedIceServers = null;
async function getIceServers() {
  if (fetchedIceServers) return fetchedIceServers;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${SERVER_URL}/api/ice-config`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.iceServers) && data.iceServers.length) {
        fetchedIceServers = data.iceServers;
        return fetchedIceServers;
      }
    }
  } catch {}
  fetchedIceServers = ICE_SERVERS;
  return fetchedIceServers;
}

const reactions = ["❤️", "😂", "😱", "🔥"];

const FEELING_OPTIONS = [
  { key: "i_love_you", emoji: "❤️", label: "I love you" },
  { key: "im_still_here", emoji: "🫶", label: "I'm still here" },
  { key: "could_be_us", emoji: "💭", label: "Could be us" },
  { key: "i_wanna_do_this_with_you", emoji: "🥹", label: "I wanna do this with you" },
  { key: "i_miss_you", emoji: "💌", label: "I miss you" },
  { key: "this_is_us", emoji: "❤️", label: "This is us" }
];

function feelingDisplay(value) {
  switch (value) {
    case "could_be_us": return "Could be us. ❤️";
    case "i_wanna_do_this_with_you": return "I wanna do this with you. 🫶";
    case "this_is_us": return "This is us. ❤️";
    case "i_love_you": return "❤️ I love you";
    case "im_still_here": return "🫶 I'm still here";
    case "i_miss_you": return "💌 I miss you";
    default: return value;
  }
}

/* ── private-theater first batch helpers ── */
const CINE_INTRO_MS = 2600;
const CINE_INTRO_MS_REDUCED = 350;
const SHOWER_MS = 1400;
const MAX_SHOWERS = 3;

function movieDisplayName(url) {
  const u = String(url || "");
  if (!u) return "Tonight's Feature";
  if (/youtube\.|youtu\.be/i.test(u)) return "Tonight's Feature";
  if (u === MOVIE_SRC || u.includes("/movie/movie.mp4")) return "My Movie";
  return "Tonight's Feature";
}

function fmtDur(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m} min`;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* Client-side cinema closing card. Only real session facts are drawn. */
function buildShareCard({ title, names, durationText, feelings, reactions, chats, roomId }) {
  try {
    const W = 1080, H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#12101a");
    bg.addColorStop(0.55, "#0a090d");
    bg.addColorStop(1, "#070608");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, 700);
    glow.addColorStop(0, "rgba(140, 14, 24, .28)");
    glow.addColorStop(1, "rgba(140, 14, 24, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const RED = "#e50914", TEXT = "#f5f1ee", MUTED = "#8f858c", DIM = "rgba(245, 241, 238, .6)";
    ctx.textAlign = "center";

    // brand
    ctx.fillStyle = RED;
    ctx.font = "700 34px Arial, sans-serif";
    ctx.fillText("CALLFLIX", W / 2, 120);
    ctx.fillStyle = MUTED;
    ctx.font = "500 22px Georgia, serif";
    ctx.fillText("the tiny private cinema for two", W / 2, 158);

    // eyebrow + feature
    ctx.fillStyle = DIM;
    ctx.font = "500 26px Arial, sans-serif";
    ctx.fillText("TONIGHT'S FEATURE", W / 2, 300);
    const titleText = String(title || "Tonight's Feature").slice(0, 46);
    ctx.fillStyle = TEXT;
    ctx.font = "400 76px Georgia, 'Times New Roman', serif";
    const titleLines = wrapCanvasText(ctx, titleText, W - 140);
    titleLines.forEach((ln, i) => ctx.fillText(ln, W / 2, 392 + i * 88));

    ctx.strokeStyle = "rgba(229, 9, 20, .55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W * 0.34, 618);
    ctx.lineTo(W * 0.66, 618);
    ctx.stroke();

    let y = 690;
    ctx.fillStyle = DIM;
    ctx.font = "500 24px Arial, sans-serif";
    ctx.fillText("WATCHED TOGETHER", W / 2, y); y += 46;
    if (durationText) {
      ctx.fillStyle = TEXT;
      ctx.font = "600 40px Arial, sans-serif";
      ctx.fillText(durationText, W / 2, y); y += 42;
    }
    if (names) {
      ctx.fillStyle = "rgba(245, 241, 238, .85)";
      ctx.font = "400 30px Georgia, serif";
      const nl = wrapCanvasText(ctx, String(names).slice(0, 60), W - 160);
      nl.forEach((ln) => { ctx.fillText(ln, W / 2, y); y += 44; });
    }

    const facts = [];
    const feelKeys = feelings ? Object.keys(feelings) : [];
    const feelCount = feelKeys.reduce((n, k) => n + feelings[k], 0);
    if (feelCount > 0) facts.push(`${feelCount} feeling${feelCount > 1 ? "s" : ""} shared`);
    if (reactions > 0) facts.push(`${reactions} reaction${reactions > 1 ? "s" : ""}`);
    if (chats > 0) facts.push(`${chats} message${chats > 1 ? "s" : ""}`);
    if (!facts.length) facts.push("a quiet night spent together");

    ctx.fillStyle = DIM;
    ctx.font = "500 26px Arial, sans-serif";
    facts.slice(0, 3).forEach((f) => { ctx.fillText(f, W / 2, y); y += 42; });

    ctx.fillStyle = "rgba(245, 241, 238, .55)";
    ctx.font = "italic 400 30px Georgia, serif";
    ctx.fillText("One more movie night together.", W / 2, 1010);

    // ticket-style footer
    ctx.strokeStyle = "rgba(255, 255, 255, .12)";
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 16]);
    ctx.beginPath();
    ctx.moveTo(90, 1100);
    ctx.lineTo(W - 90, 1100);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = MUTED;
    ctx.font = "500 24px Arial, sans-serif";
    if (roomId) ctx.fillText(`ROOM ${roomId}`, W / 2, 1160);
    ctx.fillStyle = "rgba(229, 9, 20, .85)";
    ctx.font = "700 40px Arial, sans-serif";
    ctx.fillText("CALLFLIX", W / 2, 1246);
    ctx.fillStyle = "rgba(245,241,238,.4)";
    ctx.font = "500 22px Arial, sans-serif";
    ctx.fillText("two people · one screen", W / 2, 1292);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function App() {
  const [view, setView] = useState("home");
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState("");
  const [socketId, setSocketId] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [media, setMedia] = useState({ cameraEnabled: true, micEnabled: true });
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [movieUrl, setMovieUrl] = useState(MOVIE_SRC);
  const [linkInput, setLinkInput] = useState("");
  const [playback, setPlayback] = useState(null);
  const [movieStarted, setMovieStarted] = useState(false); // hides pre-start scene topbar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [camSide, setCamSide] = useState("right"); // fullscreen 80/20: "right" | "left"
  const [sideSwitching, setSideSwitching] = useState(false); // chat icon fades during side transition
  const [chromeVisible, setChromeVisible] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [iceInfo, setIceInfo] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [partnerLeftAlert, setPartnerLeftAlert] = useState(false);
  const [soloMode, setSoloMode] = useState(false);
  const [feelingOpen, setFeelingOpen] = useState(false);
  const [feelText, setFeelText] = useState("");
  const [feelToast, setFeelToast] = useState(null);
  const [feelSent, setFeelSent] = useState(false);
  const [feelClosing, setFeelClosing] = useState(false);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [readyMe, setReadyMe] = useState(false);
  const [readyPartner, setReadyPartner] = useState(false);
  const feelToastTimer = useRef(null);
  const feelCloseTimer = useRef(null);
  const cineTimer = useRef(null);
  const shareTimer = useRef(null);
  const movieStartAtRef = useRef(0);
  const wrapShownRef = useRef(false);
  const sessionFactsRef = useRef({ feelings: {}, reactions: 0, chats: 0 });
  const [movieTitle, setMovieTitle] = useState("");
  const [cinemaIntro, setCinemaIntro] = useState(false);
  const [reactionShowers, setReactionShowers] = useState([]);
  const [wrapInfo, setWrapInfo] = useState(null);
  const [hangoutMode, setHangoutMode] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [shareStatus, setShareStatus] = useState("");
  const feelSentTimer = useRef(null);
  const iceWatchdogRef = useRef(null);
  const earlyCheckRef = useRef(null);
  const restartAttempts = useRef(0);
  const chatOpenRef = useRef(true);
  const sidebarOpenRef = useRef(true);
  const roleRef = useRef("");
  const hasLeftRef = useRef(false);
  const partnerLeftHandledRef = useRef(false);
  const isCleaningUpRef = useRef(false);
  const roomIdRef = useRef(""); // current room id (socket-level), for auto-rejoin after a socket drop
  const nameRef = useRef(""); // latest display name, reused for the rejoin payload
  const prevRoleRef = useRef(""); // role at the moment the socket dropped (host stays host)
  const rejoinScheduledRef = useRef(false); // true between socket "disconnect" and successful rejoin
  const rejoinInFlightRef = useRef(false); // guards against duplicate room:join emissions
  const onReconnectRef = useRef(null); // latest reconnect handler (avoids stale closures in the [] effect)
  const rejoinRoomRef = useRef(null); // latest rejoinRoom (used by the refresh-recovery path)
  const startPeerRef = useRef(null); // latest startPeer (fresh closures after a refresh rejoin)
  const recoveryAttemptedRef = useRef(false); // run the refresh-recovery flow at most once per page load

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const localVideoOverlay = useRef(null);
  const remoteVideoOverlay = useRef(null);
  const localStream = useRef(null);
  const peer = useRef(null);
  const pendingCandidates = useRef([]);
  const playerRef = useRef(null);
  const pageRef = useRef(null);
  const stageRef = useRef(null);
  const workspaceRef = useRef(null);
  const camSideRef = useRef("right");
  const camDragRef = useRef(null); // { pointerId, startX, startY, fromLeft, moved, camY0, zoneTop/Bottom, camTop/H, chatTop/H, chatUp0 }
  const camYRef = useRef(0); // fullscreen 80/20: vertical offset of the camera pair (px); chat is INDEPENDENT (bottom rail, lifts only as a collision cushion)
  const sideSwitchTimer = useRef(null); // chat-icon fade during side transitions
  const camTapRef = useRef(null); // { t, x, y } last quick tap on the pair for double-tap side switch
  const chromeTimer = useRef(null);
  const remoteStreamRef = useRef(null);
  const reconnectTimer = useRef(null);
  const copyTimer = useRef(null);
  const lastRestart = useRef(0);
  const connectionLost = useRef(false);

  const inviteLink = useMemo(
    () => roomId ? `${window.location.origin}/room/${roomId}` : "",
    [roomId]
  );

  const pathRoomId = window.location.pathname.startsWith("/room/")
    ? window.location.pathname.split("/room/")[1]
    : "";

  useEffect(() => {
    if (pathRoomId) {
      setRoomIdInput(pathRoomId);
      setView("join");
    }
  }, [pathRoomId]);

  useEffect(() => {
    const onConnect = () => {
      setSocketId(socket.id);
      const act = onReconnectRef.current;
      if (act) act();
    };
    const onDisconnect = (reason) => {
      // Only arm the auto-rejoin if we're inside a room and did NOT leave on purpose.
      if (roomIdRef.current && !hasLeftRef.current && !isCleaningUpRef.current) {
        prevRoleRef.current = roleRef.current;
        rejoinScheduledRef.current = true;
        console.log(`[socket] disconnected (${reason || "unknown"}) — auto-rejoin armed for room ${roomIdRef.current}`);
      } else {
        console.log("[socket] disconnected");
      }
      setSocketId(null);
    };
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (socket.connected) setSocketId(socket.id);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  // Keep the reconnect action pointing at the freshest closure (refs stay valid,
  // but rejoinRoom/startPeer read roomId from state — so the latest render wins).
  useEffect(() => {
    onReconnectRef.current = () => {
      if (!rejoinScheduledRef.current || !roomIdRef.current) return;
      console.log("[socket] reconnected — rejoining room", roomIdRef.current);
      rejoinRoom(roomIdRef.current);
    };
  });

  // Autoplay policies block remote video with sound until a user gesture.
  // If the muted fallback kicked in, restore the call audio on first interaction.
  useEffect(() => {
    const restoreRemoteAudio = () => {
      const el = remoteVideo.current;
      if (el && el.muted && remoteStreamRef.current) {
        el.muted = false;
        el.play().catch(() => {});
      }
    };
    document.addEventListener("pointerdown", restoreRemoteAudio);
    document.addEventListener("keydown", restoreRemoteAudio);
    return () => {
      document.removeEventListener("pointerdown", restoreRemoteAudio);
      document.removeEventListener("keydown", restoreRemoteAudio);
    };
  }, []);

  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => { sidebarOpenRef.current = sidebarOpen; }, [sidebarOpen]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { nameRef.current = name; }, [name]);
  useEffect(() => { rejoinRoomRef.current = rejoinRoom; });
  useEffect(() => { startPeerRef.current = startPeer; });

  // Refresh recovery: a page reload loses all React state but the server keeps
  // the room. If a previous session is stored AND the URL isn't pointing at a
  // different room, rejoin with the saved role once the socket is connected.
  // Runs after the rejoinRoomRef/startPeerRef assignments above so the latest
  // closures are guaranteed to be in place even for the synchronous path.
  useEffect(() => {
    if (recoveryAttemptedRef.current) return;
    const session = readStoredSession();
    if (!session) return;
    if (pathRoomId && pathRoomId !== session.roomId) return;
    recoveryAttemptedRef.current = true;
    prevRoleRef.current = session.role || "guest";
    if (session.name) nameRef.current = session.name;
    const attempt = () => {
      console.log(`[recover] restoring room ${session.roomId} as ${prevRoleRef.current}`);
      rejoinRoomRef.current?.(session.roomId, { recover: true });
    };
    if (socket.connected) attempt();
    else socket.once("connect", attempt);
  }, [pathRoomId]);
  const roomStateRef = useRef(null);
  const soloModeRef = useRef(false);
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);
  useEffect(() => { soloModeRef.current = soloMode; }, [soloMode]);

  useEffect(() => {
    setMovieTitle(movieDisplayName(movieUrl));
    setShareUrl(null);
    setShareStatus("");
    wrapShownRef.current = false;
  }, [movieUrl]);

  useEffect(() => () => { clearTimeout(cineTimer.current); clearTimeout(shareTimer.current); }, []);

  // Reading the chat clears the unread badge.
  useEffect(() => {
    if (sidebarOpen && chatOpen) setUnreadMsgs(0);
  }, [sidebarOpen, chatOpen]);

  useEffect(() => {
    const onJoined = ({ participant, state }) => {
      setRoomState(state);
      setNotice(`${participant.name} joined the room.`);
      if (role === "host") startPeer(true);
      applyReady(state?.ready, role);
    };

    const onReady = ({ ready }) => {
      if (!ready) return;
      applyReady(ready, role);
    };

    const onMovieStart = () => {
      startMovie();
    };

    const onOffer = async ({ offer }) => {
      if (!peer.current) {
        await startPeer(false);
      }
      await peer.current.setRemoteDescription(offer);
      await flushCandidates();
      const answer = await peer.current.createAnswer();
      await peer.current.setLocalDescription(answer);
      socket.emit("webrtc:answer", { roomId: roomIdRef.current, answer });
    };

    const onAnswer = async ({ answer }) => {
      if (!peer.current) return;
      await peer.current.setRemoteDescription(answer);
      await flushCandidates();
    };

    const onIce = async ({ candidate }) => {
      if (!candidate) return;
      if (peer.current?.remoteDescription) {
        try { await peer.current.addIceCandidate(candidate); } catch {}
      } else {
        pendingCandidates.current.push(candidate);
      }
    };

    const onMedia = ({ cameraEnabled, micEnabled, role: remoteRole }) => {
      setNotice(`${remoteRole === "host" ? "Host" : "Guest"} media updated.`);
    };

    const onChat = (item) => {
      setMessages((prev) => [...prev, item]);
      sessionFactsRef.current.chats += 1;
      const fromOther = item.role && roleRef.current && item.role !== roleRef.current;
      if (!fromOther) return;
      if (!(sidebarOpenRef.current && chatOpenRef.current)) setUnreadMsgs((n) => n + 1);
    };

    const onReaction = ({ reaction, id }) => {
      sessionFactsRef.current.reactions += 1;
      spawnReactionShower(reaction, "remote");
    };

    const onFeeling = ({ value, user }) => {
      const k = String(value || "").trim();
      if (k) sessionFactsRef.current.feelings[k] = (sessionFactsRef.current.feelings[k] || 0) + 1;
      clearTimeout(feelToastTimer.current);
      setFeelToast({
        id: Date.now(),
        text: feelingDisplay(value),
        user,
        special: ["could_be_us", "i_wanna_do_this_with_you", "this_is_us"].includes(value)
      });
      feelToastTimer.current = setTimeout(() => setFeelToast(null), 3200);
    };

    const onLeft = ({ state }) => {
      if (hasLeftRef.current || isCleaningUpRef.current) return;
      if (partnerLeftHandledRef.current) return;
      partnerLeftHandledRef.current = true;
      setRoomState(state || null);
      setNotice("");
      if (peer.current) {
        peer.current.close();
        peer.current = null;
      }
      remoteStreamRef.current = null;
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      if (remoteVideoOverlay.current) remoteVideoOverlay.current.srcObject = null;
      clearTimeout(reconnectTimer.current);
      connectionLost.current = false;
      setIceInfo("");
      setPartnerLeftAlert(true);
      setReadyMe(false);
      setReadyPartner(false);
    };

    const onMovieUrl = ({ movieUrl }) => {
      setMovieUrl(movieUrl || MOVIE_SRC);
    };

    const onExpired = () => {
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      remoteStreamRef.current = null;
      setIceInfo("");
      peer.current?.close();
      peer.current = null;
      clearTimeout(reconnectTimer.current);
      connectionLost.current = false;
      setRoomId("");
      roomIdRef.current = "";
      rejoinScheduledRef.current = false;
      rejoinInFlightRef.current = false;
      setRoomState(null);
      setPlayback(null);
      setMovieStarted(false);
      setMessages([]);
      setUnreadMsgs(0);
      setLinkInput("");
      setMovieUrl(MOVIE_SRC);
      setFeelingOpen(false);
      setFeelClosing(false);
      setFeelText("");
      setFeelToast(null);
      setFeelSent(false);
      setCinemaIntro(false);
      setWrapInfo(null);
      setHangoutMode(false);
      setShareUrl(null);
      setShareStatus("");
      wrapShownRef.current = false;
      sessionFactsRef.current = { feelings: {}, reactions: 0, chats: 0 };
      movieStartAtRef.current = 0;
      clearTimeout(cineTimer.current);
      clearTimeout(shareTimer.current);
      setView("home");
      window.history.replaceState({}, "", "/");
      hasLeftRef.current = false;
      partnerLeftHandledRef.current = false;
      setReadyMe(false);
      setReadyPartner(false);
      clearStoredSession();
    };

    socket.on("room:participant-joined", onJoined);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    socket.on("media:state", onMedia);
    socket.on("movie:url", onMovieUrl);
    socket.on("room:expired", onExpired);
    socket.on("chat:message", onChat);
    socket.on("reaction:show", onReaction);
    socket.on("feel:show", onFeeling);
    socket.on("room:participant-left", onLeft);
    socket.on("room:ready", onReady);
    socket.on("movie:start", onMovieStart);

    return () => {
      socket.off("room:participant-joined", onJoined);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
      socket.off("media:state", onMedia);
      socket.off("movie:url", onMovieUrl);
      socket.off("room:expired", onExpired);
      socket.off("chat:message", onChat);
      socket.off("reaction:show", onReaction);
      socket.off("feel:show", onFeeling);
      socket.off("room:participant-left", onLeft);
      socket.off("room:ready", onReady);
      socket.off("movie:start", onMovieStart);
    };
  }, [role, roomId]);

  async function flushCandidates() {
    for (const candidate of pendingCandidates.current) {
      try { await peer.current.addIceCandidate(candidate); } catch {}
    }
    pendingCandidates.current = [];
  }

  async function getLocalMedia() {
    if (localStream.current) return localStream.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      if (localVideoOverlay.current) localVideoOverlay.current.srcObject = stream;
      return stream;
    } catch {
      setNotice("Camera/microphone permission was denied. You can continue with media disabled.");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: false });
        localStream.current = stream;
        return stream;
      } catch {
        return null;
      }
    }
  }

  async function startPeer(isOfferer) {
    if (peer.current) return;
    const stream = await getLocalMedia();
    const iceServers = await getIceServers();
    setIceInfo(isOfferer ? "Waiting for your friend..." : "Connecting...");
    const pc = new RTCPeerConnection({
      iceServers,
      iceCandidatePoolSize: 4
    });
    peer.current = pc;

    stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      const el = remoteVideo.current;
      if (el) {
        el.srcObject = event.streams[0];
        const tryPlay = (mute) => {
          el.muted = mute;
          el.play().catch(() => { if (!mute) tryPlay(true); });
        };
        tryPlay(false);
      }
      if (remoteVideoOverlay.current) remoteVideoOverlay.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("webrtc:ice", { roomId: roomIdRef.current, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        console.log("[webrtc] connection restored");
        restartAttempts.current = 0;
        setIceInfo("Connected");
        setTimeout(() => refreshIceInfo(pc), 500);
        if (connectionLost.current) {
          connectionLost.current = false;
          setNotice("Video reconnected.");
        }
        return;
      }
      if (s === "connecting") setIceInfo("Connecting...");

      if (s === "failed") {
        setIceInfo("Retrying...");
        connectionLost.current = true;
        if (role !== "host") return;
        if (restartAttempts.current >= MAX_ICE_RESTARTS) {
          setIceInfo("Connection failed");
          setNotice("Couldn't connect the video call. Configure a TURN relay for cross-network calls.");
          return;
        }
        setNotice("Video connection lost. Trying to reconnect...");
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(tryRenegotiate, 1500);
        return;
      }

      // "disconnected" is often transient — give ICE time to recover before restarting.
      if (s === "disconnected") {
        connectionLost.current = true;
        if (role !== "host") return;
        if (restartAttempts.current >= MAX_ICE_RESTARTS) return;
        setIceInfo("Connecting...");
        setNotice("Video connection lost. Trying to reconnect...");
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => {
          if (peer.current?.connectionState === "disconnected" && restartAttempts.current < MAX_ICE_RESTARTS) {
            setIceInfo("Retrying...");
            tryRenegotiate();
          }
        }, 5000);
        return;
      }

      if (s === "closed") {
        setIceInfo("");
        clearInterval(iceWatchdogRef.current);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        clearInterval(iceWatchdogRef.current);
      }
      if (pc.iceConnectionState === "failed") {
        setIceInfo("Retrying...");
        if (role === "host" && restartAttempts.current < MAX_ICE_RESTARTS) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = setTimeout(tryRenegotiate, 1200);
        }
      }
    };
    // Once candidates finish gathering but no route is established, retry early
    // instead of waiting for the 22s stuck watchdog.
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(earlyCheckRef.current);
      earlyCheckRef.current = setTimeout(() => {
        if (!peer.current || peer.current !== pc) return;
        const st = pc.connectionState;
        if (st === "connected" || st === "failed" || st === "closed") return;
        if (restartAttempts.current >= MAX_ICE_RESTARTS) return;
        if (role === "host" && Date.now() - lastRestart.current > 6000) {
          setIceInfo("Connecting... (retrying)");
          tryRenegotiate();
        }
      }, 8000);
    };

    // Stuck-ICE watchdog: different NATs sometimes leave ICE in "connecting"
    // forever. Retry (iceRestart) periodically instead of hanging silently.
    clearInterval(iceWatchdogRef.current);
    const ownPc = pc;
    iceWatchdogRef.current = setInterval(() => {
      if (!peer.current || peer.current !== ownPc) { clearInterval(iceWatchdogRef.current); return; }
      const st = ownPc.connectionState;
      const ice = ownPc.iceConnectionState;
      if (st === "connected" || st === "closed" || st === "failed") { clearInterval(iceWatchdogRef.current); return; }
      if (ice === "connected" || ice === "completed") { clearInterval(iceWatchdogRef.current); return; }
      if (restartAttempts.current >= MAX_ICE_RESTARTS) { clearInterval(iceWatchdogRef.current); setIceInfo("Connection failed"); return; }
      if (role === "host" && Date.now() - lastRestart.current > 6000) {
        setIceInfo("Connecting... (retrying)");
        tryRenegotiate();
      }
    }, 22000);

    if (isOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { roomId: roomIdRef.current, offer });
    }
  }

  async function enterRoom(nextRole, nextRoomId) {
    setError("");
    const cleanName = name.trim();
    if (!cleanName) return setError("Enter a display name.");
    rejoinScheduledRef.current = false;
    rejoinInFlightRef.current = false;
    roomIdRef.current = nextRoomId;
    nameRef.current = cleanName;
    setRoomId(nextRoomId);

    const event = nextRole === "host" ? "room:create" : "room:join";
    const payload = nextRole === "host"
      ? { name: cleanName, movieUrl: linkInput.trim() }
      : { roomId: nextRoomId, name: cleanName };

    socket.emit(event, payload, async (result) => {
      if (!result?.ok) {
        const errors = {
          ROOM_NOT_FOUND: "This room doesn't exist or has expired.",
          ROOM_FULL: "This room already has two participants."
        };
        return setError(errors[result?.error] || "Unable to enter the room.");
      }
      setRole(result.role);
      setRoomId(result.roomId);
      setRoomState(result.state);
      setMovieUrl((result.state?.movieUrl) || MOVIE_SRC);
      setPlayback(result.state?.playback || null);
      setView("room");
      writeStoredSession({ roomId: result.roomId, name: cleanName, role: result.role, joinedAt: Date.now() });
      window.history.replaceState({}, "", `/room/${result.roomId}`);
      applyReady(result.state?.ready, result.role);
      await getLocalMedia();
      if (result.role === "host") setNotice("Waiting for your friend...");
    });
  }

  function createRoom() {
    enterRoom("host", "");
  }

  function joinRoom() {
    enterRoom("guest", roomIdInput.trim());
  }

  function toggleCamera() {
    const next = !media.cameraEnabled;
    localStream.current?.getVideoTracks().forEach((track) => track.enabled = next);
    setMedia((m) => ({ ...m, cameraEnabled: next }));
    socket.emit("media:state", { roomId, ...media, cameraEnabled: next });
  }

  function toggleMic() {
    const next = !media.micEnabled;
    localStream.current?.getAudioTracks().forEach((track) => track.enabled = next);
    setMedia((m) => ({ ...m, micEnabled: next }));
    socket.emit("media:state", { roomId, ...media, micEnabled: next });
  }

  const handlePlayerPlayback = useCallback((playing, time) => {
    setPlayback({ playing, time });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Real seat names for the lobby / title card / recap. */
  const seatNames = useCallback(() => {
    const rs = roomStateRef.current;
    const selfName = nameRef.current;
    const hostN = rs?.host?.name || selfName;
    const guestN = rs?.guest?.name || "";
    return { hostN, guestN, isSolo: Boolean(soloModeRef.current) || !rs?.guest };
  }, []);

  /* YouTube title (real, from the player) surfaces for the lobby + title card. */
  const handleVideoMeta = useCallback((videoInfo) => {
    const t = videoInfo && videoInfo.title;
    if (t && String(t).toLowerCase() !== "undefined") setMovieTitle(String(t));
  }, []);

  /* Reaction showers: spawn at the sender's camera presence and fly to the movie. */
  const spawnReactionShower = useCallback((emoji, originType) => {
    const scene = stageRef.current;
    const id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fallbackX = Math.max(40, (window.innerWidth || 800) - 56);
    const fallbackY = Math.round((window.innerHeight || 600) * 0.42);
    const sceneRect = scene && scene.getBoundingClientRect();
    const sx = sceneRect && sceneRect.width ? sceneRect.left + sceneRect.width / 2 : Math.round((window.innerWidth || 800) / 2);
    const sy = sceneRect && sceneRect.height ? sceneRect.top + sceneRect.height * 0.42 : Math.round((window.innerHeight || 600) / 2);
    let ox = fallbackX;
    let oy = fallbackY;
    if (originType) {
      const sel = originType === "self"
        ? ".cam-chip.self, .camera-overlays .overlay-self"
        : ".cam-chip.remote, .camera-overlays .overlay-remote";
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { ox = r.left + r.width / 2; oy = r.top + r.height / 2; }
      }
    }
    setReactionShowers((prev) => {
      const next = [...prev, { id, emoji, x: ox, y: oy, dx: sx - ox, dy: sy - oy }];
      return next.length > MAX_SHOWERS ? next.slice(next.length - MAX_SHOWERS) : next;
    });
    setTimeout(() => {
      setReactionShowers((prev) => prev.filter((s) => s.id !== id));
    }, SHOWER_MS);
  }, []);

  /* Real movie-end → cinematic wrap (never invents numbers: only session facts). */
  const handleMovieEnded = useCallback(() => {
    if (wrapShownRef.current) return;
    wrapShownRef.current = true;
    const facts = sessionFactsRef.current;
    const { hostN, guestN, isSolo } = seatNames();
    const durationSec = movieStartAtRef.current > 0
      ? Math.max(0, Math.round((Date.now() - movieStartAtRef.current) / 1000))
      : 0;
    setHangoutMode(false);
    setWrapInfo({
      title: movieTitle || movieDisplayName(movieUrl),
      durationSec,
      feelings: Object.keys(facts.feelings).length ? { ...facts.feelings } : null,
      reactions: facts.reactions,
      chats: facts.chats,
      solo: isSolo,
      names: isSolo ? hostN : [hostN, guestN].filter(Boolean).join(" & ")
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieTitle, movieUrl]);

  useEffect(() => {
    if (playback && (playback.playing || (playback.time || 0) > 0)) setMovieStarted(true);
  }, [playback]);

function scheduleCinemaDismiss() {
    clearTimeout(cineTimer.current);
    const reduced = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cineTimer.current = setTimeout(() => setCinemaIntro(false), reduced ? CINE_INTRO_MS_REDUCED : CINE_INTRO_MS);
  }

function startMovie() {
    setMovieStarted(true);
    movieStartAtRef.current = Date.now();
    playerRef.current?.play();
    // Lights-out cinema start: same cinematic title card on BOTH participants
    // (movie:start is server-broadcast). Playback is never delayed by it.
    setCinemaIntro(true);
    scheduleCinemaDismiss();
    const vd = playerRef.current && playerRef.current.getVideoData
      ? playerRef.current.getVideoData()
      : null;
    if (vd && vd.title && String(vd.title).toLowerCase() !== "undefined") setMovieTitle(String(vd.title));
  }

  // Mirror the server's authoritative {host, guest} ready flags onto local state.
  function applyReady(r, selfRole) {
    if (!r || !selfRole) return;
    setReadyMe(selfRole === "host" ? Boolean(r.host) : Boolean(r.guest));
    setReadyPartner(selfRole === "host" ? Boolean(r.guest) : Boolean(r.host));
  }

function toggleReady() {
    const next = !readyMe;
    socket.emit("ready:set", { roomId, ready: next });
    setReadyMe(next);
  }

  async function copyHeaderInvite() {
    if (!inviteLink) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(inviteLink);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = inviteLink;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    const next = ok ? "ok" : "err";
    clearTimeout(copyTimer.current);
    setCopyStatus(next);
    copyTimer.current = setTimeout(() => setCopyStatus(""), next === "ok" ? 2000 : 1500);
  }

  function sendMessage(e) {
    e.preventDefault();
    if (!message.trim()) return;
    sessionFactsRef.current.chats += 1;
    socket.emit("chat:message", { roomId, message });
    setMessage("");
  }

  function sendReaction(reaction) {
    sessionFactsRef.current.reactions += 1;
    socket.emit("reaction:send", { roomId, reaction });
    spawnReactionShower(reaction, "self");
  }

  function closeFeelingMenu() {
    if (feelClosing || !feelingOpen) return;
    setFeelClosing(true);
    feelCloseTimer.current = setTimeout(() => {
      setFeelingOpen(false);
      setFeelClosing(false);
    }, 240);
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") closeFeelingMenu(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feelingOpen, feelClosing]);

  function sendFeeling(value) {
    const text = String(value || "").trim();
    if (!text) return;
    sessionFactsRef.current.feelings[text] = (sessionFactsRef.current.feelings[text] || 0) + 1;
    socket.emit("feel:send", { roomId, value: text });
    setFeelText("");
    setFeelSent(true);
    clearTimeout(feelSentTimer.current);
    feelSentTimer.current = setTimeout(() => setFeelSent(false), 1100);
    closeFeelingMenu();
  }

  function stopLocalMedia() {
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (localVideoOverlay.current) localVideoOverlay.current.srcObject = null;
  }

  function closePeerConnection() {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    remoteStreamRef.current = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (remoteVideoOverlay.current) remoteVideoOverlay.current.srcObject = null;
    clearTimeout(reconnectTimer.current);
    clearTimeout(earlyCheckRef.current);
    clearInterval(iceWatchdogRef.current);
    restartAttempts.current = 0;
    connectionLost.current = false;
  }

  // Socket.IO auto-rejoin: when the transport drops (Wi-Fi → 4G handoff, proxy
  // blip, …) the socket reconnects on its own; we re-enter the SAME room via
  // room:join (restoring the host slot with asHost when we were the host) and
  // let the existing startPeer / ICE-restart machinery rebuild the call.
  async function rejoinRoom(rejoinRoomId, opts = {}) {
    const { recover = false } = opts;
    if (rejoinInFlightRef.current) return;
    rejoinInFlightRef.current = true;
    const prevRole = prevRoleRef.current || role;
    rejoinScheduledRef.current = false;
    console.log(`[socket] rejoin started: room=${rejoinRoomId} role=${prevRole} recover=${recover}`);

    const attempts = recover ? REJOIN_MAX_ATTEMPTS : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = await new Promise((resolve) => {
        socket.emit("room:join", {
          roomId: rejoinRoomId,
          name: nameRef.current || name || "Guest",
          asHost: prevRole === "host"
        }, resolve);
      });

      if (result?.ok) {
        const finalName = nameRef.current || name || (result.role === "host" ? "Host" : "Guest");
        setRole(result.role);
        setRoomId(result.roomId);
        roomIdRef.current = result.roomId;
        setRoomState(result.state);
        setMovieUrl(result.state?.movieUrl || MOVIE_SRC);
        setPlayback(result.state?.playback || null);
        applyReady(result.state?.ready, result.role);
        partnerLeftHandledRef.current = false;
        setPartnerLeftAlert(false);
        writeStoredSession({ roomId: result.roomId, name: finalName, role: result.role, joinedAt: Date.now() });
        if (recover) {
          setView("room");
          window.history.replaceState({}, "", `/room/${result.roomId}`);
        }
        console.log("[socket] rejoin succeeded — room:", result.roomId);
        if (result.role === "host" && result.state?.count === 2) {
          console.log("[webrtc] re-establishing call as host (offerer)");
          setTimeout(() => startPeerRef.current?.(true), 60);
        } else {
          console.log("[webrtc] rejoin ok — waiting for host offer / restart");
        }
        rejoinInFlightRef.current = false;
        return;
      }

      const err = result?.error || "unknown";
      console.log(`[socket] rejoin attempt ${attempt}/${attempts} failed: ${err}`);
      if (err === "ROOM_FULL" && attempt < attempts) {
        // The old socket's slot frees itself on the server once it disconnects;
        // wait a bit before retrying so recovery actually lands.
        await new Promise((r) => setTimeout(r, REJOIN_BACKOFF_MS * attempt));
        continue;
      }
      rejoinInFlightRef.current = false;
      if (recover) clearStoredSession();
      backToHome();
      return;
    }
  }

  function resetRoomUi() {
    setPlayback(null);
    setMovieStarted(false);
    setMessages([]);
    setUnreadMsgs(0);
    setLinkInput("");
    setFeelingOpen(false);
    setFeelClosing(false);
    setFeelText("");
    setFeelToast(null);
    setReadyMe(false);
    setReadyPartner(false);
    setCinemaIntro(false);
    setWrapInfo(null);
    setHangoutMode(false);
    setShareUrl(null);
    setShareStatus("");
    wrapShownRef.current = false;
    sessionFactsRef.current = { feelings: {}, reactions: 0, chats: 0 };
    movieStartAtRef.current = 0;
    clearTimeout(cineTimer.current);
    clearTimeout(shareTimer.current);
  }

  function backToHome() {
    socket.emit("room:leave");
    playerRef.current?.pause();
    stopLocalMedia();
    closePeerConnection();
    setIceInfo("");
    setShowLeaveConfirm(false);
    setPartnerLeftAlert(false);
    setSoloMode(false);
    resetRoomUi();
    setRoomId("");
    roomIdRef.current = "";
    rejoinScheduledRef.current = false;
    rejoinInFlightRef.current = false;
    setRoomState(null);
    setView("home");
    setNotice("");
    window.history.replaceState({}, "", "/");
    hasLeftRef.current = false;
    partnerLeftHandledRef.current = false;
    clearStoredSession();
  }

  function performCleanExit() {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;
    hasLeftRef.current = true;
    socket.emit("room:leave");
    playerRef.current?.pause();
    stopLocalMedia();
    closePeerConnection();
    setIceInfo("");
    setShowLeaveConfirm(false);
    setPartnerLeftAlert(false);
    resetRoomUi();
    setRoomId("");
    roomIdRef.current = "";
    rejoinScheduledRef.current = false;
    rejoinInFlightRef.current = false;
    setRoomState(null);
    setView("thanks");
    setNotice("");
    window.history.replaceState({}, "", "/");
    clearStoredSession();
  }

  function leaveRoom() {
    if (isCleaningUpRef.current) return;
    setShowLeaveConfirm(true);
  }

  function confirmLeaveRoom() {
    if (isCleaningUpRef.current) return;
    setShowLeaveConfirm(false);
    performCleanExit();
  }

  function continueWatchingSolo() {
    if (hasLeftRef.current || isCleaningUpRef.current) return;
    hasLeftRef.current = true;
    setPartnerLeftAlert(false);
    setSoloMode(true);
    socket.emit("room:leave");
    stopLocalMedia();
    closePeerConnection();
    setIceInfo("");
setRoomId("");
    roomIdRef.current = "";
    rejoinScheduledRef.current = false;
    rejoinInFlightRef.current = false;
    setRoomState(null);
    setPlayback(null);
    setNotice("");
    setFeelingOpen(false);
    setFeelClosing(false);
    setFeelText("");
    setFeelToast(null);
    window.history.replaceState({}, "", "/");
    setReadyMe(false);
    setReadyPartner(false);
    clearStoredSession();
  }

  function stayTogether() {
    setWrapInfo(null);
    setHangoutMode(true);
    if (isMobileViewport()) { setChatOpen(true); setSidebarOpen(true); }
  }

  function closeWrap() {
    setWrapInfo(null);
    setHangoutMode(false);
    backToHome();
  }

  function handleShare() {
    clearTimeout(shareTimer.current);
    const info = wrapInfo;
    if (!info) return;
    setShareStatus("");
    const dataUrl = buildShareCard({
      title: info.title,
      names: info.solo ? "" : info.names,
      durationText: info.durationSec > 0 ? fmtDur(info.durationSec) : "",
      feelings: info.feelings,
      reactions: info.reactions,
      chats: info.chats,
      roomId: roomIdRef.current
    });
    if (!dataUrl) {
      setShareStatus("Couldn't render the card on this device.");
      return;
    }
    setShareUrl(dataUrl);
    const slug = String(info.title || "movie")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 22) || "movie-night";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `callflix-${slug}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setShareStatus("Card saved ✓");
    shareTimer.current = setTimeout(() => setShareStatus(""), 4000);
  }

  function bumpChrome() {
    setChromeVisible(true);
    clearTimeout(chromeTimer.current);
    const focused = document.activeElement && document.activeElement.tagName === "INPUT";
    if (focused) return;
    if (playback && !playback.playing) return;
    chromeTimer.current = setTimeout(() => setChromeVisible(false), 2600);
  }

  function closeChat() {
    setChatOpen(false);
  }

  useEffect(() => {
    if (view === "room" && isMobileViewport()) {
      setChatOpen(false);
      setSidebarOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onActivity = () => bumpChrome();
    el.addEventListener("mousemove", onActivity);
    el.addEventListener("touchstart", onActivity);
    bumpChrome();
    return () => {
      clearTimeout(chromeTimer.current);
      el.removeEventListener("mousemove", onActivity);
      el.removeEventListener("touchstart", onActivity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, view]);

  useEffect(() => {
    const onFs = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (fs) {
        setSidebarOpen(true);
      } else {
        setCamSide("right");
        camSideRef.current = "right";
        camDragRef.current = null;
        camYRef.current = 0;
        camTapRef.current = null;
        clearTimeout(sideSwitchTimer.current);
        setSideSwitching(false);
        const ws = workspaceRef.current;
        if (ws) {
          const st = ws.querySelector(".watch-stage");
          const sb = ws.querySelector(".sidebar");
          if (st) { st.style.removeProperty("transition"); st.style.removeProperty("transform"); }
          if (sb) { sb.style.removeProperty("transition"); sb.style.removeProperty("transform"); }
          const camEl = ws.querySelector(".cameras");
          const chatEl = ws.querySelector(".chat-area");
          if (camEl) { camEl.style.removeProperty("transition"); camEl.style.removeProperty("transform"); }
          if (chatEl) { chatEl.style.removeProperty("transition"); chatEl.style.removeProperty("transform"); }
        }
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (localStream.current && localVideo.current) localVideo.current.srcObject = localStream.current;
    if (remoteStreamRef.current && remoteVideo.current) remoteVideo.current.srcObject = remoteStreamRef.current;
    if (localStream.current && localVideoOverlay.current) localVideoOverlay.current.srcObject = localStream.current;
    if (remoteStreamRef.current && remoteVideoOverlay.current) remoteVideoOverlay.current.srcObject = remoteStreamRef.current;
  }, [view, roomId, role, media.cameraEnabled]);

  async function tryRenegotiate() {
    const pc = peer.current;
    if (!pc || pc.connectionState === "connected") return;
    if (restartAttempts.current >= MAX_ICE_RESTARTS) return;
    if (Date.now() - lastRestart.current < 3000) return;
    lastRestart.current = Date.now();
    restartAttempts.current += 1;
    console.log("[webrtc] renegotiation started");
    try {
      pc.restartIce?.();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { roomId: roomIdRef.current, offer });
    } catch (err) {
      console.error("[webrtc] renegotiation FAILED:", err && (err.name || "?"), err && err.message);
      // A failed negotiation shouldn't burn a retry budget.
      restartAttempts.current = Math.max(0, restartAttempts.current - 1);
    }
  }

  async function refreshIceInfo(pc) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      let selectedId = null;
      stats.forEach((r) => {
        if (r.type === "candidate-pair") {
          // Prefer the actual in-use pair (nominated/selected), best priority wins.
          const inUse = r.state === "succeeded" && (r.nominated === true || r.selected === true);
          if (inUse && (!pair || (r.priority || 0) > (pair.priority || 0))) pair = r;
        }
        if (r.type === "transport") selectedId = r.selectedCandidatePairId || selectedId;
      });
      if (!pair && selectedId) pair = stats.get(selectedId);
      if (pair) {
        const remote = stats.get(pair.remoteCandidateId);
        const local = stats.get(pair.localCandidateId);
        const rType = remote?.candidateType || remote?.type;
        const lType = local?.candidateType || local?.type;
        const relayed = rType === "relay" || lType === "relay";
        setIceInfo(relayed ? "Relay (TURN)" : "Direct (P2P)");
      } else {
        setIceInfo("Connected");
      }
    } catch {
      setIceInfo("Connected");
    }
  }

  function toggleFullscreen() {
    const el = pageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }

  useEffect(() => { camSideRef.current = camSide; }, [camSide]);

  /* Fullscreen 80/20 camera-pair drag: the pair is a LOCKED group; dragging it
     horizontally only switches the dedicated camera zone between RIGHT and LEFT
     (movie stays 80%, cameras stay 20%, no free positioning). Vertically the
     pair slides freely inside the zone (top rail) while the chat sits at its
     own resting spot on the bottom rail — chat is INDEPENDENT (no inverse
     mirror) and only lifts a little as a cushion when the pair approaches. */
  const CAM_DRAG_GAP = 16; // min px kept between pair bottom and chat top
  const CHAT_MAX_UP = 60; // max cushion lift of the chat (px)
  const SIDE_SWITCH_MS = 620; // chat-icon fade duration ≈ side slide (.55s) + buffer
  function beginSideSwitch() {
    setSideSwitching(true);
    clearTimeout(sideSwitchTimer.current);
    sideSwitchTimer.current = setTimeout(() => setSideSwitching(false), SIDE_SWITCH_MS);
  }
  function handleCamPointerDown(e) {
    if (!isFullscreen) return;
    if (typeof e.button === "number" && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest("button")) return;
    /* double-tap detection (pointer-based: works with mouse AND touch, no
       reliance on the platform's dblclick event): two quick taps on the pair
       switch the dedicated zone side instantly — no reload, no reconnect. */
    const now = e.timeStamp || Date.now();
    const lastTap = camTapRef.current;
    if (lastTap && now - lastTap.t < 320 && Math.abs(e.clientX - lastTap.x) < 40 && Math.abs(e.clientY - lastTap.y) < 40) {
      camTapRef.current = null;
      toggleCamSide();
      return;
    }
    camTapRef.current = { t: now, x: e.clientX, y: e.clientY };
    const ws = workspaceRef.current;
    if (!ws) return;
    const sb = ws.querySelector(".sidebar");
    const camEl = ws.querySelector(".cameras");
    const chatEl = ws.querySelector(".chat-area");
    const zb = sb ? sb.getBoundingClientRect() : null;
    const cb = camEl ? camEl.getBoundingClientRect() : null;
    const hb = chatEl ? chatEl.getBoundingClientRect() : null;
    let chatUp0 = 0;
    if (chatEl) {
      const m = (chatEl.style.transform || "").match(/translateY\((-?[\d.]+)px\)/);
      if (m) chatUp0 = -parseFloat(m[1]);
    }
    camDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      fromLeft: camSideRef.current === "left", W: ws.clientWidth,
      moved: false, camY0: camYRef.current,
      zoneTop: zb ? zb.top : 0, zoneBottom: zb ? zb.bottom : 0,
      camTop: cb ? cb.top : 0, camH: cb ? cb.height : 0,
      chatTop: hb ? hb.top : 0, chatH: hb ? hb.height : 0, chatUp0
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handleCamPointerMove(e) {
    const d = camDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
    const W = d.W || 1;
    const base = d.fromLeft ? -0.8 * W : 0;
    const camX = Math.max(-0.8 * W, Math.min(0, base + dx));
    const movieX = -camX / 4;
    const ws = workspaceRef.current;
    if (!ws) return;
    const st = ws.querySelector(".watch-stage");
    const sb = ws.querySelector(".sidebar");
    const camEl = ws.querySelector(".cameras");
    const chatEl = ws.querySelector(".chat-area");
    if (st) { st.style.transition = "none"; st.style.transform = `translateX(${movieX}px)`; }
    if (sb) { sb.style.transition = "none"; sb.style.transform = `translateX(${camX}px)`; }
    /* vertical: the pair slides freely inside the zone (top rail). The chat
       keeps its OWN resting spot (bottom rail) and NEVER mirrors the move — it
       only lifts UPWARD as a collision cushion while the pair approaches its
       top, exactly enough to hold the gap at CAM_DRAG_GAP; the pair clamps
       above the chat's fully-lifted top, so they can never touch. When the pair
       retreats, the chat glides back down (its CSS transition). */
    const defaultChatTop = d.chatTop + d.chatUp0;
    const camBotMax = defaultChatTop - CHAT_MAX_UP - CAM_DRAG_GAP;
    const camTopMax = Math.max(d.zoneTop, Math.min(d.zoneBottom - d.camH, camBotMax - d.camH));
    const top = Math.min(camTopMax, Math.max(d.zoneTop, d.camTop + dy));
    const camBot = top + d.camH;
    const newY = d.camY0 + (top - d.camTop);
    camYRef.current = newY;
    if (camEl) { camEl.style.transition = "none"; camEl.style.transform = `translateY(${newY}px)`; }
    if (chatEl) {
      /* lift window: chat rises 0→CHAT_MAX_UP over the last CHAT_MAX_UP px of
         approach; cameras stop at camBotMax so the gap is ALWAYS ≥ GAP and the
         lift never exceeds CHAT_MAX_UP. Outside the window chat stays at rest. */
      const liftStart = camBotMax - CHAT_MAX_UP;
      const chatUp = Math.min(CHAT_MAX_UP, Math.max(0, camBot - liftStart));
      if (chatUp > 0.5) {
        chatEl.style.transition = "none";
        chatEl.style.transform = `translateY(${-chatUp}px)`;
      } else {
        chatEl.style.transition = "transform .3s var(--ease)";
        chatEl.style.transform = "translateY(0px)";
      }
    }
  }

  function endCamPointerDrag() {
    const d = camDragRef.current;
    if (!d) return;
    camDragRef.current = null;
    const ws = workspaceRef.current;
    if (!ws) return;
    const W = d.W || 1;
    const camEl = ws.querySelector(".cameras");
    const chatEl = ws.querySelector(".chat-area");
    if (camEl) camEl.style.removeProperty("transition");
    if (chatEl) chatEl.style.removeProperty("transition");
    const st = ws.querySelector(".watch-stage");
    const sb = ws.querySelector(".sidebar");
    if (d.moved) {
      let camX = 0;
      const m = sb && sb.style.transform && sb.style.transform.match(/-?[\d.]+/);
      if (m) camX = parseFloat(m[0]);
      const toLeft = camX < -0.4 * W;
      setCamSide(toLeft ? "left" : "right");
      camSideRef.current = toLeft ? "left" : "right";
      beginSideSwitch();
    }
    requestAnimationFrame(() => {
      if (st) { st.style.removeProperty("transition"); st.style.removeProperty("transform"); }
      if (sb) { sb.style.removeProperty("transition"); sb.style.removeProperty("transform"); }
    });
  }

  function handleCamPointerUp(e) { if (e.pointerId === camDragRef.current?.pointerId) endCamPointerDrag(); }
  function handleCamPointerCancel(e) { if (e.pointerId === camDragRef.current?.pointerId) endCamPointerDrag(); }

  /* Double-tap the camera pair → instant side switch (no reload, no reconnect). */
  function toggleCamSide() {
    const next = camSideRef.current === "left" ? "right" : "left";
    setCamSide(next);
    camSideRef.current = next;
    beginSideSwitch();
    const ws = workspaceRef.current;
    if (!ws) return;
    requestAnimationFrame(() => {
      const st = ws.querySelector(".watch-stage");
      const sb = ws.querySelector(".sidebar");
      if (st) { st.style.removeProperty("transition"); st.style.removeProperty("transform"); }
      if (sb) { sb.style.removeProperty("transition"); sb.style.removeProperty("transform"); }
    });
  }

  if (view === "home") {
    return (
      <main className="landing">
        <div className="ambient" />
        <section className="hero">
          <div className="brand"><span className="brand-word">Call<em>Flix</em></span></div>
          <p className="eyebrow">PRIVATE WATCH PARTY FOR TWO</p>
          <h1>Watch together,<br /><em>even when you're apart.</em></h1>
          <p className="subtitle">One private room. One movie. A real video call. Perfectly simple.</p>
          <div className="actions">
            <button className="primary" onClick={() => setView("create")}>Create Room</button>
            <button className="secondary" onClick={() => setView("join")}>Join Room</button>
          </div>
        </section>
      </main>
    );
  }

  if (view === "create" || view === "join") {
    const joining = view === "join";
    return (
      <main className="landing">
        <div className="ambient" />
        <section className="card setup-card">
<div className="brand small">
          <svg className="brand-logo" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id="cfglg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff2431" />
                <stop offset="1" stopColor="#a30a14" />
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#cfglg)" />
            <path d="M10 7.6 17 12l-7 4.4z" fill="#fff" />
</svg>
          <span className="brand-word">Call<em>Flix</em></span>
        </div>
          <h2>{joining ? "Join CallFlix" : "Create your room"}</h2>
          <p>{joining ? "Enter the room link or ID your friend sent you." : "Create a private room and invite one person."}</p>

          <label>Display name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mahdi" maxLength={30} />

          {joining && (
            <>
              <label>Room ID</label>
              <input value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} placeholder="abc123xyz" />
            </>
          )}

          {!joining && (
            <>
              <label>Movie link (optional)</label>
              <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} placeholder="https://example.com/movie.mp4" />
            </>
          )}

          {error && <div className="error">{error}</div>}
          <button className="primary wide" onClick={joining ? joinRoom : createRoom}>
            {joining ? "Join Room" : "Create Room"}
          </button>
          <button className="text-button" onClick={() => setView("home")}>Back</button>
        </section>
      </main>
    );
  }

  if (view === "thanks") {
    return (
      <main className="landing">
        <div className="ambient" />
        <section className="card thanks-card">
          <div className="thanks-heart">❤️</div>
          <h2>Thanks for watching</h2>
          <p className="thanks-sub">Hope you enjoyed the movie!</p>
          <button className="primary wide" onClick={backToHome}>Back to Home</button>
        </section>
      </main>
    );
  }

  const hostName = roomState?.host?.name || name;
  const guestName = roomState?.guest?.name || "Waiting…";
  const seatHostReady = role === "host" ? readyMe : readyPartner;
  const seatGuestReady = role === "guest" ? readyMe : readyPartner;

  return (
    <main ref={pageRef} className={`room-page ${sidebarOpen ? "" : "chat-closed"} ${hangoutMode ? "hangout" : ""}`}>
      <header className="topbar">
        <div className="brand small">
          <svg className="brand-logo" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id="cfglg2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#ff2431" />
                <stop offset="1" stopColor="#a30a14" />
              </linearGradient>
            </defs>
            <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#cfglg2)" />
            <path d="M10 7.6 17 12l-7 4.4z" fill="#fff" />
          </svg>
          <span className="brand-word">Call<em>Flix</em></span>
        </div>
        {!soloMode && <div className="room-pill">ROOM <strong>{roomId}</strong></div>}
        <div className="topbar-actions">
          {iceInfo && !soloMode && (
            <div className="ice-pill" title={`Connection: ${iceInfo}`}>
              <span className={`ice-dot ${/Retrying|Connecting|Waiting/.test(iceInfo) ? "waiting" : "good"} ${/failed/i.test(iceInfo) ? "bad" : ""}`} />
              {iceInfo}
            </div>
          )}
          <button
            className={`inviter ${copyStatus === "ok" ? "ok" : ""} ${copyStatus === "err" ? "err" : ""}`}
            onClick={copyHeaderInvite}
            title="Copy invitation link"
          >
            {copyStatus === "ok" ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            <span key={copyStatus} className="ib-txt">{copyStatus === "ok" ? "Copié !" : "Inviter"}</span>
          </button>
          <button
            className={`chat-toggle ${sidebarOpen ? "active" : ""}`}
            onClick={() => setSidebarOpen((o) => !o)}
            title="Toggle chat panel"
          >
            <IconChat /> <span>Chat</span>
            {unreadMsgs > 0 && <span className="msg-badge">{unreadMsgs > 9 ? "9+" : unreadMsgs}</span>}
          </button>
          <button className="leave" onClick={soloMode ? backToHome : leaveRoom}>
            {soloMode ? "Exit" : "Leave"}
          </button>
        </div>
      </header>

      <div ref={workspaceRef} className={`workspace ${camSide === "left" ? "cams-left" : ""}`}>
        <section className="watch-stage">
          <div ref={stageRef} className={`movie-scene ${chromeVisible ? "" : "chrome-hidden"}`}>
            <div className="movie-surface">
              <MoviePlayer
                ref={playerRef}
                url={movieUrl}
                playback={playback}
                onPlayback={handlePlayerPlayback}
                onToggleFullscreen={toggleFullscreen}
                io={socket}
                selfId={socketId}
                roomId={roomId}
                solo={soloMode}
                started={movieStarted}
                onMeta={handleVideoMeta}
                onEnded={handleMovieEnded}
                syncHidden={hangoutMode || partnerLeftAlert}
              />
            </div>

            {!movieStarted && (
              <div className="scene-topbar">
                <span className="eyebrow">TONIGHT'S MOVIE</span>
                <h2 className="scene-title">{movieTitle || "My Movie"}</h2>
                {roomState?.count === 2 && <div className="seats-booked">Two seats booked</div>}
              </div>
            )}

            {!soloMode && !movieStarted && (
              <div className="mobile-lobby">
                <div className="ml-title">{movieTitle || "Tonight's Feature"}</div>
                <div className="ml-seats">
                  <div className={`ml-seat${seatHostReady ? " on" : ""}`}>
                    <b>{hostName || "Host"}</b>
                    <i>{seatHostReady ? "Ready" : "Seated"}</i>
                  </div>
                  <div className={`ml-seat${seatGuestReady ? " on" : ""}`}>
                    <b>{guestName}</b>
                    <i>{seatGuestReady ? "Ready" : (roomState?.count === 2 ? "Seated" : "Waiting…")}</i>
                  </div>
                </div>
                {roomState?.count === 2 && (
                  <button
                    className={`ready-btn ml-ready${readyMe ? " on" : ""}${readyPartner ? " partner-ready" : ""}`}
                    onClick={toggleReady}
                    aria-pressed={readyMe}
                  >
                    {readyMe ? "✓ READY" : "READY"}
                  </button>
                )}
              </div>
            )}

            <div className="control-bar">
              {!soloMode && !partnerLeftAlert && (
                <>
                  <button onClick={toggleCamera} title="Toggle camera" aria-label="Toggle camera">{media.cameraEnabled ? <IconCam /> : <IconCamOff />}</button>
                  <button onClick={toggleMic} title="Toggle microphone" aria-label="Toggle microphone">{media.micEnabled ? <IconMic /> : <IconMicOff />}</button>
                  <span className="bar-sep" />
                </>
              )}
              <div className="reactions">
                {reactions.map((r) => <button key={r} onClick={() => sendReaction(r)} title={`Send ${r}`}>{r}</button>)}
              </div>
              {!soloMode && roomState?.count === 2 && (
                <>
                  <span className="bar-sep" />
                  <div className="feel-wrap">
                    <button
                      className={`feel-btn ${feelingOpen ? "active" : ""} ${feelSent ? "sent" : ""}`}
                      onClick={() => {
                        if (feelingOpen) { closeFeelingMenu(); return; }
                        clearTimeout(feelCloseTimer.current);
                        setFeelClosing(false);
                        setFeelingOpen(true);
                      }}
                      title="Send a feeling"
                    >
                      {feelSent ? "Sent ❤️" : "♡ Feeling"}
                    </button>
                    {feelingOpen && (
                      <>
                        <div className={`feel-overlay ${feelClosing ? "closing" : ""}`} onClick={closeFeelingMenu} />
                        <div className={`feel-panel ${feelClosing ? "feel-closing" : ""}`}>
                          <div className="feel-title">
                            Send a feeling
                            <button className="feel-close" onClick={closeFeelingMenu} title="Close">✕</button>
                          </div>
                          <div className="feel-options">
                            {FEELING_OPTIONS.map((f) => (
                              <button key={f.key} className="feel-option" onClick={() => sendFeeling(f.key)}>
                                <span>{f.emoji}</span> {f.label}
                              </button>
                            ))}
                          </div>
                          <div className="feel-write">
                            <input
                              value={feelText}
                              onChange={(e) => setFeelText(e.target.value)}
                              maxLength={80}
                              placeholder="Write something..."
                              onKeyDown={(e) => { if (e.key === "Enter") sendFeeling(feelText); }}
                            />
                            <button onClick={() => sendFeeling(feelText)}>Send</button>
                          </div>
</div>
                      </>
                    )}
                  </div>
                </>
              )}
              <button onClick={toggleFullscreen} title="Fullscreen" aria-label="Toggle fullscreen">{isFullscreen ? <IconShrink /> : <IconFullscreen />}</button>
            </div>

            {!soloMode && (
              <div className="camera-overlays">
                <div className={`cam-chip overlay-self ${media.cameraEnabled ? "" : "cam-off"}`}>
                  {media.cameraEnabled ? (
                    <video ref={localVideoOverlay} autoPlay muted playsInline />
                  ) : (
                    <div className="cam-placeholder">YOU</div>
                  )}
                  <span className="cam-name">You{media.micEnabled ? " · mic" : " · muted"}</span>
                  <div className="cam-actions">
                    <button title="Toggle camera" onClick={toggleCamera} aria-label="Toggle camera">{media.cameraEnabled ? <IconCam /> : <IconCamOff />}</button>
                    <button title="Toggle microphone" onClick={toggleMic} aria-label="Toggle microphone">{media.micEnabled ? <IconMic /> : <IconMicOff />}</button>
                  </div>
                </div>
                <div className="cam-chip overlay-remote">
                  <video ref={remoteVideoOverlay} autoPlay playsInline />
                  <span className="cam-name">
                    {role === "host" ? roomState?.guest?.name || "Waiting..." : roomState?.host?.name || "Host"}
                  </span>
                </div>
              </div>
            )}
            {hangoutMode && (
              <div className="hangout-scrim">
                <div className="hangout-eyebrow">After-party · still in the room</div>
              </div>
            )}
            {reactionShowers.map((s) => (
              <div
                key={s.id}
                className="reaction-shower"
                style={{ left: s.x, top: s.y, "--dx": `${s.dx}px`, "--dy": `${s.dy}px` }}
                aria-hidden="true"
              >{s.emoji}</div>
            ))}
              {feelToast && (
                <div className="feel-toast" key={feelToast.id}>
                  <span className="feel-toast-avatar">{String(feelToast.user || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="feel-toast-body">
                    <span className="feel-toast-name">{feelToast.user}</span>
                    <span className={`feel-toast-text${feelToast.special ? " special" : ""}`}>{feelToast.text}</span>
                  </span>
                </div>
              )}
          </div>
        </section>

        {sidebarOpen && (
          <aside className="sidebar">
            {!soloMode && (
              <div className="invite-box">
                <span className="eyebrow">PRIVATE THEATER</span>
                <strong>{roomState?.count || 1}/2 seats booked</strong>
                <div className="seats">
                  <div className={`seat${seatHostReady ? " on" : ""}`}>
                    <span className="seat-num">01</span>
                    <span className="seat-name">{hostName || "Host"}</span>
                    <span className="seat-tag">{seatHostReady ? "Ready" : "Seated"}</span>
                  </div>
                  <div className={`seat${seatGuestReady ? " on" : ""}`}>
                    <span className="seat-num">02</span>
                    <span className="seat-name">{guestName}</span>
                    <span className="seat-tag">{seatGuestReady ? "Ready" : (roomState?.count === 2 ? "Seated" : "Waiting…")}</span>
                  </div>
                </div>
                <div className="waiting-row">
                  <span className="waiting-dot" />
                  {roomState?.count === 2
                    ? ((readyMe || readyPartner) ? "Everyone's here — press READY to roll" : "The movie is cued. Press READY to start")
                    : "Waiting for your friend…"}
                </div>
                {roomState?.count === 2 && !movieStarted && !soloMode && (
                  <button
                    className={`ready-btn${readyMe ? " on" : ""}${readyPartner ? " partner-ready" : ""}`}
                    onClick={toggleReady}
                    aria-pressed={readyMe}
                  >
                    {readyMe ? "✓ READY" : "READY"}
                  </button>
                )}
              </div>
            )}

            {!soloMode && (
              <div className="cameras" onPointerDown={handleCamPointerDown} onPointerMove={handleCamPointerMove} onPointerUp={handleCamPointerUp} onPointerCancel={handleCamPointerCancel}>
                <div className={`cam-chip self ${media.cameraEnabled ? "" : "cam-off"}`}>
                  {media.cameraEnabled ? (
                    <video ref={localVideo} autoPlay muted playsInline />
                  ) : (
                    <div className="cam-placeholder">YOU</div>
                  )}
                  <span className="cam-name">{name || "You"} · {media.micEnabled ? "Mic on" : "Muted"}</span>
                  <div className="cam-actions">
                    <button title="Toggle camera" onClick={toggleCamera} aria-label="Toggle camera">{media.cameraEnabled ? <IconCam /> : <IconCamOff />}</button>
                    <button title="Toggle microphone" onClick={toggleMic} aria-label="Toggle microphone">{media.micEnabled ? <IconMic /> : <IconMicOff />}</button>
                  </div>
                </div>

                <div className="cam-chip remote">
                  <video ref={remoteVideo} autoPlay playsInline />
                  <span className="cam-name">
                    {role === "host" ? roomState?.guest?.name || "Waiting..." : roomState?.host?.name || "Host"}
                  </span>
                </div>
              </div>
            )}

            <div className="chat-area">
              <div className={`chat-panel ${chatOpen ? "open" : "closed"}`}>
                <div className="chat">
                    <div className="chat-title-row">
                      <div className="chat-title">Chat</div>
                      <button className="chat-close" onClick={closeChat} title="Collapse chat">✕</button>
                    </div>
                    <div className="messages">
                      {messages.length === 0 && <div className="empty">Say something while you watch ❤️</div>}
                      {messages.map((m) => (
                        <div className={`message ${m.role === role ? "mine" : ""}`} key={m.id}>
                          <small>{m.user}</small>
                          <p>{m.message}</p>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={sendMessage} className="chat-form">
                      <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type a message..." />
                      <button>Send</button>
                    </form>
                  </div>
                </div>
              </div>
          </aside>
        )}

        <button
          className={`chat-icon-btn ${chatOpen ? "hidden" : ""} ${sideSwitching ? "side-switching" : ""}`}
          onClick={() => setChatOpen(true)}
          title="Toggle chat"
          aria-label="Toggle chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
          {unreadMsgs > 0 && <span className="msg-badge">{unreadMsgs > 9 ? "9+" : unreadMsgs}</span>}
        </button>
      </div>

      {!soloMode && (
        <div className="mobile-bar">
          <button
            className={`mob-btn ${media.cameraEnabled ? "" : "off"}`}
            onClick={toggleCamera}
            title="Toggle camera"
            aria-label="Toggle camera"
          >
            {media.cameraEnabled ? <IconCam /> : <IconCamOff />}
          </button>
          <button
            className={`mob-btn ${media.micEnabled ? "" : "off"}`}
            onClick={toggleMic}
            title="Toggle microphone"
            aria-label="Toggle microphone"
          >
            {media.micEnabled ? <IconMic /> : <IconMicOff />}
          </button>
          <button
            className={`mob-btn chat ${chatOpen ? "active" : ""}`}
            onClick={() => { const next = !chatOpen; setChatOpen(next); if (next) setSidebarOpen(true); }}
            title="Open chat"
            aria-label="Open chat"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
            {unreadMsgs > 0 && <span className="msg-badge">{unreadMsgs > 9 ? "9+" : unreadMsgs}</span>}
          </button>
        </div>
      )}

      {cinemaIntro && (
        <div className="cine-intro" role="presentation" aria-hidden="true">
          <span className="cine-eyebrow">Tonight's feature</span>
          <h1 key={movieTitle} className="cine-title">{movieTitle || "My Movie"}</h1>
          {(roomState?.count === 2) && (
            <div className="cine-names">
              <span>{hostName}</span>
              <i>·</i>
              <span>{guestName}</span>
            </div>
          )}
        </div>
      )}

      {wrapInfo && (
        <div className="cf-wrap-backdrop">
          <div className="wrap-card">
            <span className="eyebrow">That's a wrap</span>
            <h2 className="wrap-title">{wrapInfo.title}</h2>
            <div className="wrap-divider" />
            {!wrapInfo.solo && <div className="wrap-line">Watched together</div>}
            {wrapInfo.durationSec > 0 && <div className="wrap-stat">{fmtDur(wrapInfo.durationSec)}</div>}
            {(() => {
              const feelKeys = wrapInfo.feelings ? Object.keys(wrapInfo.feelings) : [];
              const feelTotal = feelKeys.reduce((n, k) => n + wrapInfo.feelings[k], 0);
              const best = feelKeys.reduce((a, k) =>
                (!a || wrapInfo.feelings[k] > wrapInfo.feelings[a]) ? k : a, null);
              return (
                <>
                  {feelTotal > 0 && (
                    <div className="wrap-line">{feelTotal} feeling{feelTotal > 1 ? "s" : ""} exchanged</div>
                  )}
                  {best && wrapInfo.feelings[best] > 0 && (
                    <div className="wrap-strong">“{feelingDisplay(best)}”{wrapInfo.feelings[best] > 1 ? ` ×${wrapInfo.feelings[best]}` : ""}</div>
                  )}
                  {wrapInfo.reactions > 0 && (
                    <div className="wrap-line">{wrapInfo.reactions} reaction{wrapInfo.reactions > 1 ? "s" : ""}</div>
                  )}
                  {wrapInfo.chats > 1 && (
                    <div className="wrap-line">{wrapInfo.chats} messages together</div>
                  )}
                </>
              );
            })()}
            {wrapInfo.solo && <div className="wrap-line">A solo screening</div>}
            <p className="wrap-tagline">One more movie night together.</p>
            {shareUrl && <img className="wrap-share-img" src={shareUrl} alt="Your CALLFLIX share card" />}
            <div className="wrap-actions">
              {!wrapInfo.solo && (
                <button className="primary" onClick={stayTogether} title="Keep the call going">Stay together</button>
              )}
              <button className="ghost" onClick={handleShare} title={shareUrl ? "Card already saved to your downloads" : "Generate a share card"}>
                {shareUrl ? "Save card again" : "Share card"}
              </button>
              <button className="ghost" onClick={closeWrap} title="Leave the room">{wrapInfo.solo ? "Done" : "Close"}</button>
            </div>
            {shareStatus && <span className="wrap-note">{shareStatus}</span>}
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <div className="cf-modal-backdrop" onClick={() => setShowLeaveConfirm(false)}>
          <div className="cf-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Are you sure you want to leave the room?</h3>
            <div className="cf-modal-actions">
              <button className="ghost" onClick={() => setShowLeaveConfirm(false)}>Stay</button>
              <button className="primary" onClick={confirmLeaveRoom}>Leave Room</button>
            </div>
          </div>
        </div>
      )}

      {partnerLeftAlert && (
        <div className="cf-modal-backdrop">
          <div className="cf-modal">
            <h3>Your partner has left the room.</h3>
            <p className="cf-modal-sub">Do you want to continue watching the movie alone?</p>
            <div className="cf-modal-actions">
              <button className="primary" onClick={continueWatchingSolo}>Continue Watching</button>
              <button className="ghost" onClick={confirmLeaveRoom}>Leave Room</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;