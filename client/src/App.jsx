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
const MOVIE_SRC = `${SERVER_URL}/movie/movie.mp4`;
const socket = io(SERVER_URL, { autoConnect: true });

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:openrelay.metered.ca:80"] },
  { urls: ["turn:openrelay.metered.ca:80?transport=udp", "turn:openrelay.metered.ca:80?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
];
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [introOverlay, setIntroOverlay] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
  const feelToastTimer = useRef(null);
  const feelCloseTimer = useRef(null);
  const feelSentTimer = useRef(null);
  const hasLeftRef = useRef(false);
  const partnerLeftHandledRef = useRef(false);
  const isCleaningUpRef = useRef(false);

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const localStream = useRef(null);
  const peer = useRef(null);
  const pendingCandidates = useRef([]);
  const playerRef = useRef(null);
  const pageRef = useRef(null);
  const stageRef = useRef(null);
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

    const onChat = (item) => setMessages((prev) => [...prev, item]);

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
      setMessages([]);
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
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("webrtc:ice", { roomId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "connected") {
        setIceInfo("Connected");
        setTimeout(() => refreshIceInfo(pc), 500);
        if (connectionLost.current) {
          connectionLost.current = false;
          setNotice("Video reconnected.");
        }
        return;
      }
      if (s === "connecting") setIceInfo("Connecting...");
      if (s === "failed" || s === "disconnected") {
        setIceInfo("Retrying...");
        connectionLost.current = true;
        setNotice("Video connection lost. Trying to reconnect...");
        if (role !== "host") return;
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(tryRenegotiate, 1200);
      }
      if (s === "closed") setIceInfo("");
    };

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

function startMovie() {
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
  }

  function closePeerConnection() {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    remoteStreamRef.current = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    clearTimeout(reconnectTimer.current);
    connectionLost.current = false;
  }

  function resetRoomUi() {
    setPlayback(null);
    setMessages([]);
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
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (localStream.current && localVideo.current) localVideo.current.srcObject = localStream.current;
    if (remoteStreamRef.current && remoteVideo.current) remoteVideo.current.srcObject = remoteStreamRef.current;
  }, [view, roomId, role, media.cameraEnabled]);

  async function tryRenegotiate() {
    const pc = peer.current;
    if (!pc || pc.connectionState === "connected") return;
    if (Date.now() - lastRestart.current < 3000) return;
    lastRestart.current = Date.now();
    try {
      pc.restartIce?.();
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:offer", { roomId, offer });
    } catch {}
  }

  async function refreshIceInfo(pc) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && !pair) pair = r;
      });
      if (pair) {
        const remote = stats.get(pair.remoteCandidateId);
        const type = remote?.candidateType || remote?.type;
        setIceInfo(type === "relay" ? "Relay (TURN)" : "Direct (P2P)");
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
              <span className={`ice-dot ${/Retrying|Connecting|Waiting/.test(iceInfo) ? "waiting" : "good"}`} />
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
          </button>
          <button className="leave" onClick={soloMode ? backToHome : leaveRoom}>
            {soloMode ? "Exit" : "Leave"}
          </button>
        </div>
      </header>

      <div className="workspace">
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

            <div className="control-bar">
              {!soloMode && (
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
              <div className="cameras">
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
              </button>

              <div className={`chat-panel ${chatOpen ? "open" : "closed"}`}>
                <div className="chat">
                    <div className="chat-title-row">
                      <div className="chat-title">Chat</div>
                      <button className="chat-close" onClick={() => setChatOpen(false)} title="Collapse chat">✕</button>
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