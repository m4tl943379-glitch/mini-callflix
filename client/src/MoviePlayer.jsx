import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

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

const MoviePlayer = forwardRef(function MoviePlayer(
  { url, role, playback, onPlayback },
  ref
) {
  const videoRef = useRef(null);
  const ytContainerRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const suppressRef = useRef(false);
  const playbackRef = useRef(playback);
  const roleRef = useRef(role);

  useEffect(() => { playbackRef.current = playback; }, [playback]);
  useEffect(() => { roleRef.current = role; }, [role]);

  const youtubeId = parseYouTubeId(url);
  const [ytReady, setYtReady] = useState(false);
  const [videoRatio, setVideoRatio] = useState(16 / 9);

  function applyCurrentState() {
    if (roleRef.current !== "guest") return;
    const state = playbackRef.current;
    if (!state) return;
    const time = Math.max(0, Number(state.time) || 0);

    if (youtubeId) {
      const p = ytPlayerRef.current;
      if (!p) return;
      suppressRef.current = true;
      try { p.seekTo(time, true); } catch {}
      try { if (state.playing) p.playVideo(); else p.pauseVideo(); } catch {}
      setTimeout(() => { suppressRef.current = false; }, 300);
    } else {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = time;
      if (state.playing) v.play().catch(() => {}); else v.pause();
    }
  }

  useImperativeHandle(ref, () => ({
    play: () => {
      if (youtubeId && ytReady) ytPlayerRef.current?.playVideo();
      else videoRef.current?.play().catch(() => {});
    },
    pause: () => {
      if (youtubeId && ytReady) ytPlayerRef.current?.pauseVideo();
      else videoRef.current?.pause();
    },
    currentTime: () => {
      if (youtubeId && ytReady) return ytPlayerRef.current?.getCurrentTime() || 0;
      return videoRef.current?.currentTime || 0;
    },
    apply: applyCurrentState
  }), [youtubeId, ytReady]);

  useEffect(() => {
    if (youtubeId) return;
    if (role !== "guest") return;
    const v = videoRef.current;
    if (!v) return;
    const apply = () => applyCurrentState();
    if (v.readyState >= 1) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
    return () => v.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, youtubeId, role]);

  useEffect(() => {
    if (!youtubeId) return;
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !ytContainerRef.current) return;
      ytContainerRef.current.innerHTML = "";
      const player = new window.YT.Player(ytContainerRef.current, {
        videoId: youtubeId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: roleRef.current === "host" ? 1 : 0,
          disablekb: roleRef.current === "host" ? 0 : 1,
          fs: 0
        },
        events: {
          onReady: () => {
            ytPlayerRef.current = player;
            setYtReady(true);
            applyCurrentState();
          },
          onStateChange: (event) => {
            if (suppressRef.current) return;
            if (roleRef.current !== "host") return;
            const playing = event.data === window.YT.PlayerState.PLAYING;
            let time = 0;
            try { time = player.getCurrentTime() || 0; } catch {}
            onPlayback(playing, time);
          }
        }
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId, role]);

  useEffect(() => {
    applyCurrentState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback]);

  if (youtubeId) {
    return <div className="movie" ref={ytContainerRef} />;
  }

  return (
    <video
      ref={videoRef}
      className="movie"
      style={{ aspectRatio: videoRatio }}
      src={url}
      controls
      playsInline
      onLoadedMetadata={(e) => {
        const v = e.target;
        if (v.videoWidth && v.videoHeight) setVideoRatio(v.videoWidth / v.videoHeight);
      }}
      onClick={(_) => {}}
      onPlay={() => { if (role === "host") onPlayback(true, videoRef.current?.currentTime || 0); }}
      onPause={() => { if (role === "host") onPlayback(false, videoRef.current?.currentTime || 0); }}
      onSeeked={() => { if (role === "host") onPlayback(!videoRef.current?.paused, videoRef.current?.currentTime || 0); }}
    />
  );
});

export default MoviePlayer;