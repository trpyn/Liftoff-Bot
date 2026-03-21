/**
 * Competition Scoring Engine
 *
 * Handles real-time per-race scoring (called on each race close) and
 * batch scoring at week finalisation (most improved, participation).
 */

const db = require('./database');
const broadcast = require('./broadcast');

// F1-style position points
const POSITION_POINTS = [25, 18, 15, 12, 10, 8, 6, 4];

// ── Real-time scoring (per race close) ──────────────────────────────────────

function processRaceClose(raceId) {
  const week = db.getActiveWeek();
  if (!week) return;

  // Avoid double-processing
  if (db.hasRaceResults(raceId)) return;

  const race = db.getRaceById(raceId);
  if (!race) return;

  // Check race falls within the active week
  if (race.started_at < week.starts_at || race.started_at > week.ends_at) return;

  const pilots = db.getRaceLapsGrouped(raceId);
  if (pilots.length === 0) return;

  const participantCount = pilots.length;
  const awards = [];

  // Determine point scale based on participant count
  let positionScale = 1.0;
  let awardPositionPoints = true;
  if (participantCount < 2) {
    awardPositionPoints = false;
  } else if (participantCount < 3) {
    positionScale = 0.5;
  }

  // Insert race results and award position points
  for (let i = 0; i < pilots.length; i++) {
    const pilot = pilots[i];
    const position = i + 1;

    db.insertRaceResult(
      raceId, pilot.pilot_key, pilot.nick, position,
      pilot.best_lap_ms, pilot.total_laps,
      Math.round(pilot.avg_lap_ms), week.id
    );

    // Position points
    if (awardPositionPoints && i < POSITION_POINTS.length) {
      const pts = Math.floor(POSITION_POINTS[i] * positionScale);
      if (pts > 0) {
        db.awardPoints(week.id, pilot.pilot_key, 'race_position', pts, {
          position, race_id: raceId, participants: participantCount,
        });
        awards.push({ pilot_key: pilot.pilot_key, display_name: pilot.nick, category: 'race_position', points: pts, detail: ordinal(position) + ' place' });
      }
    }

    // Lap volume points: 1 per 5 laps, capped at 10
    const lapPts = Math.min(Math.floor(pilot.total_laps / 5), 10);
    if (lapPts > 0) {
      db.awardPoints(week.id, pilot.pilot_key, 'most_laps', lapPts, {
        total_laps: pilot.total_laps, race_id: raceId,
      });
      awards.push({ pilot_key: pilot.pilot_key, display_name: pilot.nick, category: 'most_laps', points: lapPts, detail: `${pilot.total_laps} laps` });
    }
  }

  // Lap leader bonus (5 points, requires 3+ participants)
  if (participantCount >= 3) {
    const lapLeader = pilots.reduce((max, p) => p.total_laps > max.total_laps ? p : max);
    db.awardPoints(week.id, lapLeader.pilot_key, 'lap_leader', 5, {
      reason: 'lap_leader', total_laps: lapLeader.total_laps, race_id: raceId,
    });
    awards.push({ pilot_key: lapLeader.pilot_key, display_name: lapLeader.nick, category: 'lap_leader', points: 5, detail: 'Most laps' });
  }

  // Hot streak: fastest lap bonus (3 points, requires 3+ participants)
  if (participantCount >= 3) {
    const fastest = pilots[0]; // already sorted by best_lap_ms ASC
    db.awardPoints(week.id, fastest.pilot_key, 'hot_streak', 3, {
      reason: 'fastest_lap', best_lap_ms: fastest.best_lap_ms, race_id: raceId,
    });
    awards.push({ pilot_key: fastest.pilot_key, display_name: fastest.nick, category: 'hot_streak', points: 3, detail: 'Fastest lap' });
  }

  // Consistency points
  calculateConsistencyPoints(raceId, pilots, week.id, awards);

  // Refresh standings
  db.refreshWeeklyStandings(week.id);

  // Broadcast updates
  const standings = db.getWeeklyStandings(week.id);

  broadcast.broadcastAll({
    event_type: 'competition_points_awarded',
    race_id: raceId,
    awards: awards.map(a => ({
      pilot_key: a.pilot_key,
      display_name: a.display_name,
      category: a.category,
      points: a.points,
      detail: a.detail,
    })),
  });

  broadcast.broadcastAll({
    event_type: 'competition_standings_update',
    week_id: week.id,
    standings: standings.map(s => ({
      rank: s.rank,
      display_name: s.display_name,
      total_points: s.total_points,
      position_points: s.position_points,
      laps_points: s.laps_points,
      consistency_points: s.consistency_points,
      streak_points: s.streak_points,
    })),
  });
}

// ── Consistency calculation ─────────────────────────────────────────────────

function calculateConsistencyPoints(raceId, pilots, weekId, awards) {
  if (pilots.length < 2) return;

  const deviations = [];
  for (const pilot of pilots) {
    const lapTimes = db.getRaceLapsDetailed(raceId, pilot.pilot_key);
    if (lapTimes.length < 3) continue;

    // Drop worst 20% of laps
    const sorted = [...lapTimes].sort((a, b) => a - b);
    const keepCount = Math.ceil(sorted.length * 0.8);
    const kept = sorted.slice(0, keepCount);

    const mean = kept.reduce((a, b) => a + b, 0) / kept.length;
    const variance = kept.reduce((sum, t) => sum + (t - mean) ** 2, 0) / kept.length;
    const stddev = Math.sqrt(variance);

    deviations.push({ pilot_key: pilot.pilot_key, nick: pilot.nick, stddev });
  }

  if (deviations.length < 2) return;

  // Find median stddev
  const sortedDevs = [...deviations].sort((a, b) => a.stddev - b.stddev);
  const midIdx = Math.floor(sortedDevs.length / 2);
  const medianDev = sortedDevs.length % 2 === 0
    ? (sortedDevs[midIdx - 1].stddev + sortedDevs[midIdx].stddev) / 2
    : sortedDevs[midIdx].stddev;

  for (const d of deviations) {
    if (d.stddev <= medianDev) {
      db.awardPoints(weekId, d.pilot_key, 'consistency', 3, {
        stddev: Math.round(d.stddev), median: Math.round(medianDev), race_id: raceId,
      });
      awards.push({ pilot_key: d.pilot_key, display_name: d.nick, category: 'consistency', points: 3, detail: 'Consistent flyer' });
    }
  }
}

