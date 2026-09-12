import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

const DRIFT_SEEK_MS = 1000;        // reseek only when |drift| above this
const DRIFT_HEARTBEAT_MS = 1500;
const HEARTBEAT_MS = 8000;

function parseYouTubeId(url) {
  const m = String(url || "").match(
    /(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|v\/))([\w-]{11})/
  );
  return m ? m[1] : null;
}

function loadYouTubeApi() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    if (document.getElementById("cf-youtube-api")) return;
    const script = document.createElement("script");
    script.id = "cf-youtube-api";
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

const MoviePlayer = forwardRef(function MoviePlayer(
  { url, playback, onPlayback, onToggleFullscreen, io, selfId, roomId },
  ref
) {
  const youtubeId = parseYouTubeId(url);

  const ytContainerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const videoRef = useRef(null);
  const mirrorRef = useRef(false);     // while true, don't re-emit player events
  const appliedInitialRef = useRef(false);
  const initialRef = useRef(playback || null);
  const playingRef = useRef(false);
  const volumeRef = useRef(100);
  const seekTimer = useRef(null);
  const clickTimer = useRef(null);

  const [ytReady, setYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const [prog, setProg] = useState({ cur: 0, dur: 0 });
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const getCur = () =>
    (youtubeId && ytPlayerRef.current)
      ? (ytPlayerRef.current.getCurrentTime?.() || 0)
      : (videoRef.current?.currentTime || 0);

  const getDur = () =>
    (youtubeId && ytPlayerRef.current)
      ? (ytPlayerRef.current.getDuration?.() || 0)
      : (videoRef.current?.duration || 0);

  const doPlay = useCallback(() => {
    if (youtubeId) ytPlayerRef.current?.playVideo?.();
    else videoRef.current?.play?.().catch(() => {});
  }, [youtubeId]);

  const doPause = useCallback(() => {
    if (youtubeId) ytPlayerRef.current?.pauseVideo?.();
    else videoRef.current?.pause?.();
  }, [youtubeId]);

  const doSeek = useCallback((t) => {
    if (youtubeId) ytPlayerRef.current?.seekTo?.(t, true);
    else { const v = videoRef.current; if (v) v.currentTime = t; }
  }, [youtubeId]);

  const emitAction = useCallback((type, time) => {
    if (!io || !roomId) return;
    io.emit("film:action", { roomId, type, currentTime: Number(time) || 0, timestamp: Date.now() });
  }, [io, roomId]);

  /* Apply an action received from the peer. Never re-emit while doing so.
     Only reseek when the drift is meaningful to avoid stutter on tiny gaps. */
  const applyRemote = useCallback((type, time) => {
    const t = Number(time);
    if (!Number.isFinite(t) || t < 0) return;
    mirrorRef.current = true;
    try {
      if (type === "seek") {
        doSeek(t);
      } else {
        if (Math.abs(getCur() - t) > DRIFT_SEEK_MS / 1000) doSeek(t);
        if (type === "play") doPlay();
        else doPause();
      }
    } finally {
      setTimeout(() => { mirrorRef.current = false; }, 1000);
    }
  }, [youtubeId, doPlay, doPause, doSeek]);

  /* Periodic correction: re-converge on time, and on play state. */
  const recalcSync = useCallback((remoteTime, remotePlaying) => {
    if (!Number.isFinite(Number(remoteTime))) return;
    mirrorRef.current = true;
    try {
      if (Math.abs(getCur() - Number(remoteTime)) > DRIFT_HEARTBEAT_MS / 1000) doSeek(Number(remoteTime));
      if (remotePlaying && !playingRef.current) doPlay();
      else if (!remotePlaying && playingRef.current) doPause();
    } finally {
      setTimeout(() => { mirrorRef.current = false; }, 1000);
    }
  }, [youtubeId, doPlay, doPause, doSeek]);

  useEffect(() => {
    if (!io) return;
    const onAction = ({ type, currentTime, from }) => {
      if (from && selfId && from === selfId) return;
      applyRemote(type, currentTime);
    };
    const onSync = ({ currentTime, playing: remotePlaying, from }) => {
      if (from && selfId && from === selfId) return;
      recalcSync(currentTime, remotePlaying);
    };
    io.on("film:action", onAction);
    io.on("film:sync", onSync);
    return () => {
      io.off("film:action", onAction);
      io.off("film:sync", onSync);
    };
  }, [io, selfId, applyRemote, recalcSync]);

  /* Startup position: for a late joiner, jump right into the stored state once. */
  const applyInitial = useCallback(() => {
    const st = initialRef.current;
    if (!st || appliedInitialRef.current) return;
    appliedInitialRef.current = true;
    mirrorRef.current = true;
    try {
      const t = Math.max(0, Number(st.time) || 0);
      if (t > 0) doSeek(t);
      if (st.playing) doPlay();
      else doPause();
    } finally {
      setTimeout(() => { mirrorRef.current = false; }, 1000);
    }
  }, [doPlay, doPause, doSeek]);

  useImperativeHandle(ref, () => ({
    play: doPlay,
    pause: doPause,
    currentTime: getCur
  }), [doPlay, doPause, youtubeId]);

  useEffect(() => {
    if (!youtubeId) return;
    let cancelled = false;
    setYtError(false);
    setYtReady(false);
    loadYouTubeApi().then(() => {
      if (cancelled || !ytContainerRef.current) return;
      ytContainerRef.current.innerHTML = "";
      const player = new window.YT.Player(ytContainerRef.current, {
        videoId: youtubeId,
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          fs: 0,
          playsinline: 1
        },
        events: {
          onReady: () => {
            ytPlayerRef.current = player;
            try { player.setVolume(volumeRef.current); } catch {}
            setYtReady(true);
            setYtError(false);
            applyInitial();
          },
          onStateChange: (event) => {
            const st = event.data;
            if (st === window.YT.PlayerState.PLAYING) {
              setPlaying(true);
              onPlayback?.(true, getCur());
              if (!mirrorRef.current) emitAction("play", getCur());
            } else if (st === window.YT.PlayerState.PAUSED) {
              setPlaying(false);
              onPlayback?.(false, getCur());
              if (!mirrorRef.current) emitAction("pause", getCur());
            } else if (st === window.YT.PlayerState.ENDED) {
              setPlaying(false);
              onPlayback?.(false, getCur());
            }
          },
          onError: () => {
            setYtError(true);
            setYtReady(false);
          }
        }
      });
    });
    return () => { cancelled = true; ytPlayerRef.current = null; setYtReady(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId, reloadKey]);

  useEffect(() => {
    const iv = setInterval(() => {
      const c = getCur();
      const d = getDur();
      setProg((p) =>
        (Math.abs(p.cur - c) > 0.25 || Math.abs(p.dur - d) > 0.25)
          ? { cur: c, dur: d }
          : p
      );
    }, 350);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId, ytReady]);

  useEffect(() => {
    if (!io || !roomId || !youtubeId) return;
    const iv = setInterval(() => {
      if (!ytReady) return;
      io.emit("film:sync", {
        roomId,
        currentTime: getCur(),
        playing: playingRef.current,
        timestamp: Date.now()
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io, roomId, youtubeId, ytReady]);

  useEffect(() => {
    const el = videoRef.current;
    if (el && !youtubeId) {
      el.volume = volume / 100;
      el.muted = muted;
    }
  }, [youtubeId, volume, muted]);

  function togglePlay() {
    if (playingRef.current) doPause();
    else doPlay();
  }

  function seekBy(delta) {
    const dur = getDur();
    const next = Math.min(Math.max(0, getCur() + delta), dur > 0 ? dur : Infinity);
    doSeek(next);
    emitAction("seek", next);
  }

  function onSeekInput(value) {
    const t = Number(value);
    setProg((p) => ({ ...p, cur: t }));
    doSeek(t);
    emitAction("seek", t);
    clearTimeout(seekTimer.current);
  }

  function onVolumeChange(value) {
    const v = Math.max(0, Math.min(100, Number(value)));
    setVolume(v);
    volumeRef.current = v;
    if (youtubeId) ytPlayerRef.current?.setVolume?.(v);
    else { const el = videoRef.current; if (el) el.volume = v / 100; }
    if (v > 0 && muted) setMuted(false);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (youtubeId) {
      if (next) ytPlayerRef.current?.mute?.();
      else ytPlayerRef.current?.unMute?.();
    } else {
      const el = videoRef.current;
      if (el) el.muted = next;
    }
  }

  function onStageClick(e) {
    if (e.detail === 2) {
      clearTimeout(clickTimer.current);
      onToggleFullscreen?.();
      return;
    }
    if (e.detail === 1) {
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => togglePlay(), 220);
    }
  }

  function reloadVideo() {
    if (!youtubeId) return;
    setPlaying(false);
    setReloadKey((k) => k + 1);
  }

  const mediaReady = youtubeId ? ytReady : true;
  const seekable = prog.dur > 0;

  return (
    <>
      {youtubeId ? (
        <div
          key={reloadKey}
          className="movie cf-movie"
          ref={ytContainerRef}
          onClick={onStageClick}
        />
      ) : (
        <video
          ref={videoRef}
          className="movie cf-movie"
          style={{ aspectRatio: videoRatio }}
          src={url}
          playsInline
          onClick={onStageClick}
          onLoadedMetadata={(e) => {
            const v = e.target;
            if (v.videoWidth && v.videoHeight) setVideoRatio(v.videoWidth / v.videoHeight);
            applyInitial();
          }}
          onPlay={() => {
            setPlaying(true);
            onPlayback?.(true, videoRef.current?.currentTime || 0);
            if (!mirrorRef.current) emitAction("play", videoRef.current?.currentTime || 0);
          }}
          onPause={() => {
            setPlaying(false);
            onPlayback?.(false, videoRef.current?.currentTime || 0);
            if (!mirrorRef.current) emitAction("pause", videoRef.current?.currentTime || 0);
          }}
          onEnded={() => {
            setPlaying(false);
            onPlayback?.(false, videoRef.current?.currentTime || 0);
          }}
        />
      )}

      <div className="cf-controls">
        {ytError && (
          <div className="cf-error">
            <div className="cf-error-icon">⛔</div>
            <p>This video can&apos;t be played in CALLFLIX.</p>
            <small>The uploader has disabled embedding. Try another link.</small>
          </div>
        )}

        {!playing && !ytError && mediaReady && (
          <button className="cf-play-big" onClick={togglePlay} title="Play">
            <span>▶</span>
          </button>
        )}

        <div className="cf-player-bar">
          <input
            type="range"
            className="cf-range"
            min={0}
            max={prog.dur || 1}
            step={0.1}
            value={Math.min(prog.cur, prog.dur || prog.cur)}
            onChange={(e) => onSeekInput(e.target.value)}
            disabled={!seekable}
            aria-label="Seek"
          />
          <div className="cf-bar-row">
            <button className="cf-btn" onClick={togglePlay} title={playing ? "Pause" : "Play"}>
              {playing ? "⏸" : "▶"}
            </button>
            <button className="cf-btn cf-step" onClick={() => seekBy(-10)} title="Back 10 seconds">−10</button>
            <button className="cf-btn cf-step" onClick={() => seekBy(10)} title="Forward 10 seconds">+10</button>
            <span className="cf-time">{fmt(prog.cur)} / {fmt(prog.dur)}</span>
            <span className="cf-spacer" />
            <button className="cf-btn" onClick={toggleMute} title="Mute / unmute">
              {muted || volume === 0 ? "🔇" : "🔊"}
            </button>
            <input
              type="range"
              className="cf-range cf-volume"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(e.target.value)}
              title="Volume"
              aria-label="Volume"
            />
            <button
              className="cf-btn"
              onClick={reloadVideo}
              title="Reload video (fixes a frozen black frame)"
            >⟳</button>
            <button className="cf-btn" onClick={onToggleFullscreen} title="Fullscreen">⛶</button>
          </div>
        </div>
      </div>
    </>
  );
});

export default MoviePlayer;