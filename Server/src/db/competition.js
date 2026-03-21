const { getDb } = require('./connection');

// ── Competitions ────────────────────────────────────────────────────────────

function createCompetition(name) {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO competitions (name, created_at) VALUES (?, datetime('now'))"
  ).run(name);
  return db.prepare('SELECT * FROM competitions WHERE id = ?').get(result.lastInsertRowid);
}

function getCompetitions() {
  return getDb().prepare('SELECT * FROM competitions ORDER BY id DESC').all();
}

function getActiveCompetition() {
  return getDb().prepare("SELECT * FROM competitions WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() || null;
}

function archiveCompetition(id) {
  getDb().prepare("UPDATE competitions SET status = 'archived' WHERE id = ?").run(id);
}

// ── Competition Weeks ───────────────────────────────────────────────────────

function createWeek(competitionId, weekNumber, startsAt, endsAt) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO competition_weeks (competition_id, week_number, starts_at, ends_at) VALUES (?, ?, ?, ?)'
  ).run(competitionId, weekNumber, startsAt, endsAt);
  return db.prepare('SELECT * FROM competition_weeks WHERE id = ?').get(result.lastInsertRowid);
}

function generateWeeks(competitionId, count, startDate) {
  const db = getDb();
  const weeks = [];
  const start = new Date(startDate);
  // Align to Monday
  const day = start.getUTCDay();
  const diff = day === 0 ? 1 : (day === 1 ? 0 : 8 - day);
  start.setUTCDate(start.getUTCDate() + diff);
  start.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const weekStart = new Date(start);
    weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 0);

    const week = createWeek(
      competitionId,
      i + 1,
      weekStart.toISOString(),
      weekEnd.toISOString()
    );
    weeks.push(week);
  }
  return weeks;
}

function getWeeks(competitionId) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM competition_weeks WHERE competition_id = ? ORDER BY week_number'
  ).all(competitionId);
  for (const w of rows) {
    w.playlist_count = db.prepare(
      'SELECT COUNT(*) AS n FROM week_playlists WHERE week_id = ?'
    ).get(w.id).n;
  }
  return rows;
}

function getWeekById(id) {
  return getDb().prepare('SELECT * FROM competition_weeks WHERE id = ?').get(id) || null;
}

function getActiveWeek() {
  return getDb().prepare(`
    SELECT cw.*, c.name AS competition_name
    FROM competition_weeks cw
    JOIN competitions c ON c.id = cw.competition_id
    WHERE cw.status = 'active' AND c.status = 'active'
    ORDER BY cw.id DESC LIMIT 1
  `).get() || null;
}

function getNextScheduledWeek() {
  const now = new Date().toISOString();
  return getDb().prepare(`
    SELECT cw.*, c.name AS competition_name
    FROM competition_weeks cw
    JOIN competitions c ON c.id = cw.competition_id
    WHERE cw.status = 'scheduled' AND c.status = 'active'
      AND cw.starts_at <= ?
    ORDER BY cw.starts_at ASC LIMIT 1
  `).get(now) || null;
}

function getOverdueActiveWeek() {
  const now = new Date().toISOString();
  return getDb().prepare(`
    SELECT cw.*, c.name AS competition_name
    FROM competition_weeks cw
    JOIN competitions c ON c.id = cw.competition_id
    WHERE cw.status = 'active' AND c.status = 'active'
      AND cw.ends_at < ?
    ORDER BY cw.ends_at ASC LIMIT 1
  `).get(now) || null;
}

function updateWeekStatus(id, status) {
  getDb().prepare('UPDATE competition_weeks SET status = ? WHERE id = ?').run(status, id);
}

function getCurrentWeekInfo() {
  const db = getDb();
  const active = getActiveWeek();
  if (!active) return null;
  const comp = db.prepare('SELECT * FROM competitions WHERE id = ?').get(active.competition_id);
  return { competition: comp, week: active };
}

// ── Week Playlists ──────────────────────────────────────────────────────────

function getWeekPlaylists(weekId) {
  return getDb().prepare(`
    SELECT wp.*, p.name AS playlist_name
    FROM week_playlists wp
    JOIN playlists p ON p.id = wp.playlist_id
    WHERE wp.week_id = ?
    ORDER BY wp.position
  `).all(weekId);
}

