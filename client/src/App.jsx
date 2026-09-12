import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import MoviePlayer from "./MoviePlayer";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const MOVIE_SRC = "/movie/movie.mp4";
const socket = io(SERVER_URL, { autoConnect: true });

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:openrelay.metered.ca:80"] },
  { urls: ["turn:openrelay.metered.ca:80?transport=udp", "turn:openrelay.metered.ca:80?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: ["turn:freeturn.net:3478?transport=udp", "turn:freeturn.net:3478?transport=tcp"], username: "free", credential: "free" },
  { urls: "turns:freeturn.tel:5349", username: "free", credential: "free" }
];
const CUSTOM_TURN_URLS = (import.meta.env.VITE_TURN_URLS || "").split(",").filter(Boolean);
if (CUSTOM_TURN_URLS.length) {
  ICE_SERVERS.push({
    urls: CUSTOM_TURN_URLS,
    username: import.meta.env.VITE_TURN_USERNAME || "",
    credential: import.meta.env.VITE_TURN_CREDENTIAL || ""
  });
}

const reactions = ["❤️", "😂", "😱", "🔥"];

function App() {
  const [view, setView] = useState("home");
  const [name, setName] = useState("");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [role, setRole] = useState("");
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const localStream = useRef(null);
  const peer = useRef(null);
  const pendingCandidates = useRef([]);
  const playerRef = useRef(null);
  const stageRef = useRef(null);
  const chromeTimer = useRef(null);
  const remoteStreamRef = useRef(null);
  const reconnectTimer = useRef(null);
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

    const onPlayback = (state) => {
      setPlayback(state);
    };

    const onChat = (item) => setMessages((prev) => [...prev, item]);

    const onReaction = ({ reaction, id }) => {
      setFloatingReaction({ reaction, id });
      setTimeout(() => setFloatingReaction(null), 1200);
    };

    const onLeft = ({ name, state }) => {
      setRoomState(state);
      setNotice(`${name} has left the room.`);
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      remoteStreamRef.current = null;
      if (peer.current) {
        peer.current.close();
        peer.current = null;
      }
      clearTimeout(reconnectTimer.current);
      connectionLost.current = false;
    };

    const onMovieUrl = ({ movieUrl }) => {
      setMovieUrl(movieUrl || MOVIE_SRC);
    };

    const onExpired = () => {
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      remoteStreamRef.current = null;
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
      setView("home");
      window.history.replaceState({}, "", "/");
    };

    socket.on("room:participant-joined", onJoined);
    socket.on("webrtc:offer", onOffer);
    socket.on("webrtc:answer", onAnswer);
    socket.on("webrtc:ice", onIce);
    socket.on("media:state", onMedia);
    socket.on("playback:state", onPlayback);
    socket.on("movie:url", onMovieUrl);
    socket.on("room:expired", onExpired);
    socket.on("chat:message", onChat);
    socket.on("reaction:show", onReaction);
    socket.on("room:participant-left", onLeft);

    return () => {
      socket.off("room:participant-joined", onJoined);
      socket.off("webrtc:offer", onOffer);
      socket.off("webrtc:answer", onAnswer);
      socket.off("webrtc:ice", onIce);
      socket.off("media:state", onMedia);
      socket.off("playback:state", onPlayback);
      socket.off("movie:url", onMovieUrl);
      socket.off("room:expired", onExpired);
      socket.off("chat:message", onChat);
      socket.off("reaction:show", onReaction);
      socket.off("room:participant-left", onLeft);
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
    const pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
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
        if (connectionLost.current) {
          connectionLost.current = false;
          setNotice("Video reconnected.");
        }
        return;
      }
      if (s === "failed" || s === "disconnected") {
        connectionLost.current = true;
        setNotice("Video connection lost. Trying to reconnect...");
        if (role !== "host") return;
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(tryRenegotiate, 1200);
      }
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

  function sendPlayback(playing, time) {
    if (role !== "host") return;
    socket.emit("playback:state", { roomId, playing, time });
  }

  const handlePlayerPlayback = useCallback(
    (playing, time) => sendPlayback(playing, time),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, roomId]
  );

  function startMovie() {
    playerRef.current?.play();
  }

  function saveMovieLink() {
    setMovieUrl(newLink.trim());
    setEditingMovie(false);
    socket.emit("movie:set", { roomId, movieUrl: newLink.trim() });
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice("Invitation link copied.");
    } catch {
      setNotice(inviteLink);
    }
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

  function leaveRoom() {
    socket.emit("room:leave");
    clearTimeout(reconnectTimer.current);
    connectionLost.current = false;
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
    remoteStreamRef.current = null;
    peer.current?.close();
    peer.current = null;
    setRoomId("");
    setRoomState(null);
    setPlayback(null);
    setMessages([]);
    setLinkInput("");
    setEditingMovie(false);
    setView("home");
    window.history.replaceState({}, "", "/");
  }

  function bumpChrome() {
    setChromeVisible(true);
    clearTimeout(chromeTimer.current);
    const focused = document.activeElement && document.activeElement.tagName === "INPUT";
    if (focused || editingMovie) return;
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

  function toggleFullscreen() {
    const el = stageRef.current;
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
          <div className="brand">CALL<span>FLIX</span></div>
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
          <div className="brand small">CALL<span>FLIX</span></div>
          <h2>{joining ? "Join CALLFLIX" : "Create your room"}</h2>
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

  return (
    <main className={`room-page ${sidebarOpen ? "" : "chat-closed"}`}>
      <header className="topbar">
        <div className="brand small">CALL<span>FLIX</span></div>
        <div className="room-pill">ROOM <strong>{roomId}</strong></div>
        <div className="topbar-actions">
          <button
            className={`chat-toggle ${sidebarOpen ? "active" : ""}`}
            onClick={() => setSidebarOpen((o) => !o)}
            title="Toggle chat panel"
          >
            💬 <span>Chat</span>
          </button>
          <button className="leave" onClick={leaveRoom}>Leave</button>
        </div>
      </header>

      <div className="workspace">
        <section className="watch-stage">
          <div ref={stageRef} className={`movie-scene ${chromeVisible ? "" : "chrome-hidden"}`}>
            <div className="movie-surface">
              <MoviePlayer
                ref={playerRef}
                url={movieUrl}
                role={role}
                playback={playback}
                onPlayback={handlePlayerPlayback}
              />
            </div>

            <div className="cameras">
              <div className={`cam-chip self ${media.cameraEnabled ? "" : "cam-off"}`}>
                {media.cameraEnabled ? (
                  <video ref={localVideo} autoPlay muted playsInline />
                ) : (
                  <div className="cam-placeholder">YOU</div>
                )}
                <span className="cam-name">{name || "You"} · {media.micEnabled ? "Mic on" : "Muted"}</span>
                <div className="cam-actions">
                  <button title="Toggle camera" onClick={toggleCamera}>{media.cameraEnabled ? "🎥" : "🚫"}</button>
                  <button title="Toggle microphone" onClick={toggleMic}>{media.micEnabled ? "🎤" : "🔇"}</button>
                </div>
              </div>

              <div className="cam-chip remote">
                <video ref={remoteVideo} autoPlay playsInline />
                <span className="cam-name">
                  {role === "host" ? roomState?.guest?.name || "Waiting..." : roomState?.host?.name || "Host"}
                </span>
              </div>
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
              <button onClick={toggleCamera} title="Toggle camera">{media.cameraEnabled ? "🎥" : "🚫"}</button>
              <button onClick={toggleMic} title="Toggle microphone">{media.micEnabled ? "🎤" : "🔇"}</button>
              <span className="bar-sep" />
              <div className="reactions">
                {reactions.map((r) => <button key={r} onClick={() => sendReaction(r)} title={`Send ${r}`}>{r}</button>)}
              </div>
              <button onClick={toggleFullscreen} title="Fullscreen">{isFullscreen ? "⤢" : "⛶"}</button>
            </div>

            {floatingReaction && <div className="reaction-float" key={floatingReaction.id}>{floatingReaction.reaction}</div>}
          </div>
        </section>

        {sidebarOpen && (
          <aside className="sidebar">
            <div className="invite-box">
              <div>
                <span className="eyebrow">PRIVATE ROOM</span>
                <strong>{roomState?.count || 1}/2 participants</strong>
              </div>
              <button onClick={copyInvite}>Copy invite link</button>
              {notice && <small>{notice}</small>}
            </div>

            <div className="status">
              <span className={`dot ${roomState?.count === 2 ? "online" : ""}`} />
              {roomState?.count === 2 ? "Both connected" : "Waiting for your friend..."}
            </div>

            <div className="chat">
              <div className="chat-title">Chat</div>
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
          </aside>
        )}
      </div>
    </main>
  );
}

export default App;