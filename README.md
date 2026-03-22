# Liftoff Competition

Competition management platform for Liftoff FPV Simulator. Remotely control your lobby — change tracks, kick players, run playlists with scheduled rotations, and let pilots vote to skip or extend. Run weekly competitions with automatic scoring, league tables, and a playlist calendar that auto-rotates tracks all week. Includes a BepInEx game plugin, Node.js backend, live spectator view, competition page, and admin dashboard. Turn casual lobbies into league nights.

---

## Overview

Liftoff Competition transforms a standard Liftoff multiplayer session into a structured, managed event. It connects a BepInEx game plugin running inside Liftoff to a server backend, which powers three web interfaces: a **public live view** for spectators, a **competition page** with season and weekly league tables, and an **admin dashboard** for organisers.

### How It Works

```
┌──────────────┐   WebSocket    ┌──────────────┐   WebSocket    ┌──────────────┐
│  Liftoff Game │◄─────────────►│    Server     │◄─────────────►│  Admin Panel  │
│  (BepInEx     │   /ws/plugin  │  (Node.js +   │   /ws/admin   │  (Browser)    │
│   Plugin)     │               │   Express)    │               │               │
└──────────────┘               │               │               └──────────────┘
                                │   SQLite DB   │
                                │               │   WebSocket    ┌──────────────┐
                                │   Competition │◄─────────────►│  Live View    │
                                │    Runner     │   /ws/live     │  (Browser)    │
                                └──────────────┘                │               │
                                                                ├──────────────┤
                                                                │  Competition  │
                                                                │  Page         │
                                                                └──────────────┘
```

1. The **BepInEx plugin** captures Photon multiplayer events (races, laps, players, chat) inside Liftoff and sends them to the server over WebSocket.
2. The **server** ingests events into SQLite, manages state, and broadcasts updates to connected web clients.
3. The **competition runner** manages weekly competition lifecycles — activating weeks, rotating playlists, and auto-recovering after server reboots.
4. The **admin dashboard** lets organisers control the lobby: change tracks, run playlists, send chat, manage players, and configure competitions.
5. The **live view** gives spectators a real-time window into the current race, track, and player activity.
6. The **competition page** shows season and weekly league tables with live-updating standings.
7. Commands flow back from the server to the plugin to execute lobby changes (track switches, chat messages, kicks) inside the game.

---

## Features

### Lobby Control
- Change tracks remotely from the admin dashboard
- Kick players when moderation is needed
- Browse and search the available track catalog
- Full command/response protocol between server and game

### Playlists
- Create named playlists with ordered track lists
- Start, stop, pause, and skip through playlists
- Scheduled track rotation with configurable timing
- Resume mid-playlist after server reboot with correct remaining time
- Ideal for league nights, qualifying sessions, tournaments, and curated race events

### Vote to Skip
- Players type `/next` in game chat to start a skip vote (3-minute timer)
- Additional players type `/next` to add their vote
- Configurable vote threshold — when enough players vote, the track advances automatically

### Vote to Extend
- Players type `/extend` in game chat to start an extend vote (3-minute timer)
- Uses the same vote threshold as `/next`
- When the vote passes, 5 minutes are added to the current track timer before it auto-advances

### Idle Kick

- When the lobby is full (8 players), idle pilots inactive for 5 minutes receive an in-game warning
- After 1 additional minute without activity, they are automatically kicked to free up a slot
- Activity is tracked via gameplay events: checkpoints, laps, race completions, resets, chat messages, race starts, and race ends — so slow pilots on long tracks won't be falsely kicked
- Players can type `/stay` in chat to reset their idle timer (adds 5 more minutes)
- JMT_Bot (the host) is always immune and hidden from the admin player list
- Additional players can be whitelisted via admin API, admin dashboard, or `IDLE_KICK_WHITELIST` env var
- Only active when a playlist is running — free lobbies are unaffected

### Player Commands
- `/info` — shows available player commands
- `/next` — vote to skip the current track
- `/extend` — vote to extend the current track by 5 minutes
- `/stay` — reset your idle timer (prevents auto-kick)

### Competition System

- Create seasons with weekly competition weeks
- Automatic weekly lifecycle: `scheduled → active → finalised`
- **Playlist calendar** — assign multiple playlists per week; they run back-to-back and repeat for the entire week
- Playlists auto-start when a week begins, no manual intervention needed
- **Reboot resilient** — deterministic time-based calculation resumes at the correct playlist and track after a server restart, verifying and correcting the in-game track if needed
- Real-time scoring on every race close, plus batch scoring at week finalisation