function addWeekPlaylist(weekId, playlistId, intervalMs = 900000) {
  const db = getDb();
  const maxPos = db.prepare(
    'SELECT COALESCE(MAX(position), -1) AS m FROM week_playlists WHERE week_id = ?'
  ).get(weekId).m;
  const result = db.prepare(
    'INSERT INTO week_playlists (week_id, playlist_id, position, interval_ms) VALUES (?, ?, ?, ?)'
  ).run(weekId, playlistId, maxPos + 1, intervalMs);
  return db.prepare('SELECT * FROM week_playlists WHERE id = ?').get(result.lastInsertRowid);
}

function removeWeekPlaylist(wpId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM week_playlists WHERE id = ?').get(wpId);
  if (!row) return;
  db.prepare('DELETE FROM week_playlists WHERE id = ?').run(wpId);
  const remaining = db.prepare(
    'SELECT id FROM week_playlists WHERE week_id = ? ORDER BY position'
  ).all(row.week_id);
  const update = db.prepare('UPDATE week_playlists SET position = ? WHERE id = ?');
  remaining.forEach((r, i) => update.run(i, r.id));
}

function moveWeekPlaylist(wpId, direction) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM week_playlists WHERE id = ?').get(wpId);
  if (!row) return;
  const items = db.prepare(
    'SELECT * FROM week_playlists WHERE week_id = ? ORDER BY position'
  ).all(row.week_id);
  const idx = items.findIndex(r => r.id === wpId);
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= items.length) return;
  const a = items[idx], b = items[swapIdx];
  db.prepare('UPDATE week_playlists SET position = ? WHERE id = ?').run(b.position, a.id);
  db.prepare('UPDATE week_playlists SET position = ? WHERE id = ?').run(a.position, b.id);
}

// ── Race Results ────────────────────────────────────────────────────────────

