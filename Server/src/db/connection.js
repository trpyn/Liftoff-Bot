const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './competition.db';

let db;

function getDb() {
  if (!db) throw new Error('Database not initialised. Call initDatabase() first.');
  return db;
}

function initDatabase() {
  db = new DatabaseSync(path.resolve(DB_PATH));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      started_at  TEXT NOT NULL,
      plugin_ver  TEXT
    );

    CREATE TABLE IF NOT EXISTS races (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      ordinal         INTEGER NOT NULL,
      started_at      TEXT NOT NULL,
      ended_at        TEXT,
      winner_actor    INTEGER,
      winner_nick     TEXT,
      winner_total_ms INTEGER,
      participants    INTEGER DEFAULT 0,
      completed       INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS laps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id     TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      actor       INTEGER NOT NULL,
      nick        TEXT,
      pilot_guid  TEXT,
      steam_id    TEXT,
      lap_number  INTEGER NOT NULL,
      lap_ms      INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (race_id) REFERENCES races(id)
    );

    CREATE TABLE IF NOT EXISTS track_catalog (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      recorded_at  TEXT NOT NULL,
      catalog_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_templates (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger   TEXT NOT NULL,
      template  TEXT NOT NULL,
      enabled   INTEGER NOT NULL DEFAULT 1,
      delay_ms  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL,
      position    INTEGER NOT NULL,
      env         TEXT NOT NULL DEFAULT '',
      track       TEXT NOT NULL DEFAULT '',
      race        TEXT NOT NULL DEFAULT '',
      workshop_id TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_laps_race    ON laps(race_id);
    CREATE INDEX IF NOT EXISTS idx_laps_race_recorded ON laps(race_id, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_laps_guid    ON laps(pilot_guid);
    CREATE INDEX IF NOT EXISTS idx_races_session ON races(session_id);

    -- Competition system tables
    CREATE TABLE IF NOT EXISTS competitions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competition_weeks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      competition_id  INTEGER NOT NULL,
      week_number     INTEGER NOT NULL,
      starts_at       TEXT NOT NULL,
      ends_at         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'scheduled',
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (competition_id) REFERENCES competitions(id),
      UNIQUE(competition_id, week_number)
    );

    CREATE TABLE IF NOT EXISTS week_playlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id     INTEGER NOT NULL,
      playlist_id INTEGER NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      interval_ms INTEGER NOT NULL DEFAULT 900000,
      FOREIGN KEY (week_id) REFERENCES competition_weeks(id) ON DELETE CASCADE,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id)
    );

    CREATE TABLE IF NOT EXISTS race_results (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id      TEXT NOT NULL,
      pilot_key    TEXT NOT NULL,
      display_name TEXT,
      position     INTEGER NOT NULL,
      best_lap_ms  INTEGER NOT NULL,
      total_laps   INTEGER NOT NULL,
      avg_lap_ms   INTEGER,
      week_id      INTEGER,
      FOREIGN KEY (race_id) REFERENCES races(id),
      UNIQUE(race_id, pilot_key)
    );

    CREATE TABLE IF NOT EXISTS weekly_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id     INTEGER NOT NULL,
      pilot_key   TEXT NOT NULL,
      category    TEXT NOT NULL,
      points      INTEGER NOT NULL DEFAULT 0,
      detail      TEXT,
      awarded_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (week_id) REFERENCES competition_weeks(id)
    );

    CREATE TABLE IF NOT EXISTS weekly_standings (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id              INTEGER NOT NULL,
      competition_id       INTEGER NOT NULL,
      pilot_key            TEXT NOT NULL,
      display_name         TEXT NOT NULL,
      total_points         INTEGER NOT NULL DEFAULT 0,
      position_points      INTEGER NOT NULL DEFAULT 0,
      laps_points          INTEGER NOT NULL DEFAULT 0,
      improved_points      INTEGER NOT NULL DEFAULT 0,
      consistency_points   INTEGER NOT NULL DEFAULT 0,
      participation_points INTEGER NOT NULL DEFAULT 0,
      streak_points        INTEGER NOT NULL DEFAULT 0,
      rank                 INTEGER,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (week_id) REFERENCES competition_weeks(id),
      UNIQUE(week_id, pilot_key)
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_weekly_points_week_pilot ON weekly_points(week_id, pilot_key);
    CREATE INDEX IF NOT EXISTS idx_race_results_week ON race_results(week_id);
    CREATE INDEX IF NOT EXISTS idx_race_results_pilot ON race_results(pilot_key);
    CREATE INDEX IF NOT EXISTS idx_comp_weeks_dates ON competition_weeks(starts_at, ends_at);
    CREATE INDEX IF NOT EXISTS idx_laps_steam ON laps(steam_id);
  `);

  // Migrations — safe to run repeatedly
  try { db.exec(`ALTER TABLE laps ADD COLUMN steam_id TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE races ADD COLUMN env TEXT`); } catch (_) {}
  try { db.exec(`ALTER TABLE races ADD COLUMN track TEXT`); } catch (_) {}

  console.log(`[db] Database ready at ${path.resolve(DB_PATH)}`);
  return db;
}

module.exports = { initDatabase, getDb };
