const { Router } = require('express');
const db = require('../database');
const { getPluginSocket } = require('../pluginSocket');
const { getCurrentTrack, getOnlinePlayers, getCurrentTrackSince } = require('../state');

const router = Router();

/**
 * GET /api/races
 * Recent races. Query: ?limit=50&offset=0
 */
router.get('/races', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  res.json(db.getRaces({ limit, offset }));
});

/**
 * GET /api/races/:id
 * Single race with all laps.
 */
router.get('/races/:id', (req, res) => {
  const race = db.getRaceById(req.params.id);
  if (!race) return res.status(404).json({ error: 'Race not found' });
  res.json(race);
});

/**
 * GET /api/leaderboard
 * Best lap per pilot across all races.
 */
router.get('/leaderboard', (req, res) => {
  res.json(db.getBestLaps());
});

/**
 * GET /api/leaderboard/track?env=X&track=Y
 * Best lap per pilot for a specific env+track combination.
 */
router.get('/leaderboard/track', (req, res) => {
  const { env, track } = req.query;
  if (!env || !track) return res.status(400).json({ error: 'env and track query params required' });
  res.json(db.getBestLapsByTrack(env, track));
});

/**
 * GET /api/players
 * All-time stats per pilot: best lap, total laps, races entered.
 */
router.get('/players', (req, res) => {
  res.json(db.getPlayerStats());
});

/**
 * GET /api/status
 * Plugin connection status + latest race summary.
 */
router.get('/status', (req, res) => {
  const socket = getPluginSocket();
  const race = db.getLatestRaceWithLaps();
  res.json({
    plugin_connected: socket !== null && socket.readyState === 1,
    current_track: getCurrentTrack(),
    track_since: getCurrentTrackSince(),
    latest_race: race,
    online_players: getOnlinePlayers(),
  });
});

/**
 * GET /api/pilot-activity
 * Unique pilot counts for the last 24h, 7 days, and 30 days.
 */
router.get('/pilot-activity', (req, res) => {
  res.json(db.getPilotActivity());
});

/**
 * GET /api/catalog
 * Most recently received track catalog from the plugin.
 */
router.get('/catalog', (req, res) => {
  const catalog = db.getLatestCatalog();
  if (!catalog) return res.status(404).json({ error: 'No catalog received yet' });
  res.json(catalog);
});

/**
 * GET /api/players/online-stats?nicks=Nick1,Nick2
 * All-time stats for currently online players.
 */
router.get('/players/online-stats', (req, res) => {
  const raw = req.query.nicks || '';
  const nicks = raw.split(',').map(n => n.trim()).filter(Boolean);
  res.json(db.getAllTimeStatsByNick(nicks));
});

/**
 * GET /api/laps/browse
 * Paginated lap browser with optional filters.
 * Query: ?env=X&track=Y&nick=Z&dateFrom=...&dateTo=...&limit=50&offset=0
 */
router.get('/laps/browse', (req, res) => {
  const { env, track, nick, dateFrom, dateTo } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  res.json(db.browseLaps({ env, track, nick, dateFrom, dateTo, limit, offset }));
});

/**
 * GET /api/filters
 * Distinct filter values for the data browser dropdowns.
 */
router.get('/filters', (req, res) => {
  res.json(db.getFilterOptions());
});

/**
 * GET /api/stats/overview
 * Summary totals for the stats page header.
 */
router.get('/stats/overview', (req, res) => {
  res.json(db.getOverallStats());
});

// ── Competition (public) ────────────────────────────────────────────────────

/**
 * GET /api/competition/current
 * Active competition + current week info.
 */
router.get('/competition/current', (req, res) => {
  const comp = db.getActiveCompetition();
  if (!comp) return res.json({ competition: null, current_week: null });
  const weeks = db.getWeeks(comp.id);
  const currentWeek = weeks.find(w => w.status === 'active') || null;
  const nextWeek = weeks.find(w => w.status === 'scheduled') || null;
  res.json({ competition: comp, current_week: currentWeek, next_week: nextWeek });
});

/**
 * GET /api/competition/standings
 * Current week standings.
 */
router.get('/competition/standings', (req, res) => {
  const week = db.getActiveWeek();
  if (!week) return res.json([]);
  res.json(db.getWeeklyStandings(week.id));
});

/**
 * GET /api/competition/standings/:weekId
 * Standings for a specific week.
 */
router.get('/competition/standings/:weekId', (req, res) => {
  res.json(db.getWeeklyStandings(Number(req.params.weekId)));
});

/**
 * GET /api/competition/season
 * Season-long aggregated standings for the active competition.
 */
router.get('/competition/season', (req, res) => {
  const comp = db.getActiveCompetition();
  if (!comp) return res.json([]);
  res.json(db.getSeasonStandings(comp.id));
});

/**
 * GET /api/competition/weeks
 * All weeks for the active competition.
 */
router.get('/competition/weeks', (req, res) => {
  const comp = db.getActiveCompetition();
  if (!comp) return res.json([]);
  res.json(db.getWeeks(comp.id));
});

/**
 * GET /api/competition/pilot/:pilotKey
 * Individual pilot's competition history.
 */
router.get('/competition/pilot/:pilotKey', (req, res) => {
  const comp = db.getActiveCompetition();
  if (!comp) return res.json({ weeklyStandings: [], recentResults: [] });
  res.json(db.getPilotCompetitionHistory(comp.id, decodeURIComponent(req.params.pilotKey)));
});

/**
 * GET /api/competition/race/:raceId/results
 * Race results with points awarded.
 */
router.get('/competition/race/:raceId/results', (req, res) => {
  res.json(db.getRaceResultsWithPoints(req.params.raceId));
});

module.exports = router;
