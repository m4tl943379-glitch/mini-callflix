import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import MoviePlayer from "./MoviePlayer";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const MOVIE_SRC = "/movie/movie.mp4";
const socket = io(SERVER_URL, { autoConnect: true });

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

  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const localStream = useRef(null);
  const peer = useRef(null);
  const pendingCandidates = useRef([]);
  const playerRef = useRef(null);

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
      if (peer.current) {
        peer.current.close();
        peer.current = null;
      }
    };

    const onMovieUrl = ({ movieUrl }) => {
      setMovieUrl(movieUrl || MOVIE_SRC);
    };

    const onExpired = () => {
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      peer.current?.close();
      peer.current = null;
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
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peer.current = pc;

    stream?.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("webrtc:ice", { roomId, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState)) {
        setNotice("Video connection lost. Trying to reconnect...");
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
    localStream.current?.getTracks().forEach((t) => t.stop());
    localStream.current = null;
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
    <main className="room-page">
      <header className="topbar">
        <div className="brand small">CALL<span>FLIX</span></div>
        <div className="room-pill">ROOM <strong>{roomId}</strong></div>
        <button className="leave" onClick={leaveRoom}>Leave Room</button>
      </header>

      <div className="workspace">
        <section className="watch-area">
          <div className="movie-card">
            <MoviePlayer
              ref={playerRef}
              url={movieUrl}
              role={role}
              playback={playback}
              onPlayback={handlePlayerPlayback}
            />
            <div className="movie-meta">
              <div>
                <span className="eyebrow">TONIGHT'S MOVIE</span>
                <h2>My Movie</h2>
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
              </div>
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
          </div>

          <div className="camera-grid">
            <div className={`camera-card ${!media.cameraEnabled ? "off" : ""}`}>
              {media.cameraEnabled ? <video ref={localVideo} autoPlay muted playsInline /> : <div className="avatar">YOU</div>}
              <span>{name || "You"} · {media.micEnabled ? "Mic on" : "Muted"}</span>
            </div>
            <div className="camera-card">
              <video ref={remoteVideo} autoPlay playsInline />
              <span>{role === "host" ? roomState?.guest?.name || "Waiting..." : roomState?.host?.name || "Host"}</span>
            </div>
          </div>

          <div className="controls">
            <button onClick={toggleCamera}>{media.cameraEnabled ? "🎥 Camera ON" : "🚫 Camera OFF"}</button>
            <button onClick={toggleMic}>{media.micEnabled ? "🎤 Mic ON" : "🔇 Mic OFF"}</button>
            <div className="reactions">
              {reactions.map((r) => <button key={r} onClick={() => sendReaction(r)}>{r}</button>)}
            </div>
          </div>

          {floatingReaction && <div className="reaction-float" key={floatingReaction.id}>{floatingReaction.reaction}</div>}
        </section>

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
      </div>
    </main>
  );
}

export default App;