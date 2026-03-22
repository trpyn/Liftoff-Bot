# Competition System

The Liftoff competition is a season-based league system that tracks pilot performance across weekly periods. Points are earned through race finishes, lap volume, consistency, improvement, and participation. All data updates in real-time via WebSocket.

---

## Structure

### Season
A competition (season) is created by an admin and set to **active**. It contains multiple **weeks** that run back-to-back, each spanning Monday 00:00 UTC through Sunday 23:59:59 UTC. Weeks are auto-generated aligned to Monday boundaries.

### Week Lifecycle
Each week progresses through three statuses:

| Status | Meaning |
|---|---|
| **Scheduled** | Upcoming week, not yet started. Shown with an orange dot on the week tab. |
| **Active** | Currently running. The competition runner checks every 60 seconds and automatically activates a scheduled week once its start time arrives. Shown with a green dot. |
| **Finalised** | Week has ended. The runner automatically finalises an active week once its end time passes, awarding batch bonuses (improvement & participation) and locking the results. Shown with a grey dot. |

### Playlists
Each week can have one or more playlists assigned to it. The competition runner automatically rotates through them, cycling playlists in order. After a server reboot, the system deterministically calculates exactly where in the playlist rotation it should be based on elapsed time since the week started — no state needs to survive the restart.

---

## Competition Page (competition.html)

The public-facing competition page has four main sections:

### 1. Competition Banner
Displayed at the top when a competition is active. Shows:
- **Competition name**
- **Current week number** and date range (e.g. "Week 3 - Mar 9 - Mar 15")
- **Days remaining** countdown for the current week

If no competition is active, displays: *"No active competition. Check back soon!"*

### 2. Season Standings
A cumulative leaderboard across all weeks in the season. Columns:

| Column | Description |
|---|---|
| **#** | Rank (1st = gold, 2nd = silver, 3rd = bronze styling) |
| **Pilot** | Display name (clickable to open pilot detail panel) |
| **Total Pts** | Sum of all points across all weeks (highlighted in orange) |
| **Weeks** | Number of distinct weeks the pilot was active |
| **Position** | Cumulative race position points |
| **Laps** | Cumulative lap volume + lap leader points |
| **Consistency** | Cumulative consistency points |
| **Improved** | Cumulative improvement + personal best points |
| **Participation** | Cumulative participation points |

### 3. Weekly Standings
A per-week leaderboard. Pilots select a week via tabs at the top (each tab shows a status dot). Columns:

| Column | Description |
|---|---|
| **#** | Rank within that week |
| **Pilot** | Display name (clickable) |
| **Total** | Total points earned that week |
| **Position** | Race position points |
| **Laps** | Lap volume + lap leader points |
| **Consistency** | Consistency points |
| **Streak** | Hot streak (fastest lap) points |
| **Improved** | Improvement + personal best points |
| **Participation** | Participation points |

### 4. Award Highlights
Award cards shown for the selected week, highlighting the top pilot in each category:

| Award | Icon | Criteria |
|---|---|---|
| **Overall Leader** | Trophy | Highest total points for the week |
| **Speed Demon** | Lightning bolt | Most position points |
| **Most Laps** | Rocket | Most lap points |
| **Most Consistent** | Target | Most consistency points |
| **Hot Streak** | Fire | Most streak points |
| **Iron Pilot** | Flexed bicep | Most participation points |

### 5. Pilot Detail Panel
Clicking any pilot name opens an expandable panel showing:
- **Bar chart** visualising the pilot's total points per week across the season
- **Week-by-week breakdown table** with columns: Week, Rank, Total, Position, Laps, Consistency, Improved, Participation

---

## Points System — Full Breakdown

Points are split into two categories: **real-time** (awarded instantly after each race closes) and **batch** (awarded when a week is finalised).

### Real-Time Points (Per Race)

#### Race Position Points (F1-style)
Awarded based on finishing position, determined by best lap time. Requires a minimum of **2 laps** to qualify.

| Position | Points |
|---|---|
| 1st | 25 |
| 2nd | 18 |
| 3rd | 15 |
| 4th | 12 |
| 5th | 10 |
| 6th | 8 |
| 7th | 6 |
| 8th | 4 |

**Scaling rules:**
- **Solo race (1 participant):** No position points awarded
- **2 participants:** Position points are halved (multiplied by 0.5)
- **3+ participants:** Full points awarded

#### Lap Volume Points
Earned for flying more laps in a single race.

- **1 point per 5 laps completed**, capped at **10 points** (i.e. max at 50+ laps)

