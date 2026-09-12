import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

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
  { url, role, playback, onPlayback, onToggleFullscreen },
  ref
) {
  const youtubeId = parseYouTubeId(url);

  const ytContainerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const videoRef = useRef(null);
  const suppressRef = useRef(false);
  const playbackRef = useRef(playback);
  const roleRef = useRef(role);
  const volumeRef = useRef(100);
  const seekTimer = useRef(null);
  const clickTimer = useRef(null);

  const [ytReady, setYtReady] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const [prog, setProg] = useState({ cur: 0, dur: 0 });
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => { playbackRef.current = playback; }, [playback]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const getCur = () =>
    youtubeId
      ? (ytPlayerRef.current?.getCurrentTime?.() || 0)
      : (videoRef.current?.currentTime || 0);

  const getDur = () =>
    youtubeId
      ? (ytPlayerRef.current?.getDuration?.() || 0)
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

  function sync(nowPlaying, time) {
    if (roleRef.current !== "host") return;
    onPlayback(nowPlaying, Math.max(0, Number(time) || 0));
  }

  function applyCurrentState() {
    if (roleRef.current !== "guest") return;
    const state = playbackRef.current;
    if (!state) return;
    const time = Math.max(0, Number(state.time) || 0);

    suppressRef.current = true;
    if (youtubeId) {
      const p = ytPlayerRef.current;
      if (p) {
        try { p.seekTo(time, true); } catch {}
        try { if (state.playing) p.playVideo(); else p.pauseVideo(); } catch {}
      }
    } else {
      const v = videoRef.current;
      if (v) {
        v.currentTime = time;
        if (state.playing) v.play().catch(() => {}); else v.pause();
      }
    }
    setTimeout(() => { suppressRef.current = false; }, 400);
  }

  useImperativeHandle(ref, () => ({
    play: doPlay,
    pause: doPause,
    currentTime: getCur,
    apply: applyCurrentState
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
          playsinline: 1,
          autoplay: 0
        },
        events: {
          onReady: () => {
            ytPlayerRef.current = player;
            try { player.setVolume(volumeRef.current); } catch {}
            setYtReady(true);
            setYtError(false);
            applyCurrentState();
          },
          onStateChange: (event) => {
            const st = event.data;
            if (st === window.YT.PlayerState.PLAYING) {
              setPlaying(true);
              if (!suppressRef.current && roleRef.current === "host") {
                sync(true, player.getCurrentTime() || 0);
              }
            } else if (st === window.YT.PlayerState.PAUSED) {
              setPlaying(false);
              if (!suppressRef.current && roleRef.current === "host") {
                sync(false, player.getCurrentTime() || 0);
              }
            } else if (st === window.YT.PlayerState.ENDED) {
              setPlaying(false);
              if (roleRef.current === "host") sync(false, player.getCurrentTime() || player.getDuration() || 0);
            }
          },
          onError: () => {
            setYtError(true);
            setYtReady(false);
          }
        }
      });
    });
    return () => {
      cancelled = true;
      ytPlayerRef.current = null;
      setYtReady(false);
    };
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
    const el = videoRef.current;
    if (el && !youtubeId) {
      el.volume = volume / 100;
      el.muted = muted;
    }
  }, [youtubeId, volume, muted]);

  useEffect(() => {
    applyCurrentState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  function togglePlay() {
    if (roleRef.current !== "host") return;
    if (playingRef.current) doPause();
    else doPlay();
  }

  function seekBy(delta) {
    if (roleRef.current !== "host") return;
    const dur = getDur();
    const next = Math.min(Math.max(0, getCur() + delta), dur > 0 ? dur : Infinity);
    doSeek(next);
    sync(playingRef.current, next);
  }

  function onSeekInput(value) {
    if (roleRef.current !== "host") return;
    const t = Number(value);
    setProg((p) => ({ ...p, cur: t }));
    doSeek(t);
    clearTimeout(seekTimer.current);
    seekTimer.current = setTimeout(() => sync(playingRef.current, t), 120);
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
    if (e.target.closest(".cf-player-bar, .cf-play-big")) return;
    if (e.detail === 2) {
      clearTimeout(clickTimer.current);
      onToggleFullscreen?.();
      return;
    }
    if (e.detail === 1 && roleRef.current === "host") {
      clearTimeout(clickTimer.current);
      clickTimer.current = setTimeout(() => togglePlay(), 220);
    }
  }

  const isHost = role === "host";
  const seekable = isHost && prog.dur > 0;
  const mediaReady = youtubeId ? ytReady : !ytError;

  return (
    <div className="movie cf-player" style={{ aspectRatio: ratio }} onClick={onStageClick}>
      {youtubeId ? (
        <div key={reloadKey} ref={ytContainerRef} className="cf-frame" />
      ) : (
        <video
          ref={videoRef}
          className="cf-frame"
          src={url}
          playsInline
          onLoadedMetadata={(e) => {
            const v = e.target;
            if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
          }}
          onPlay={() => { setPlaying(true); if (roleRef.current === "host") sync(true, videoRef.current?.currentTime || 0); }}
          onPause={() => { setPlaying(false); if (roleRef.current === "host") sync(false, videoRef.current?.currentTime || 0); }}
          onEnded={() => { setPlaying(false); if (roleRef.current === "host") sync(false, videoRef.current?.currentTime || 0); }}
        />
      )}

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
            onClick={() => { if (youtubeId) { setPlaying(false); setReloadKey((k) => k + 1); } }}
            title="Reload video (fixes a frozen black frame)"
          >⟳</button>
          <button className="cf-btn" onClick={onToggleFullscreen} title="Fullscreen">⛶</button>
        </div>
      </div>
    </div>
  );
});

export default MoviePlayer;