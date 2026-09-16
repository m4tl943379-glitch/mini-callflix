import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

const DRIFT_SEEK_MS = 1000;        // reseek only when |drift| above this
const DRIFT_HEARTBEAT_MS = 1500;
const HEARTBEAT_MS = 8000;
const AUTO_HIDE_MS = 2600;
const SEEK_EMIT_THROTTLE_MS = 150;

/* ── cinematic SVG icon set ── */
function IconPlay({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 4.5v15a1 1 0 0 0 1.55.84l12-7.5a1 1 0 0 0 0-1.68l-12-7.5A1 1 0 0 0 6 4.5z" />
    </svg>
  );
}
function IconPause({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}
function IconVol({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" fill="currentColor" stroke="none" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a9 9 0 0 1 0 12" />
    </svg>
  );
}
function IconMute({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z" fill="currentColor" stroke="none" />
      <path d="M17 9l6 6M23 9l-6 6" />
    </svg>
  );
}
function IconReload({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
function IconFullscreen({ w = 18, h = 18 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}
function IconExclaim({ w = 24, h = 24 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 1 21h22L12 2zm0 6c.55 0 1 .45.95 1l-.6 6a.85.85 0 0 1-1.7 0l-.6-6A.95.95 0 0 1 12 8zm0 11.5a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z" />
    </svg>
  );
}

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
  { url, playback, onPlayback, onToggleFullscreen, io, selfId, roomId, solo = false, started = false },
  ref
) {
  const youtubeId = parseYouTubeId(url);

  const ytContainerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const videoRef = useRef(null);
  const mirrorRef = useRef(false);     // while true, don't re-emit player events
  const lastSeenTsRef = useRef(0);     // newest peer timestamp applied (staleness guard)
  const seekThrottleRef = useRef({ timer: null, value: null });
  const appliedInitialRef = useRef(false);
  const initialRef = useRef(playback || null);
  const startedRef = useRef(started);
  const playingRef = useRef(false);
  const volumeRef = useRef(100);
  const soloRef = useRef(solo);
  const clickTimer = useRef(null);
  const hideTimerRef = useRef(null);

  const [ytReady, setYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [videoRatio, setVideoRatio] = useState(16 / 9);
  const [prog, setProg] = useState({ cur: 0, dur: 0 });
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { soloRef.current = solo; }, [solo]);
  useEffect(() => { startedRef.current = started; }, [started]);

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
    if (!io || !roomId || soloRef.current) return;
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
    const onAction = ({ type, currentTime, from, timestamp }) => {
      if (soloRef.current) return;
      if (from && selfId && from === selfId) return;
      const ts = Number(timestamp);
      if (Number.isFinite(ts) && ts > 0) {
        if (ts < lastSeenTsRef.current) return;
        lastSeenTsRef.current = ts;
      }
      applyRemote(type, currentTime);
    };
    const onSync = ({ currentTime, playing: remotePlaying, from, timestamp }) => {
      if (soloRef.current) return;
      if (from && selfId && from === selfId) return;
      const ts = Number(timestamp);
      if (Number.isFinite(ts) && ts > 0) {
        if (ts < lastSeenTsRef.current) return;
        lastSeenTsRef.current = ts;
      }
      recalcSync(currentTime, remotePlaying);
    };
    io.on("film:action", onAction);
    io.on("film:sync", onSync);
    return () => {
      io.off("film:action", onAction);
      io.off("film:sync", onSync);
    };
  }, [io, selfId, applyRemote, recalcSync]);

  /* Startup position: for a late joiner, jump right into the stored state once.
     Never let a stale pre-start snapshot PAUSE playback that movie:start already
     kicked off: once the movie has been started, the initial resume always plays. */
  const applyInitial = useCallback(() => {
    const st = initialRef.current;
    if (!st || appliedInitialRef.current || soloRef.current) return;
    appliedInitialRef.current = true;
    mirrorRef.current = true;
    try {
      const t = Math.max(0, Number(st.time) || 0);
      if (t > 0) doSeek(t);
      if (st.playing || startedRef.current) doPlay();
      else doPause();
    } finally {
      setTimeout(() => { mirrorRef.current = false; }, 1000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              if (!mirrorRef.current) emitAction("pause", getCur());
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
    if (!io || !roomId || solo) return;
    const iv = setInterval(() => {
      const ready = youtubeId
        ? ytReady
        : Boolean(videoRef.current && Number.isFinite(videoRef.current.duration) && videoRef.current.duration > 0);
      if (!ready) return;
      io.emit("film:sync", {
        roomId,
        currentTime: getCur(),
        playing: playingRef.current,
        timestamp: Date.now()
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io, roomId, youtubeId, ytReady, solo]);

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

  /* ── cinematic auto-hide: show on any interaction, hide after idle while playing ── */
  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    if (playingRef.current) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS);
    }
  }, []);

  /* Keep controls when paused; when playing resumes, restart the auto-hide timer. */
  useEffect(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    if (playingRef.current) {
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS);
    }
    return () => clearTimeout(hideTimerRef.current);
  }, [playing]);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  /* Any pointer activity anywhere over the scene (movie, player bar AND the
     floating Camera/Mic/Reactions toolbar) shares the SAME visibility state,
     so the two layers never desync. */
  useEffect(() => {
    const onPointerActivity = (e) => {
      if (e.target && e.target.closest && e.target.closest(".movie-scene")) showControls();
    };
    document.addEventListener("pointermove", onPointerActivity, true);
    document.addEventListener("pointerdown", onPointerActivity, true);
    return () => {
      document.removeEventListener("pointermove", onPointerActivity, true);
      document.removeEventListener("pointerdown", onPointerActivity, true);
    };
  }, [showControls]);

  function onSeekInput(value) {
    const t = Number(value);
    setProg((p) => ({ ...p, cur: t }));
    doSeek(t);
    const th = seekThrottleRef.current;
    if (th.timer) {
      th.value = t;
      return;
    }
    emitAction("seek", t);
    th.timer = setTimeout(() => {
      th.timer = null;
      const v = th.value;
      th.value = null;
      if (v !== null) emitAction("seek", v);
    }, SEEK_EMIT_THROTTLE_MS);
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
          onPointerMove={showControls}
          onPointerDown={showControls}
        />
      ) : (
        <video
          ref={videoRef}
          className="movie cf-movie"
          style={{ aspectRatio: videoRatio }}
          src={url}
          playsInline
          onClick={onStageClick}
          onPointerMove={showControls}
          onPointerDown={showControls}
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
            if (!mirrorRef.current) emitAction("pause", videoRef.current?.currentTime || 0);
          }}
        />
      )}

      <div className={`cf-controls${controlsVisible ? "" : " hidden"}`} onPointerMove={showControls} onPointerDown={showControls}>
        {ytError && (
          <div className="cf-error">
            <div className="cf-error-icon"><IconExclaim /></div>
            <p>This video can&apos;t be played in CALLFLIX.</p>
            <small>The uploader has disabled embedding. Try another link.</small>
          </div>
        )}

        {!playing && !ytError && mediaReady && (
          <button className="cf-play-big" onClick={togglePlay} title="Play" aria-label="Play">
            <IconPlay w={26} h={26} />
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
            <button className="cf-btn" onClick={togglePlay} title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button className="cf-btn cf-step" onClick={() => seekBy(-10)} title="Back 10 seconds" aria-label="Back 10 seconds">−10</button>
            <button className="cf-btn cf-step" onClick={() => seekBy(10)} title="Forward 10 seconds" aria-label="Forward 10 seconds">+10</button>
            <span className="cf-time">{fmt(prog.cur)} / {fmt(prog.dur)}</span>
            <span className="cf-spacer" />
            <button className="cf-btn" onClick={toggleMute} title="Mute / unmute" aria-label="Mute or unmute">
              {muted || volume === 0 ? <IconMute /> : <IconVol />}
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
              aria-label="Reload video"
            ><IconReload /></button>
            <button className="cf-btn" onClick={onToggleFullscreen} title="Fullscreen" aria-label="Toggle fullscreen"><IconFullscreen /></button>
          </div>
        </div>
      </div>
    </>
  );
});

export default MoviePlayer;