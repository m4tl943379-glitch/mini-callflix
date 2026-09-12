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
| `ROOM_IDLE_TTL_MS` | 1800000 (30 min) | TTL de nettoyage d'une room laissée avec 1 seul participant |

## Protocole Socket.IO (événements)

Client → serveur : `room:create`, `room:join`, `webrtc:offer|answer|ice`, `media:state`, `playback:state` (hôte), `movie:set` (hôte), `chat:message`, `reaction:send`, `room:leave`.

Serveur → client : `room:participant-joined`, `room:participant-left`, `room:expired`, `webrtc:offer|answer|ice`, `media:state`, `playback:state`, `movie:url`, `chat:message`, `reaction:show`.

Règles serveur : max 2 participants par room ; seul l'hôte change `playback:state` et `movie:set` ; les URL de film n'acceptent que `http(s)://`, `/chemin` ou vide.

## Flashs de conception clés

- MoviePlayer choisit automatiquement : lien YouTube → lecteur IFrame (hôte autoritaire, contrôles nativés ; invité sans contrôles), sinon `<video>` local. L'invité se recale sur `playback` au chargement et à chaque `playback:state`.
- Rooms **en mémoire** : redémarrage du serveur = rooms effacées. Une room vide est supprimée immédiatement ; une room à 1 participant est supprimée après `ROOM_IDLE_TTL_MS`.
- WebRTC : STUN public Google uniquement (pas de TURN → certains réseaux échouent).

## Déploiement

- Frontend → **Vercel** : import repo, variable build-time `VITE_SERVER_URL` = URL Render, build `npm run build`, output `dist` (câblé par `vercel.json`).
- Serveur → **Render** : Blueprint `render.yaml` (npm install + npm start). WebSockets OK. Free tier : le service s'endort après ~15 min d'inactivité.
- Vérifier `CLIENT_ORIGIN` sur Render = URL Vercel exacte, sinon CORS bloque le frontend.

## Limites connues

Pas d'auth, pas de persistance du chat, une seule vidéo à la fois, pas de TURN, synchro simple sans correction de dérive.