### Points & Scoring

- **Race position** — F1-style points (25/18/15/12/10/8/6/4) based on fastest single lap per race
- **Most laps** — 1 point per 5 laps (capped at 10), plus 5-point lap leader bonus
- **Hot streak** — 3 points for setting the fastest lap in a race
- **Consistency** — 3 points if your lap time standard deviation is below the race median (drop worst 20%)
- **Most improved** — top 3 pilots by % improvement over pre-week personal bests earn 15/10/5 points; 3 points per new personal best on any track
- **Participation** — 10/20/30 points for flying on 3/5/7 days; 5 bonus points for 3+ different tracks
- Anti-gaming: minimum 2 laps to qualify, solo pilots get no position points, 2 participants = half points

> For the full points breakdown, scoring formulas, consistency calculation method, award categories, and everything shown on the competition page, see **[Competition.md](Competition.md)**.

### Competition Page

- Dedicated `/competition.html` page with season and weekly league tables
- Season leaderboard aggregating all weeks
- Weekly standings broken down by category (position, laps, consistency, improved, participation, streak)
- Award highlight cards for top performers in each category
- Pilot drill-down showing race-by-race history and points breakdown
- Live updates via WebSocket — standings refresh automatically after each race
- Small competition summary widget on the homepage with top 3 pilots

### Live Spectator View
- Real-time race visualization in the browser
- Current track and environment display
- Active player roster
- Live lap activity feed
- Connection status indicator
- Designed for embedding in streams, club pages, or community sites

### Admin Dashboard

- Browser-based control panel for event organisers
- Multi-user authentication — each admin has their own username and password
- Player management with kick controls, per-player idle time display, and whitelist toggle
- Track catalog browsing and selection
- Playlist creation, management, and execution
- **Competition management** — create seasons, generate weeks, assign playlists to weeks, recalculate points
- **Competition runner status** — view and toggle auto-managed playlist rotation
- Live chat monitoring
- Manual and automated chat messaging
- Race monitoring and session overview

### Chat System
- View in-game chat live in the admin panel
- Send messages directly into the game from the browser
- Automated message templates triggered by events:
  - `track_change` — announce the next track
  - `race_start` — notify players a race has begun
  - `race_end` — congratulate the winner
- Template variables: `{env}`, `{track}`, `{race}`, `{mins}`, `{winner}`, `{time}`
- Schedule warning messages before track rotation

### Race Data

- Automatic race and lap recording to SQLite
- Per-pilot tracking via Steam ID and pilot GUID
- Session history and leaderboard support
- Structured JSONL event logs from the plugin
- Race results feed into competition scoring automatically when a competition week is active

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Game Plugin | C# / .NET 4.7.2 / BepInEx / Photon (PUN3) |
| Server | Node.js / Express / WebSocket (ws) |
| Database | SQLite (WAL mode) |
| Validation | AJV (JSON Schema) |
| Frontend | Vanilla JS, HTML, CSS |
| Infrastructure | Docker, Docker Compose, Nginx, Let's Encrypt |
| Tests | Vitest |

---

## Project Structure