#### Lap Leader Bonus
- **5 points** to the pilot who completed the most laps in a race
- Requires **3+ participants** in the race

#### Hot Streak (Fastest Lap Bonus)
- **3 points** to the pilot with the fastest single lap in a race
- Requires **3+ participants** in the race

#### Consistency Points
Rewards pilots who fly with steady, predictable lap times rather than wildly varying.

**Calculation method:**
1. Requires at least **3 laps** and **2+ pilots** in the race
2. For each pilot, collect all lap times and **drop the worst 20%** (outlier removal)
3. Calculate the **standard deviation** of the remaining lap times
4. Find the **median standard deviation** across all qualifying pilots
5. Every pilot whose standard deviation is **at or below the median** earns **3 points**

This means roughly half the field earns consistency points each race — the more consistent half.

---

### Batch Points (Week Finalisation)

These are calculated once when a week ends and is finalised.

#### Most Improved
Compares each pilot's best lap times during the week against their **historical personal bests** (baseline) on the same track/environment combinations from before the week started.

- Improvement is measured as **percentage faster** than their baseline on each track
- The average improvement percentage across all improved tracks determines ranking

**Top 3 rewards:**

| Rank | Points |
|---|---|
| 1st most improved | 15 |
| 2nd most improved | 10 |
| 3rd most improved | 5 |

#### Personal Best Points
- **3 points per track** where the pilot set a new personal best during the week
- Awarded independently of the Most Improved ranking (a pilot can earn both)

#### Participation Points
Based on how many **distinct days** the pilot was active during the week:

| Days Active | Points |
|---|---|
| 7 days | 30 |
| 5-6 days | 20 |
| 3-4 days | 10 |
| 1-2 days | 0 |

**Track Variety Bonus:** +5 points if the pilot flew on **3 or more distinct tracks** during the week.

Maximum possible participation points per week: **35** (30 for 7 days + 5 for track variety).

---

## Points Summary Table

| Category | When Awarded | Points | Condition |
|---|---|---|---|
| Race Position (1st) | Per race | 25 | 2+ participants |
| Race Position (2nd) | Per race | 18 | 2+ participants |
| Race Position (3rd) | Per race | 15 | 3+ participants |
| Race Position (4th) | Per race | 12 | 4+ participants |
| Race Position (5th) | Per race | 10 | 5+ participants |
| Race Position (6th) | Per race | 8 | 6+ participants |
| Race Position (7th) | Per race | 6 | 7+ participants |
| Race Position (8th) | Per race | 4 | 8+ participants |
| Lap Volume | Per race | 1 per 5 laps (max 10) | — |
| Lap Leader | Per race | 5 | 3+ participants, most laps |
| Fastest Lap | Per race | 3 | 3+ participants |
| Consistency | Per race | 3 | Stddev at/below median, 3+ laps |
| Most Improved (1st) | Week end | 15 | Beat historical PB |
| Most Improved (2nd) | Week end | 10 | Beat historical PB |
| Most Improved (3rd) | Week end | 5 | Beat historical PB |
| Personal Best | Week end | 3 per track | New PB on any track |
| Participation (7 days) | Week end | 30 | Active 7 days |
| Participation (5-6 days) | Week end | 20 | Active 5-6 days |
| Participation (3-4 days) | Week end | 10 | Active 3-4 days |
| Track Variety | Week end | 5 | 3+ distinct tracks |

---

## Real-Time Updates

The competition page connects via WebSocket and responds to the following events:

| Event | Trigger | Effect |
|---|---|---|
| `competition_standings_update` | Race closes, standings recalculated | Refreshes the weekly and season leaderboards |
| `competition_week_started` | Scheduled week activates | Reloads the full competition state |
| `competition_week_finalised` | Active week ends and is finalised | Reloads the full competition state |
| `competition_points_awarded` | Points awarded after a race | Could trigger live point flash animations |

When standings update, table rows flash briefly with an orange highlight animation to draw attention to changes.

---

## Eligibility

- A pilot must complete at least **2 laps** in a race to be included in race results and earn position points
- A pilot must complete at least **3 laps** to qualify for consistency scoring
- Pilot identity is determined by `steam_id`, `pilot_guid`, or `nick` (in that priority order)
- There are no explicit sign-up requirements — any pilot who flies during an active competition week is automatically included

---

## Admin Controls

Administrators can:
- Create and archive competitions
- Generate weekly schedules with configurable week counts
- Edit week dates and statuses
- Assign playlists to weeks (with ordering and interval configuration)
- Toggle auto-managed playlist rotation on/off
- **Recalculate** a week's scores from scratch (clears all points/results and re-processes every race in the week's time window)
