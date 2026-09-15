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
  const [floatingReaction, setFloatingReaction] = useState(null);
  const [movieUrl, setMovieUrl] = useState(MOVIE_SRC);
  const [linkInput, setLinkInput] = useState("");
  const [editingMovie, setEditingMovie] = useState(false);
  const [newLink, setNewLink] = useState("");
  const [playback, setPlayback] = useState(null);
  const [movieStarted, setMovieStarted] = useState(false); // hides pre-start scene topbar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [introOverlay, setIntroOverlay] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [camSide, setCamSide] = useState("right"); // fullscreen 80/20: "right" | "left"
  const [chromeVisible, setChromeVisible] = useState(true);
  const [copyStatus, setCopyStatus] = useState("");
  const [iceInfo, setIceInfo] = useState("");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [partnerLeftAlert, setPartnerLeftAlert] = useState(false);
  const [soloMode, setSoloMode] = useState(false);
  const [introStep, setIntroStep] = useState("idle"); // idle | intro | capsule | done
  const [feelingOpen, setFeelingOpen] = useState(false);
  const [feelText, setFeelText] = useState("");
  const [feelToast, setFeelToast] = useState(null);
  const [feelSent, setFeelSent] = useState(false);
  const [feelClosing, setFeelClosing] = useState(false);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const feelToastTimer = useRef(null);
  const feelCloseTimer = useRef(null);
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
  const camDragRef = useRef(null); // { pointerId, startX, startY, fromLeft, moved, camY0, zoneTop/Bottom, camTop/H, chatTop/H }
  const camYRef = useRef(0); // fullscreen 80/20: vertical offset of the camera pair (px), chat mirrors inverse
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

  const isSalmaMode = useMemo(() => {
    const n = (name || "").toLowerCase();
    return n.includes("salma") || n.includes("sisi") || n.includes("sousou");
  }, [name]);

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
    const onConnect = () => setSocketId(socket.id);
    socket.on("connect", onConnect);
    if (socket.connected) setSocketId(socket.id);
    return () => socket.off("connect", onConnect);
  }, []);

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

  // Reading the chat clears the unread badge.
  useEffect(() => {
    if (sidebarOpen && chatOpen) setUnreadMsgs(0);
  }, [sidebarOpen, chatOpen]);

  useEffect(() => {
    const onJoined = ({ participant, state }) => {
      setRoomState(state);
      setNotice(`${participant.name} joined the room.`);
      if (role === "host") startPeer(true);
    };

    const onOffer = async ({ offer }) => {
      if (!peer.current) await startPeer(false);
      await peer.current.setRemoteDescription(offer);
      await flushCandidates();
      const answer = await peer.current.createAnswer();
      await peer.current.setLocalDescription(answer);
      socket.emit("webrtc:answer", { roomId, answer });
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
      const fromOther = item.role && roleRef.current && item.role !== roleRef.current;
      if (!fromOther) return;
      if (!(sidebarOpenRef.current && chatOpenRef.current)) setUnreadMsgs((n) => n + 1);
    };

    const onReaction = ({ reaction, id }) => {
      setFloatingReaction({ reaction, id });
      setTimeout(() => setFloatingReaction(null), 1200);
    };

    const onFeeling = ({ value, user }) => {
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
      setRoomState(null);
      setPlayback(null);
      setMovieStarted(false);
      setMessages([]);
      setUnreadMsgs(0);
      setLinkInput("");
      setEditingMovie(false);
      setMovieUrl(MOVIE_SRC);
      setIntroStep("idle");
      setFeelingOpen(false);
      setFeelClosing(false);
      setFeelText("");
      setFeelToast(null);
      setFeelSent(false);
      setView("home");
      window.history.replaceState({}, "", "/");
      hasLeftRef.current = false;
      partnerLeftHandledRef.current = false;
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
    };
  }, [role, roomId]);

  useEffect(() => {
    if (!isSalmaMode || introStep !== "idle" || roomState?.count !== 2) return;
    const t = setTimeout(() => setIntroStep("intro"), 400);
    return () => clearTimeout(t);
  }, [isSalmaMode, introStep, roomState?.count]);

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
      if (event.candidate) socket.emit("webrtc:ice", { roomId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
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
      socket.emit("webrtc:offer", { roomId, offer });
    }
  }

  async function enterRoom(nextRole, nextRoomId) {
    setError("");
    const cleanName = name.trim();
    if (!cleanName) return setError("Enter a display name.");
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

  useEffect(() => {
    if (playback && (playback.playing || (playback.time || 0) > 0)) setMovieStarted(true);
  }, [playback]);

function startMovie() {
    setMovieStarted(true);
    playerRef.current?.play();
  }

  function saveMovieLink() {
    setMovieUrl(newLink.trim());
    setEditingMovie(false);
    socket.emit("movie:set", { roomId, movieUrl: newLink.trim() });
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
    socket.emit("chat:message", { roomId, message });
    setMessage("");
  }

  function sendReaction(reaction) {
    socket.emit("reaction:send", { roomId, reaction });
    setFloatingReaction({ reaction, id: Date.now() });
    setTimeout(() => setFloatingReaction(null), 1200);
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
    socket.emit("feel:send", { roomId, value: text });
    setFeelText("");
    setFeelSent(true);
    clearTimeout(feelSentTimer.current);
    feelSentTimer.current = setTimeout(() => setFeelSent(false), 1100);
    closeFeelingMenu();
  }

  function openSurprise() {
    setIntroStep("capsule");
  }

  function startMovieFromCapsule() {
    setMovieStarted(true);
    setIntroStep("done");
    setIntroOverlay(true);
    setTimeout(() => {
      setIntroOverlay(false);
      playerRef.current?.play();
    }, 3400);
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

  function resetRoomUi() {
    setPlayback(null);
    setMovieStarted(false);
    setMessages([]);
    setUnreadMsgs(0);
    setLinkInput("");
    setEditingMovie(false);
    setIntroStep("idle");
    setFeelingOpen(false);
    setFeelClosing(false);
    setFeelText("");
    setFeelToast(null);
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
    setRoomState(null);
    setView("home");
    setNotice("");
    window.history.replaceState({}, "", "/");
    hasLeftRef.current = false;
    partnerLeftHandledRef.current = false;
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
    setRoomState(null);
    setView("thanks");
    setNotice("");
    window.history.replaceState({}, "", "/");
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
    setRoomState(null);
    setPlayback(null);
    setNotice("");
    setIntroStep("idle");
    setFeelingOpen(false);
    setFeelClosing(false);
    setFeelText("");
    setFeelToast(null);
    window.history.replaceState({}, "", "/");
  }

  function bumpChrome() {
    setChromeVisible(true);
    clearTimeout(chromeTimer.current);
    const focused = document.activeElement && document.activeElement.tagName === "INPUT";
    if (focused || editingMovie) return;
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
  }, [roomId, view, editingMovie]);

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
    try {
      pc.restartIce?.();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { roomId, offer });
    } catch {
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
     (movie stays 80%, cameras stay 20%, no free positioning). */
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
    camDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      fromLeft: camSideRef.current === "left", W: ws.clientWidth,
      moved: false, camY0: camYRef.current,
      zoneTop: zb ? zb.top : 0, zoneBottom: zb ? zb.bottom : 0,
      camTop: cb ? cb.top : 0, camH: cb ? cb.height : 0,
      chatTop: hb ? hb.top : 0, chatH: hb ? hb.height : 0
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
    /* vertical: the pair slides up/down inside the zone; chat mirrors the inverse
       move and both stay clamped so neither leaves the active 20% zone NOR
       overlaps the other (keep ≥12px between them) */
    const lo = Math.max(d.camY0 + (d.zoneTop - d.camTop), d.chatTop + d.camY0 + d.chatH - d.zoneBottom);
    let hi = Math.min(d.camY0 + (d.zoneBottom - d.camTop - d.camH), d.chatTop + d.camY0 - d.zoneTop);
    const gapStart = d.chatTop - (d.camTop + d.camH);
    hi = Math.min(hi, d.camY0 + (gapStart - 12) / 2);
    const newY = Math.min(hi, Math.max(lo, d.camY0 + dy));
    camYRef.current = newY;
    if (camEl) { camEl.style.transition = "none"; camEl.style.transform = `translateY(${newY}px)`; }
    if (chatEl) { chatEl.style.transition = "none"; chatEl.style.transform = `translateY(${-newY}px)`; }
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

  return (
    <main ref={pageRef} className={`room-page ${sidebarOpen ? "" : "chat-closed"}`}>
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
              />
            </div>

            {!movieStarted && (
              <div className="scene-topbar">
                <span className="eyebrow">TONIGHT'S MOVIE</span>
                <h2 className="scene-title">My Movie</h2>
                {editingMovie && (
                  <input
                    className="link-input"
                    value={newLink}
                    onChange={(e) => setNewLink(e.target.value)}
                    placeholder="https://example.com/movie.mp4"
                    onKeyDown={(e) => { if (e.key === "Enter") saveMovieLink(); }}
                    autoFocus
                  />
                )}
                <div className="meta-actions">
                  {role === "host" && !editingMovie && (
                    <>
                      <button
                        className="ghost compact"
                        onClick={() => { setNewLink(movieUrl === MOVIE_SRC ? "" : movieUrl); setEditingMovie(true); }}
                      >
                        Link
                      </button>
                      <button className="primary compact" onClick={startMovie}>Start Movie</button>
                    </>
                  )}
                  {role === "host" && editingMovie && (
                    <>
                      <button className="primary compact" onClick={saveMovieLink}>Save</button>
                      <button className="ghost compact" onClick={() => setEditingMovie(false)}>Cancel</button>
                    </>
                  )}
                </div>
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
            {floatingReaction && <div className="reaction-float" key={floatingReaction.id}>{floatingReaction.reaction}</div>}
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
                <span className="eyebrow">PRIVATE ROOM</span>
                <strong>{roomState?.count || 1}/2 participants</strong>
                <small>{roomState?.count === 2 ? "Room is ready" : "Waiting for your friend..."}</small>
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
              <button
                className={`chat-icon-btn ${chatOpen ? "hidden" : ""}`}
                onClick={() => setChatOpen(true)}
                title="Toggle chat"
                aria-label="Toggle chat"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
                {unreadMsgs > 0 && <span className="msg-badge">{unreadMsgs > 9 ? "9+" : unreadMsgs}</span>}
              </button>

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

      {introOverlay && (
        <div className="intro-overlay">
          <div className="intro-message">
            For the next two hours, it&rsquo;s just you, me, and our little world.{" "}
            <span className="intro-heart">❤️🎬</span>
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

      {isSalmaMode && (introStep === "intro" || introStep === "capsule") && (
        <div className="cf-intro">
          <div className="cf-cine-grain" />
          <div className="cf-particles">
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className="cf-particle"
                style={{
                  left: `${(i * 13 + 6) % 92}%`,
                  top: `${28 + ((i * 17) % 46)}%`,
                  animationDuration: `${5 + (i % 3) * 2}s`,
                  animationDelay: `${i * 0.9}s`
                }}
              />
            ))}
          </div>
          <div className="cf-intro-core">
            {introStep === "intro" && (
              <>
                <p className="cf-line" style={{ "--d": "0.3s" }}>Before we travel through time…</p>
                <p className="cf-line" style={{ "--d": "3.8s" }}>I wanted to leave something here for you.</p>
                <p className="cf-line" style={{ "--d": "7.6s" }}>Tonight isn't just about the movie.</p>
                <button className="cf-intro-btn" style={{ "--d": "11.4s" }} onClick={openSurprise}>Open your surprise ❤️</button>
              </>
            )}
            {introStep === "capsule" && (
              <>
                <p className="cf-line" style={{ "--d": "0.3s" }}>Some moments become memories.</p>
                <p className="cf-line" style={{ "--d": "3.8s" }}>Some memories become forever.</p>
                <p className="cf-message" style={{ "--d": "7.6s" }}>
                  salma mahma tbdlt layem o wa9t, fma hajet nhebhom yab9ou nafshom, nhebek barcha doctourtyy 🥹🥹❤️
                </p>
                <button className="cf-intro-btn" style={{ "--d": "12.4s" }} onClick={startMovieFromCapsule}>Start Movie</button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

export default App;