// ── Batch scoring (week finalisation) ───────────────────────────────────────

function finaliseWeek(weekId) {
  const week = db.getWeekById(weekId);
  if (!week) return;

  calculateMostImproved(weekId, week);
  calculateParticipation(weekId, week);

  db.refreshWeeklyStandings(weekId);
  db.updateWeekStatus(weekId, 'finalised');

  broadcast.broadcastAll({
    event_type: 'competition_week_finalised',
    week_id: weekId,
    standings: db.getWeeklyStandings(weekId).map(s => ({
      rank: s.rank,
      display_name: s.display_name,
      total_points: s.total_points,
    })),
  });
}

function calculateMostImproved(weekId, week) {
  const pilots = db.getWeekPilots(weekId);
  const improvements = [];

  for (const pilot of pilots) {
    const baselines = db.getPilotBaselineBests(pilot.pilot_key, week.starts_at);
    const weekBests = db.getPilotWeekBests(pilot.pilot_key, week.starts_at, week.ends_at);

    if (baselines.length === 0 || weekBests.length === 0) continue;

    const baselineMap = {};
    for (const b of baselines) baselineMap[`${b.env}|${b.track}`] = b.best_lap_ms;

    let totalImprovement = 0;
    let trackCount = 0;
    let personalBests = 0;

    for (const wb of weekBests) {
      const key = `${wb.env}|${wb.track}`;
      const baseline = baselineMap[key];
      if (!baseline) continue;

      if (wb.best_lap_ms < baseline) {
        const pctImprove = ((baseline - wb.best_lap_ms) / baseline) * 100;
        totalImprovement += pctImprove;
        trackCount++;
        personalBests++;
      }
    }

    // Award personal best points (3 per track)
    if (personalBests > 0) {
      db.awardPoints(weekId, pilot.pilot_key, 'personal_best', personalBests * 3, {
        tracks_improved: personalBests,
      });
    }

    if (trackCount > 0) {
      improvements.push({
        pilot_key: pilot.pilot_key,
        nick: pilot.nick,
        avg_improvement: totalImprovement / trackCount,
        tracks_improved: trackCount,
      });
    }
  }

  // Top 3 most improved by average percentage
  improvements.sort((a, b) => b.avg_improvement - a.avg_improvement);
  const topRewards = [15, 10, 5];
  for (let i = 0; i < Math.min(3, improvements.length); i++) {
    const imp = improvements[i];
    db.awardPoints(weekId, imp.pilot_key, 'most_improved', topRewards[i], {
      rank: i + 1,
      avg_improvement_pct: Math.round(imp.avg_improvement * 100) / 100,
      tracks_improved: imp.tracks_improved,
    });
  }
}

function calculateParticipation(weekId, week) {
  const pilots = db.getWeekPilots(weekId);

  for (const pilot of pilots) {
    const dayCount = db.getPilotActiveDays(pilot.pilot_key, week.starts_at, week.ends_at);
    const trackCount = db.getPilotDistinctTracks(pilot.pilot_key, week.starts_at, week.ends_at);

    let pts = 0;
    if (dayCount >= 7) pts = 30;
    else if (dayCount >= 5) pts = 20;
    else if (dayCount >= 3) pts = 10;

    // Track variety bonus
    if (trackCount >= 3) pts += 5;

    if (pts > 0) {
      db.awardPoints(weekId, pilot.pilot_key, 'participation', pts, {
        days_active: dayCount,
        tracks_flown: trackCount,
      });
    }
  }
}

// ── Recalculate (admin tool) ────────────────────────────────────────────────

function recalculateWeek(weekId) {
  const week = db.getWeekById(weekId);
  if (!week) throw new Error('Week not found');

  // Clear existing points and results for this week
  const { getDb } = require('./db/connection');
  const conn = getDb();
  conn.prepare('DELETE FROM weekly_points WHERE week_id = ?').run(weekId);
  conn.prepare('DELETE FROM race_results WHERE week_id = ?').run(weekId);
  conn.prepare('DELETE FROM weekly_standings WHERE week_id = ?').run(weekId);

  // Find all races within this week's time range
  const races = conn.prepare(`
    SELECT id FROM races
    WHERE started_at >= ? AND started_at <= ? AND ended_at IS NOT NULL
    ORDER BY started_at
  `).all(week.starts_at, week.ends_at);

  // Temporarily set week as active for processRaceClose
  const originalStatus = week.status;
  db.updateWeekStatus(weekId, 'active');

  for (const race of races) {
    processRaceClose(race.id);
  }

  // Run batch calculations
  calculateMostImproved(weekId, week);
  calculateParticipation(weekId, week);
  db.refreshWeeklyStandings(weekId);

  // Restore original status
  db.updateWeekStatus(weekId, originalStatus);

  return { races_processed: races.length, standings: db.getWeeklyStandings(weekId) };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = {
  processRaceClose,
  finaliseWeek,
  recalculateWeek,
};
