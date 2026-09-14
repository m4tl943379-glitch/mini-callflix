# AGENTS.md — MINI CALLFLIX

Watch-party à 2 personnes : film synchronisé + appel WebRTC + chat. React/Vite (client) + Node/Express/Socket.IO (serveur signalisation).

## Stack & structure

- `client/` — frontend React (Vite). App.jsx (UI/logique), MoviePlayer.jsx (lecteur vidéo local OU YouTube selon le lien), styles.css.
- `server/server.js` — serveur de signalisation Socket.IO + rooms en mémoire. Pas de base de données.
- `public/movie/movie.mp4` — film local par défaut (optionnel, voir plus bas).
- `vercel.json` — build frontend pour Vercel (output `dist`, rewrites SPA).
- `render.yaml` — blueprint Render pour le serveur temps réel.
- `package.json` — scripts à la racine.

## Commandes

```bash
npm install          # installer les dépendances
npm run dev:all      # serveur (3001) + client Vite (5173) via concurrently
npm run server       # uniquement le serveur Socket.IO (port 3001 ou $PORT)
npm run client       # uniquement Vite (port 5173)
npm run build        # build production → dist/
npm start            # node server/server.js (utilisé par Render)
```

Vérification syntaxe serveur : `node --check server/server.js`.

## Variables d'environnement

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | 3001 | Port du serveur (Render injecte le sien) |
| `CLIENT_ORIGIN` | http://localhost:5173 | Origine CORS autorisée pour Socket.IO/Express |
| `VITE_SERVER_URL` | http://localhost:3001 | URL du serveur Socket.IO **côté client** (à la construction) |
| `CUSTOM_TURN_URLS` (deprecated : `VITE_TURN_URLS`) | (vide) | Liste `,` de serveurs TURN supplémentaires (`turn:host:port?transport=tcp`) |
| `STUN_URLS` | Google x2 + Cloudflare + OpenRelay | Liste `,` de serveurs STUN **côté serveur** (`/api/ice-config`) |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | (vides → OpenRelay par défaut) | TURN **côté serveur** ; servi via `/api/ice-config`, sans rebuild du client |
| `ROOM_IDLE_TTL_MS` | 1800000 (30 min) | TTL de nettoyage d'une room laissée avec 1 seul participant |
| `MOVIE_SOURCE_URL` | release GitHub `m4tl943379-glitch/callflix-movie` | URL mp4 source du proxy `/movie/movie.mp4` (re-servie en `video/mp4` + Range pour le lecteur `<video>` ; GitHub renvoie de l'octet-stream sinon) |

## Protocole Socket.IO (événements)

Client → serveur : `room:create`, `room:join`, `webrtc:offer|answer|ice`, `media:state`, `film:action` (les 2 membres sont leaders), `film:sync`, `movie:set` (hôte), `chat:message`, `reaction:send`, `feel:send`, `room:leave`.

Serveur → client : `room:participant-joined`, `room:participant-left`, `room:expired`, `webrtc:offer|answer|ice`, `media:state`, `film:action` (avec `from` = socket id émetteur), `film:sync`, `movie:url`, `chat:message`, `reaction:show`, `feel:show`.

Règles serveur : max 2 participants par room ; les URL de film n'acceptent que `http(s)://`, `/chemin` ou vide ; seul l'hôte change le film (`movie:set`, reset l'état à 0) ; `film:action` est accepté des 2 membres (2 leaders, anti-boucle via `from` + `mirror` client), le serveur mémorise `{playing, time, updatedAt}` et l'envole aux arrivants (ack de join).

## Flashs de conception clés

- **Auto-hide cinématique des contrôles movie** (`MoviePlayer.jsx` + `styles.css`) : état `controlsVisible` + timer unique `hideTimerRef` (`AUTO_HIDE_MS = 2600`). Tout `onPointerMove`/`onPointerDown` sur le film ou `.cf-controls` ré-affiche les contrôles et reset le timer ; quand le film **joue**, après ~2,6 s d'inactivité les contrôles disparaissent (transition `opacity .35s` + `visibility` + `translateY(12px)` sur `.cf-player-bar`, fondu + `scale(.96)` sur `.cf-play-big`) ; quand le film est **en pause**, ils restent visibles (pause → effect reset, pas de hide). Double source de vérité compatible : classe `.cf-controls.hidden` (interne) **ou** `.chrome-hidden .cf-controls` (App.jsx bumpChrome) → mêmes règles CSS combinées. La `control-bar` réactions/feeling/cam/mic (App.jsx) reste gérée par `chrome-hidden` uniquement. Slider `.cf-range` premium : thumb 14px visible au hover/active/focus, track 4px→6px au hover + glow, mode `pointer:coarse` (touch) : track 5px, thumb 18px toujours visible, `.cf-btn` padding 10px/svg 20px, `.cf-play-big` 66px. Ne pas toucher à la synchro (film:action/film:sync/heartbeat) ni au boîtier auto-hide d'App.jsx.

- **Design system cinématique** (`client/src/styles.css`) : tokens dans `:root` (`--accent: #e50914`, `--bg-0…3`, `--r-s…xl`, `--ease`, `--m-*` durations, `--sh-*`/`--glow`). Ambiance salle : fond quasi-noir, lumières radiales rouges/bordeaux (`movie-scene`, `.room-page::before`), vignette interne, grain SVG (`cf-grain`/`cf-cine-grain`), glassmorphism modéré (backdrop-blur). Hiérarchie visuelle : MOVIE (scene centrale) > CAM (sidebar 370px) > Feeling. Tous les boutons de contrôles/vidéo utilisent des **icônes SVG inline** (`MoviePlayer.jsx` : IconPlay/Pause/Vol/Mute/Reload/Fullscreen/Exclaim ; `App.jsx` : IconCam/Mic/Off/Chat/Fullscreen/Shrink) avec `aria-label` — aucun emoji dans les contrôles. Zones sensibles à préserver : `.cf-movie iframe` (YouTube pointer-events:none), `.chrome-hidden .cf-controls/.control-bar`, `.room-page:fullscreen` (topbar/sidebar invite-box masqués, `.chat-icon-btn` en bottom), `@media (prefers-reduced-motion)` réduit tout. Slider `.cf-range` avec thumb visible au hover.
- **Responsive (mobile ≤600px OU paysage coarse <450px hauteur)** : layout **film-first** dédié, séparé du desktop (media query : `(max-width: 600px), (orientation: landscape) and (max-height: 450px) and (pointer: coarse)` ; même détection en JS via `isMobileViewport()`). Desktop ≥601px **inchangé** (sidebar 370px, workspace row). Mobile : `.room-page` 100dvh overflow hidden, film `movie-scene` border-radius 10px remplit l'écran, sidebar transformée en **chat bottom sheet** (`.sidebar` position:fixed, 60vh, translateY(105%) + `:has(.chat-panel.open)` → slide up, invite-box/cameras `.sidebar` cachées), **caméras en overlay** dans `.camera-overlays` (chips rondes 92px `border-radius:50%` coins haut de la scene, `display:none` desktop ; refs vidéo dédiées `localVideoOverlay`/`remoteVideoOverlay` synchronisées à chaque point de `srcObject`), **bottom bar** `.mobile-bar` fixed (cam/mic/chat + msg-badge, `display:none` desktop), topbar : `.chat-toggle`/`.room-pill`/`.ice-pill` masqués, `control-bar` cam/mic masqués (via `[title=...]`, gérés par la bottom bar), et pour éviter tout chevauchement avec la `mobile-bar` persistante (bottom 12px) : `.cf-player-bar` remontée à bottom 74px, `control-bar` à bottom 148px, feel-panel à bottom 152px. Au join sur mobile, un effect ferme le chat (`setChatOpen(false)` + `setSidebarOpen(false)`). En fullscreen mobile : topbar, `.mobile-bar` et sidebar masqués. Ne jamais toucher à la logique WebRTC/backend pour cette couche.

- MoviePlayer choisit automatiquement : lien YouTube → lecteur IFrame (contrôles CALLFLIX custom, 2 leaders), sinon `<video>` local. `MOVIE_SRC` par défaut côté client = `VITE_SERVER_URL/movie/movie.mp4` → servi par le **proxy serveur** (`MOVIE_SOURCE_URL`) re-servi en `video/mp4` + Range (GitHub Releases renvoie de l'octet-stream, il faut donc toujours passer par le proxy). Anti-boucle : le client ignore les messages dont `from` = son propre socket id et pose `mirror` pendant l'application d'une action distante (pas de ré-émission). Synchronisation : actions `film:action` (play/pause/seek, reseek seulement si dérive > 1 s) + heartbeat `film:sync` toutes les 8 s (recal si dérive > 1,5 s) + état initial reçu au join.
- Rooms **en mémoire** : redémarrage du serveur = rooms effacées. Une room vide est supprimée immédiatement ; une room à 1 participant est supprimée après `ROOM_IDLE_TTL_MS`.
- Leaving : bouton **Leave** → modal de confirmation (`showLeaveConfirm` : Stay/Leave) puis `performCleanExit` (pause movie, stop cam/mic, close WebRTC, `room:leave`, view `thanks`). Le serveur notifie l’autre membre via `room:participant-left` émis en `socket.to` (jamais à l’expéditeur) ; le restant passe en modal **partner-left** (`partnerLeftAlert` : Continue Watching / Leave Room) sans être kické ni recharger le film. **Continue Watching** → `soloMode` (stopWebRTC + `room:leave` socket, MoviePlayer reçoit `solo` et ne fait ni `film:action`/`film:sync` ni heartbeat) ; UI call/cameras masquée. Gardes anti-doublons : `hasLeftRef`, `partnerLeftHandledRef`, `isCleaningUpRef`.
- WebRTC : le client récupère sa config ICE au runtime via `GET /api/ice-config` (serveur, `Cache-Control: no-store`) et retombe sur une liste en dur dans `App.jsx` si le fetch échoue (IDs OpenRelay = creds publiques de démo, PAS des secrets). Défaut : 4 serveurs STUN publics (Google x2, Cloudflare, OpenRelay) + TURN OpenRelay (`:80` UDP/TCP, `:443` TCP, `turns:443`). La config TURN se change par env Render (`TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL`) **sans redéployer le client** ; `TURN_URLS` est splitté par virgule et accepte aussi des creds inline (`turn:user:pass@host:port?transport=...`). **Recovery ICE** (hôte) : `failed` → iceRestart après 1,5 s ; `disconnected` → grâce de 5 s puis restart ; watchdog 22 s si bloqué en « connecting » ; retry anticipé ~8 s après fin du gathering ; budget max `MAX_ICE_RESTARTS = 6` puis état « Connection failed » (pas de boucle infinie) ; pas de 2e `RTCPeerConnection` (restart ICE in-place, `if (peer.current) return`). `refreshIceInfo` = `getStats()` sur la paire nominated/selected (jamais « Direct (P2P) » si relay). L'invité répond via le flux existant. Le message « Video connection lost » est effacé quand la connexion revient. Pilule d'état ICE : Connecting…/Retrying…/Connected/Direct (P2P)/Relay (TURN)/Connection failed (dot rouge `.ice-dot.bad`).

## Déploiement

- Frontend → **Vercel** : import repo, variable build-time `VITE_SERVER_URL` = URL Render, build `npm run build`, output `dist` (câblé par `vercel.json`). Le workflow CI passe `VERCEL_TOKEN` via `env:` et épingler `vercel@59.16.0` (les CLI vercel ≥59 refusent les tokens `vca_` passés par `--token`) ; sinon le step « Deploy to Vercel » échoue sans erreur visible.
- Serveur → **Render** : Blueprint `render.yaml` (npm install + npm start). WebSockets OK. Free tier : le service s'endort après ~15 min d'inactivité.
- Vérifier `CLIENT_ORIGIN` sur Render = URL Vercel exacte, sinon CORS bloque le frontend.

## Limites connues

Pas d'auth, pas de persistance du chat, une seule vidéo à la fois, synchro simple sans correction de dérive.

## Expérience spéciale « Salma » (couchée sur l'architecture existante)

- Activation : `isSalmaMode` = nom affiché (minuscules) contient `salma`, `sisi` ou `sousou` (substring, case-insensitive). Ne modifie **rien** pour les autres utilisateurs.
- Déclencheur : quand `roomState.count === 2` et `isSalmaMode`, `introStep` passe `idle → intro` (overlay plein écran `.cf-intro`, z-index 90) : 3 phrases en fondu séquencé (`--d` = délai CSS, pas de timers) puis bouton **Open your surprise ❤️** → `capsule` (2 phrases + message Arabizi exact `salma mahma tbdlt layem o wa9t, …` + bouton **Start Movie**) → `done` (overlay démonté — vérifier la condition `introStep === "intro" || "capsule"`). Start Movie = `playerRef.play()` (2 leaders → sync normale). Le film reste monté en dessous (aucun remount). Reset des états dans `onExpired`, `resetRoomUi`, `continueWatchingSolo`.
- Feelings : bouton discret **♡ Feeling** dans la `control-bar` (dispo pour les 2 membres quand `roomState.count === 2 && !soloMode` — plus un gating Salma), panneau glass `.feel-panel` (6 options exactes + message libre ≤ 80 chars, fermeture par clic extérieur, Échap ou ✕, animations fade+scale ~240 ms à l'ouverture et fermeture, feedback « Sent ❤️ » 1,1 s sur le bouton). Envoi `feel:send` → serveur valide (`trim`, ≤ 120) et relaie en `socket.to` avec `user` → `feel:show` → toast `.feel-toast` (fixed top, fade in/out ~3 s, jamais au centre du film). Rendu spécial des 3 feelings forts (`could_be_us`, `i_wanna_do_this_with_you`, `this_is_us`) via `feelingDisplay`. Clés : `i_love_you`, `im_still_here`, `could_be_us`, `i_wanna_do_this_with_you`, `i_miss_you`, `this_is_us`. Pas de compteurs ; les deux membres leaders et la hiérarchie visuelle MOVIE > CAM > Feeling sont préservés.