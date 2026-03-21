const { getDb } = require('./connection');

// Lazy-loaded to avoid circular dependency (scoring → database → ingest → scoring)
let _processRaceClose = null;
function getProcessRaceClose() {
  if (!_processRaceClose) _processRaceClose = require('../competitionScoring').processRaceClose;
  return _processRaceClose;
}

function handleSessionStarted(event) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sessions (id, started_at, plugin_ver)
    VALUES (@id, @started_at, @plugin_ver)
  `);
  stmt.run({
    id: event.session_id,
    started_at: event.timestamp_utc,
    plugin_ver: event.version || null,
  });
}

function handleRaceReset(event, currentTrack = {}) {
  const db = getDb();

  // Close any open races for this session and populate results from laps
  const openRaces = db.prepare(`
    SELECT id FROM races
    WHERE session_id = @session_id AND ended_at IS NULL AND id != @id
  `).all({
    session_id: event.session_id,
    id: event.race_id,
  });

  for (const race of openRaces) {
    const participants = db.prepare(`
      SELECT COUNT(DISTINCT actor) AS cnt FROM laps WHERE race_id = ?
    `).get(race.id)?.cnt || 0;

    const winner = participants > 0 ? db.prepare(`
      SELECT actor, nick, MIN(lap_ms) AS best_ms
      FROM laps WHERE race_id = ?
      GROUP BY actor ORDER BY best_ms ASC LIMIT 1
    `).get(race.id) : null;

    db.prepare(`
      UPDATE races
      SET ended_at        = @ended_at,
          winner_actor    = COALESCE(winner_actor, @winner_actor),
          winner_nick     = COALESCE(winner_nick, @winner_nick),
          winner_total_ms = COALESCE(winner_total_ms, @winner_total_ms),
          participants    = CASE WHEN participants > 0 THEN participants ELSE @participants END,
          completed       = CASE WHEN completed > 0 THEN completed ELSE @completed END
      WHERE id = @id
    `).run({
      id: race.id,
      ended_at: event.timestamp_utc,
      winner_actor: winner?.actor ?? null,
      winner_nick: winner?.nick ?? null,
      winner_total_ms: winner?.best_ms ?? null,
      participants,
      completed: participants,
    });

    // Competition scoring — award points for this race if a competition week is active
    try { getProcessRaceClose()(race.id); } catch (err) {
      console.error('[competition] Scoring error for race', race.id, err.message);
    }
  }

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO races (id, session_id, ordinal, started_at, env, track)
    VALUES (@id, @session_id, @ordinal, @started_at, @env, @track)
  `);
  stmt.run({
    id: event.race_id,
    session_id: event.session_id,
    ordinal: event.race_ordinal,
    started_at: event.timestamp_utc,
    env: currentTrack.env || null,
    track: currentTrack.track || null,
  });
}

function handleLapRecorded(event, currentTrack = {}) {
  const db = getDb();
  ensureRaceExists(event);
  if (currentTrack.env && currentTrack.track) {
    db.prepare(`
      UPDATE races SET env = ?, track = ? WHERE id = ? AND env IS NULL
    `).run(currentTrack.env, currentTrack.track, event.race_id);
  }
  const stmt = db.prepare(`
    INSERT INTO laps (race_id, session_id, actor, nick, pilot_guid, steam_id, lap_number, lap_ms, recorded_at)
    VALUES (@race_id, @session_id, @actor, @nick, @pilot_guid, @steam_id, @lap_number, @lap_ms, @recorded_at)
  `);
  stmt.run({
    race_id: event.race_id,
    session_id: event.session_id,
    actor: event.actor,
    nick: event.nick || null,
    pilot_guid: event.pilot_guid || null,
    steam_id: event.steam_id || null,
    lap_number: event.lap_number,
    lap_ms: event.lap_ms,
    recorded_at: event.timestamp_utc,
  });
}

function handleRaceEnd(event) {
  const db = getDb();
  ensureRaceExists(event);
  const stmt = db.prepare(`
    UPDATE races
    SET ended_at        = @ended_at,
        winner_actor    = @winner_actor,
        winner_nick     = @winner_nick,
        winner_total_ms = @winner_total_ms,
        participants    = @participants,
        completed       = @completed
    WHERE id = @id
  `);
  stmt.run({
    id: event.race_id,
    ended_at: event.timestamp_utc,
    winner_actor: event.winner_actor || null,
    winner_nick: event.winner_nick || null,
    winner_total_ms: event.winner_total_ms || null,
    participants: event.participants || 0,
    completed: event.completed || 0,
  });
}

function handleTrackCatalog(event) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO track_catalog (session_id, recorded_at, catalog_json)
    VALUES (@session_id, @recorded_at, @catalog_json)
  `);
  stmt.run({
    session_id: event.session_id,
    recorded_at: event.timestamp_utc,
    catalog_json: JSON.stringify(event),
  });
}

function ensureRaceExists(event) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO sessions (id, started_at, plugin_ver)
    VALUES (@id, @started_at, @plugin_ver)
  `).run({
    id: event.session_id,
    started_at: event.timestamp_utc,
    plugin_ver: event.version || null,
  });

  db.prepare(`
    INSERT OR IGNORE INTO races (id, session_id, ordinal, started_at)
    VALUES (@id, @session_id, @ordinal, @started_at)
  `).run({
    id: event.race_id,
    session_id: event.session_id,
    ordinal: event.race_ordinal || 0,
    started_at: event.timestamp_utc,
  });
}

module.exports = {
  handleSessionStarted,
  handleRaceReset,
  handleLapRecorded,
  handleRaceEnd,
  handleTrackCatalog,
};