```
Liftoff/
├── contracts/                          # Shared event schemas (JSON Schema)
│   ├── common.json
│   ├── lap_recorded.json
│   ├── player_entered.json
│   ├── player_left.json
│   ├── player_list.json
│   ├── race_end.json
│   ├── race_reset.json
│   └── set_track.json
│
├── Pluggins/
│   └── LiftoffPhotonEventLogger/       # BepInEx game plugin
│       ├── LiftoffPhotonEventLogger.cs
│       ├── Features/
│       │   ├── Chat/                   # In-game chat capture
│       │   ├── Competition/            # WebSocket client & config
│       │   ├── Identity/               # Player identity tracking
│       │   ├── Logging/                # File logging & serialization
│       │   └── MultiplayerTrackControl/# Track/race/environment control
│       └── docs/
│
├── Server/
│   ├── src/
│   │   ├── index.js                    # Entry point
│   │   ├── pluginSocket.js             # Plugin WebSocket server
│   │   ├── liveSocket.js               # Live & admin WebSocket servers
│   │   ├── broadcast.js                # Event broadcast dispatcher
│   │   ├── playlistRunner.js           # Playlist scheduling & execution
│   │   ├── competitionRunner.js        # Weekly competition lifecycle & playlist calendar
│   │   ├── competitionScoring.js       # Points engine (real-time + batch)
│   │   ├── state.js                    # In-memory state
│   │   ├── auth.js                     # Password hashing & session store
│   │   ├── idleKick.js                 # Auto-kick idle pilots
│   │   ├── skipVote.js                 # Vote-to-skip logic
│   │   ├── eventTypes.js               # Event type constants
│   │   ├── contracts.js                # Event validation
│   │   ├── routes/
│   │   │   ├── admin.js                # Admin API endpoints
│   │   │   └── public.js               # Public API endpoints
│   │   ├── cli/
│   │   │   └── createUser.js           # CLI admin user creation
│   │   └── db/                         # SQLite layer
│   │       ├── connection.js           # Schema & connection
│   │       ├── competition.js          # Competition queries
│   │       ├── ingest.js               # Event ingestion
│   │       └── ...
│   │
│   ├── public/
│   │   ├── index.html                  # Public live view
│   │   ├── competition.html            # Competition league tables
│   │   ├── admin.html                  # Admin dashboard
│   │   └── js/
│   │       ├── public.js               # Live view frontend
│   │       ├── competition.js          # Competition page frontend
│   │       ├── admin.js                # Admin dashboard frontend
│   │       └── shared.js               # Shared helpers
│   │
│   ├── nginx/                          # Reverse proxy config
│   ├── docker-compose.yml
│   ├── Dockerfile
│   └── .env.example
│
└── Logs/                               # Plugin log output
```

---

## Getting Started

### Prerequisites

- **Server:** Node.js 23+ (or Docker)
- **Plugin:** .NET Framework 4.7.2 SDK, Liftoff with [BepInEx](https://github.com/BepInEx/BepInEx) installed

### Server Setup

1. **Clone the repo and configure environment:**
   ```bash
   cd Server
   cp .env.example .env
   ```

2. **Edit `.env`** with your own secrets:
   ```env
   PORT=3000
   PLUGIN_API_KEY=your-plugin-key
   ADMIN_TOKEN=your-admin-token
   DB_PATH=./competition.db
   IDLE_KICK_WHITELIST=              # comma-separated nicks immune to idle kick
   ADMIN_USER=                       # initial admin username (first run only)
   ADMIN_PASS=                       # initial admin password (first run only)
   ```

3. **Run with Docker (recommended):**
   ```bash
   docker compose up -d
   ```

   Or **run locally:**
   ```bash
   npm install
   npm start
   ```

4. **Create an admin user** (choose one method):

   **Option A — via environment variables:** Set `ADMIN_USER` and `ADMIN_PASS` in `.env` before first start. The user is created automatically if the database has no users yet.

   **Option B — via CLI:**
   ```bash
   cd Server
   node src/cli/createUser.js <username> <password>
   ```

   You can create additional users the same way. The `ADMIN_TOKEN` in `.env` continues to work for API/script access via Bearer header.

5. **Access the interfaces:**
   - Live view: `http://localhost:3000/`
   - Competition: `http://localhost:3000/competition.html`
   - Admin panel: `http://localhost:3000/admin.html`

### Plugin Setup

1. Install [BepInEx 5](https://github.com/BepInEx/BepInEx) into your Liftoff game directory.

2. Build the plugin:
   ```bash
   cd Pluggins/LiftoffPhotonEventLogger
   dotnet build
   ```
   > By default, the project looks for Liftoff at the standard Steam install path. Set the `LIFTOFF_DIR` environment variable to override.

3. Copy the built DLL into `BepInEx/plugins/` in your Liftoff install folder.

4. Configure the plugin's connection settings (server URL and API key) to match your server's `.env` values.

5. Launch Liftoff and join a multiplayer session — the plugin connects to the server automatically.

### Production Deployment

For production with HTTPS:

1. Set up your domain's DNS to point to your server.
2. Run `init-certs.sh` to provision Let's Encrypt certificates.
3. (Optional) Run `init-htpasswd.sh` to set up Nginx Basic Auth as an extra layer for the admin page.
4. Create admin users via CLI or env vars (see step 4 above).
5. Start with Docker Compose — Nginx handles SSL termination and proxying.

---

## Running Tests

```bash
cd Server
npm test
```

---

## Who It's For

- **Race organisers** — reduce the friction of running structured events
- **League admins** — automate track rotation and manage sessions remotely
- **Community hosts** — give your club nights a professional feel
- **Streamers** — embed the live view for your audience
- **Anyone** who wants Liftoff multiplayer to feel like an organised event, not an ad-hoc lobby

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

## License

This project is licensed under the [MIT License](LICENSE).