function insertRaceResult(raceId, pilotKey, displayName, position, bestLapMs, totalLaps, avgLapMs, weekId) {
  getDb().prepare(`
    INSERT OR REPLACE INTO race_results (race_id, pilot_key, display_name, position, best_lap_ms, total_laps, avg_lap_ms, week_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(raceId, pilotKey, displayName, position, bestLapMs, totalLaps, avgLapMs, weekId);
}

function getRaceResults(raceId) {
  return getDb().prepare(
    'SELECT * FROM race_results WHERE race_id = ? ORDER BY position'
  ).all(raceId);
}

function getRaceResultsWithPoints(raceId) {
  const db = getDb();
  const results = getRaceResults(raceId);
  for (const r of results) {
    r.points = db.prepare(
      'SELECT category, points, detail FROM weekly_points WHERE week_id = ? AND pilot_key = ? AND detail LIKE ?'
    ).all(r.week_id, r.pilot_key, `%${raceId}%`);
  }
  return results;
}

// ── Points ──────────────────────────────────────────────────────────────────

function awardPoints(weekId, pilotKey, category, points, detail = null) {
  getDb().prepare(`
    INSERT INTO weekly_points (week_id, pilot_key, category, points, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(weekId, pilotKey, category, points, detail ? JSON.stringify(detail) : null);
}

function getWeeklyPointsForPilot(weekId, pilotKey) {
  return getDb().prepare(
    'SELECT * FROM weekly_points WHERE week_id = ? AND pilot_key = ? ORDER BY awarded_at'
  ).all(weekId, pilotKey);
}

function getPointsByCategory(weekId) {
  return getDb().prepare(`
    SELECT pilot_key, category, SUM(points) AS total
    FROM weekly_points WHERE week_id = ?
    GROUP BY pilot_key, category
    ORDER BY total DESC
  `).all(weekId);
}

// ── Standings ───────────────────────────────────────────────────────────────

function refreshWeeklyStandings(weekId) {
  const db = getDb();
  const week = getWeekById(weekId);
  if (!week) return;

  // Aggregate points by pilot and category
  const pilots = db.prepare(`
    SELECT pilot_key,
      SUM(points) AS total_points,
      SUM(CASE WHEN category = 'race_position' THEN points ELSE 0 END) AS position_points,
      SUM(CASE WHEN category IN ('most_laps', 'lap_leader') THEN points ELSE 0 END) AS laps_points,
      SUM(CASE WHEN category = 'most_improved' OR category = 'personal_best' THEN points ELSE 0 END) AS improved_points,
      SUM(CASE WHEN category = 'consistency' THEN points ELSE 0 END) AS consistency_points,
      SUM(CASE WHEN category = 'participation' THEN points ELSE 0 END) AS participation_points,
      SUM(CASE WHEN category = 'hot_streak' THEN points ELSE 0 END) AS streak_points
    FROM weekly_points
    WHERE week_id = ?
    GROUP BY pilot_key
    ORDER BY total_points DESC
  `).all(weekId);

  // Get display names from most recent race_results
  const nameMap = {};
  const names = db.prepare(`
    SELECT pilot_key, display_name FROM race_results
    WHERE week_id = ? AND display_name IS NOT NULL
    ORDER BY id DESC
  `).all(weekId);
  for (const n of names) {
    if (!nameMap[n.pilot_key]) nameMap[n.pilot_key] = n.display_name;
  }

  // Also check weekly_points detail for display names from batch awards
  // (participation/improvement pilots might not have race_results yet)

  // Clear and rebuild standings
  db.prepare('DELETE FROM weekly_standings WHERE week_id = ?').run(weekId);

  const insert = db.prepare(`
    INSERT INTO weekly_standings
      (week_id, competition_id, pilot_key, display_name, total_points,
       position_points, laps_points, improved_points, consistency_points,
       participation_points, streak_points, rank, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  pilots.forEach((p, i) => {
    insert.run(
      weekId, week.competition_id, p.pilot_key,
      nameMap[p.pilot_key] || p.pilot_key,
      p.total_points, p.position_points, p.laps_points,
      p.improved_points, p.consistency_points,
      p.participation_points, p.streak_points,
      i + 1
    );
  });
}

function getWeeklyStandings(weekId) {
  return getDb().prepare(
    'SELECT * FROM weekly_standings WHERE week_id = ? ORDER BY rank ASC'
  ).all(weekId);
}

function getSeasonStandings(competitionId) {
  return getDb().prepare(`
    SELECT pilot_key, display_name,
      SUM(total_points) AS total_points,
      SUM(position_points) AS position_points,
      SUM(laps_points) AS laps_points,
      SUM(improved_points) AS improved_points,
      SUM(consistency_points) AS consistency_points,
      SUM(participation_points) AS participation_points,
      SUM(streak_points) AS streak_points,
      COUNT(DISTINCT week_id) AS weeks_active
    FROM weekly_standings
    WHERE competition_id = ?
    GROUP BY pilot_key
    ORDER BY total_points DESC
  `).all(competitionId);
}

function getPilotCompetitionHistory(competitionId, pilotKey) {
  const db = getDb();
  const weeklyStandings = db.prepare(`
    SELECT ws.*, cw.week_number, cw.starts_at, cw.ends_at
    FROM weekly_standings ws
    JOIN competition_weeks cw ON cw.id = ws.week_id
    WHERE ws.competition_id = ? AND ws.pilot_key = ?
    ORDER BY cw.week_number
  `).all(competitionId, pilotKey);

  const recentResults = db.prepare(`
    SELECT rr.*, r.env, r.track, r.started_at AS race_started_at
    FROM race_results rr
    JOIN races r ON r.id = rr.race_id
    JOIN competition_weeks cw ON cw.id = rr.week_id
    WHERE cw.competition_id = ? AND rr.pilot_key = ?
    ORDER BY r.started_at DESC
    LIMIT 50
  `).all(competitionId, pilotKey);

  return { weeklyStandings, recentResults };
}

// ── Scoring Helpers ─────────────────────────────────────────────────────────

function getRaceLapsGrouped(raceId) {
  return getDb().prepare(`
    SELECT
      COALESCE(steam_id, pilot_guid, nick) AS pilot_key,
      nick,
      MIN(lap_ms) AS best_lap_ms,
      COUNT(*) AS total_laps,
      AVG(lap_ms) AS avg_lap_ms
    FROM laps
    WHERE race_id = ?
    GROUP BY pilot_key
    HAVING total_laps >= 2
    ORDER BY best_lap_ms ASC
  `).all(raceId);
}

function getRaceLapsDetailed(raceId, pilotKey) {
  return getDb().prepare(`
    SELECT lap_ms FROM laps
    WHERE race_id = ? AND COALESCE(steam_id, pilot_guid, nick) = ?
    ORDER BY lap_number
  `).all(raceId, pilotKey).map(r => r.lap_ms);
}

function getPilotBaselineBests(pilotKey, beforeDate) {
  return getDb().prepare(`
    SELECT r.env, r.track, MIN(l.lap_ms) AS best_lap_ms
    FROM laps l
    JOIN races r ON r.id = l.race_id
    WHERE COALESCE(l.steam_id, l.pilot_guid, l.nick) = ?
      AND l.recorded_at < ?
      AND r.env IS NOT NULL AND r.track IS NOT NULL
    GROUP BY r.env, r.track
  `).all(pilotKey, beforeDate);
}

function getPilotWeekBests(pilotKey, startsAt, endsAt) {
  return getDb().prepare(`
    SELECT r.env, r.track, MIN(l.lap_ms) AS best_lap_ms
    FROM laps l
    JOIN races r ON r.id = l.race_id
    WHERE COALESCE(l.steam_id, l.pilot_guid, l.nick) = ?
      AND l.recorded_at >= ? AND l.recorded_at <= ?
      AND r.env IS NOT NULL AND r.track IS NOT NULL
    GROUP BY r.env, r.track
  `).all(pilotKey, startsAt, endsAt);
}

function getWeekPilots(weekId) {
  const week = getWeekById(weekId);
  if (!week) return [];
  return getDb().prepare(`
    SELECT DISTINCT COALESCE(l.steam_id, l.pilot_guid, l.nick) AS pilot_key, l.nick
    FROM laps l
    JOIN races r ON r.id = l.race_id
    WHERE l.recorded_at >= ? AND l.recorded_at <= ?
  `).all(week.starts_at, week.ends_at);
}

function getPilotActiveDays(pilotKey, startsAt, endsAt) {
  return getDb().prepare(`
    SELECT COUNT(DISTINCT date(l.recorded_at)) AS day_count
    FROM laps l
    WHERE COALESCE(l.steam_id, l.pilot_guid, l.nick) = ?
      AND l.recorded_at >= ? AND l.recorded_at <= ?
  `).get(pilotKey, startsAt, endsAt).day_count;
}

function getPilotDistinctTracks(pilotKey, startsAt, endsAt) {
  return getDb().prepare(`
    SELECT COUNT(DISTINCT r.env || '|' || r.track) AS track_count
    FROM laps l
    JOIN races r ON r.id = l.race_id
    WHERE COALESCE(l.steam_id, l.pilot_guid, l.nick) = ?
      AND l.recorded_at >= ? AND l.recorded_at <= ?
      AND r.env IS NOT NULL AND r.track IS NOT NULL
  `).get(pilotKey, startsAt, endsAt).track_count;
}

function hasRaceResults(raceId) {
  return getDb().prepare(
    'SELECT COUNT(*) AS n FROM race_results WHERE race_id = ?'
  ).get(raceId).n > 0;
}

module.exports = {
  // Competitions
  createCompetition,
  getCompetitions,
  getActiveCompetition,
  archiveCompetition,
  // Weeks
  createWeek,
  generateWeeks,
  getWeeks,
  getWeekById,
  getActiveWeek,
  getNextScheduledWeek,
  getOverdueActiveWeek,
  updateWeekStatus,
  getCurrentWeekInfo,
  // Week playlists
  getWeekPlaylists,
  addWeekPlaylist,
  removeWeekPlaylist,
  moveWeekPlaylist,
  // Race results
  insertRaceResult,
  getRaceResults,
  getRaceResultsWithPoints,
  // Points
  awardPoints,
  getWeeklyPointsForPilot,
  getPointsByCategory,
  // Standings
  refreshWeeklyStandings,
  getWeeklyStandings,
  getSeasonStandings,
  getPilotCompetitionHistory,
  // Scoring helpers
  getRaceLapsGrouped,
  getRaceLapsDetailed,
  getPilotBaselineBests,
  getPilotWeekBests,
  getWeekPilots,
  getPilotActiveDays,
  getPilotDistinctTracks,
  hasRaceResults,
};
