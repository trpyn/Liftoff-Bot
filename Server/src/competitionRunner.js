/**
 * Competition Runner
 *
 * Manages the weekly competition lifecycle:
 * - Activates scheduled weeks when their start time arrives
 * - Finalises active weeks when their end time passes
 * - Orchestrates playlist rotation within a week (multiple playlists back-to-back)
 * - Auto-starts playlists on week activation
 * - **Resumes at the correct position after server reboot** using deterministic
 *   time-based calculation (no persisted state needed)
 * - Verifies the in-game track matches what should be playing and corrects it
 *
 * Runs a 60-second interval check. Does not modify playlistRunner internals —
 * it orchestrates from above using startPlaylist/resumePlaylist/stopPlaylist/getState.
 */

const db = require('./database');
const playlistRunner = require('./playlistRunner');
const broadcast = require('./broadcast');
const { getCurrentTrack } = require('./state');
const { finaliseWeek } = require('./competitionScoring');

const CHECK_INTERVAL = 60_000; // 60 seconds

const state = {
  running: false,
  autoManaged: false,       // true when competition runner controls playlists
  currentWeekId: null,
  currentPlaylistIndex: 0,  // index into week_playlists for current week
  weekPlaylists: [],        // cached week_playlists rows
};

let _timer = null;
let _playlistWrapDetected = false;

function _persistState() {
  try {
    db.saveRunnerState(state);
  } catch (err) {
    console.error('[competition] Failed to persist state:', err.message);
  }
}

function _restoreState() {
  try {
    const saved = db.loadRunnerState();
    if (saved.autoManaged) {
      state.autoManaged = true;
      state.currentWeekId = saved.currentWeekId;
      state.currentPlaylistIndex = saved.currentPlaylistIndex;
      console.log('[competition] Restored state from DB: auto_managed=true, week_id=' + saved.currentWeekId);
    }
  } catch (err) {
    console.error('[competition] Failed to restore state:', err.message);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

function start() {
  if (_timer) return;

  // Restore persisted state before first tick
  _restoreState();

  _timer = setInterval(tick, CHECK_INTERVAL);
  console.log('[competition] Runner started (checking every 60s)');

  // Run an immediate check on startup
  tick();
}

function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  state.running = false;
  state.autoManaged = false;
  _persistState();
  console.log('[competition] Runner stopped');
}

function getState() {
  return {
    running: state.running,
    auto_managed: state.autoManaged,
    current_week_id: state.currentWeekId,
    current_playlist_index: state.currentPlaylistIndex,
    playlist_count: state.weekPlaylists.length,
    current_week_playlist: state.weekPlaylists[state.currentPlaylistIndex] || null,
  };
}

function setAutoManaged(enabled) {
  state.autoManaged = enabled;
  if (enabled && state.currentWeekId) {
    const weekPlaylists = db.getWeekPlaylists(state.currentWeekId);
    if (weekPlaylists.length > 0) {
      state.weekPlaylists = weekPlaylists;
      const week = db.getWeekById(state.currentWeekId);
      if (week) {
        resumeFromCalculatedPosition(week, weekPlaylists);
      }
    }
  }
  _persistState();
  _broadcastState();
}

// ── Deterministic position calculation ──────────────────────────────────────
//
// Given the week start time and the playlist schedule, we can calculate exactly
// which playlist and track should be playing right now. This means no state needs
// to be persisted — after a reboot we just recalculate from the clock.

/**
 * Calculate where the playlist rotation should be right now.
 *
 * @param {Object[]} weekPlaylists - Rows from week_playlists (with track counts loaded)
 * @param {string} weekStartsAt - ISO datetime when the week started
 * @returns {{ playlistIndex, trackIndex, remainingMs, expectedTrack }} or null
 */
function calculateCurrentPosition(weekPlaylists, weekStartsAt) {
  if (weekPlaylists.length === 0) return null;

  // Load track counts for each playlist
  const playlistInfo = weekPlaylists.map(wp => {
    const tracks = db.getPlaylistTracks(wp.playlist_id);
    const trackCount = tracks.length;
    const cycleDurationMs = trackCount * wp.interval_ms; // time for one full pass of this playlist
    return { ...wp, tracks, trackCount, cycleDurationMs };
  });

  // Total time for one complete rotation through ALL playlists
  const totalCycleMs = playlistInfo.reduce((sum, p) => sum + p.cycleDurationMs, 0);
  if (totalCycleMs === 0) return null;

  const elapsedMs = Date.now() - new Date(weekStartsAt).getTime();
  if (elapsedMs < 0) return null; // week hasn't started yet

  // Position within the current rotation cycle
  const positionInCycle = elapsedMs % totalCycleMs;

  // Walk through playlists to find which one we're in
  let accumulated = 0;
  for (let pi = 0; pi < playlistInfo.length; pi++) {
    const p = playlistInfo[pi];
    if (p.trackCount === 0) continue;

    if (accumulated + p.cycleDurationMs > positionInCycle) {
      // We're in this playlist
      const positionInPlaylist = positionInCycle - accumulated;
      const trackIndex = Math.floor(positionInPlaylist / p.interval_ms);
      const elapsedInTrack = positionInPlaylist - (trackIndex * p.interval_ms);
      const remainingMs = p.interval_ms - elapsedInTrack;

      const clampedIndex = Math.min(trackIndex, p.trackCount - 1);
      return {
        playlistIndex: pi,
        trackIndex: clampedIndex,
        remainingMs: Math.max(1000, remainingMs),
        expectedTrack: p.tracks[clampedIndex] || null,
        playlistId: p.playlist_id,
        intervalMs: p.interval_ms,
      };
    }
    accumulated += p.cycleDurationMs;
  }

  // Shouldn't reach here, but fall back to first playlist, first track
  const first = playlistInfo[0];
  return {
    playlistIndex: 0,
    trackIndex: 0,
    remainingMs: first.cycleDurationMs,
    expectedTrack: first.tracks[0] || null,
    playlistId: first.playlist_id,
    intervalMs: first.interval_ms,
  };
}

// ── Playlist wrap detection ─────────────────────────────────────────────────

/**
 * Called by the playlist state broadcast listener to detect when a playlist
 * wraps back to index 0 (meaning it completed a full cycle).
 */
function onPlaylistStateChange(playlistState) {
  if (!state.autoManaged || !state.running) return;
  if (!playlistState.running) return;

  // Detect wrap: playlist current_index went to 0 and we have multiple playlists
  if (playlistState.current_index === 0 && state.weekPlaylists.length > 1 && _playlistWrapDetected) {
    _playlistWrapDetected = false;
    advanceToNextPlaylist();
  }

  // Track when we're at the last track (next advance will wrap to 0)
  if (playlistState.current_index === playlistState.track_count - 1) {
    _playlistWrapDetected = true;
  }
}

// ── Core tick ───────────────────────────────────────────────────────────────

function tick() {
  try {
    // Check for overdue active weeks that need finalisation
    const overdue = db.getOverdueActiveWeek();
    if (overdue) {
      console.log(`[competition] Finalising week ${overdue.week_number} (${overdue.competition_name})`);
      finaliseWeek(overdue.id);

      if (state.currentWeekId === overdue.id) {
        state.currentWeekId = null;
        state.weekPlaylists = [];
        state.currentPlaylistIndex = 0;
      }
    }

    // Check for scheduled weeks that should now be active
    const ready = db.getNextScheduledWeek();
    if (ready) {
      activateWeek(ready);
    }

    // If we have an active week, make sure state is current
    const active = db.getActiveWeek();
    if (active) {
      state.running = true;
      state.currentWeekId = active.id;

      // If auto-managed and no playlist is running, resume at the calculated position
      if (state.autoManaged && !playlistRunner.getState().running) {
        const weekPlaylists = db.getWeekPlaylists(active.id);
        if (weekPlaylists.length > 0) {
          state.weekPlaylists = weekPlaylists;
          resumeFromCalculatedPosition(active, weekPlaylists);
        }
      }
    } else {
      state.running = false;
      state.currentWeekId = null;
    }
  } catch (err) {
    console.error('[competition] Tick error:', err.message);
  }
}

// ── Resume at calculated position ───────────────────────────────────────────

function resumeFromCalculatedPosition(week, weekPlaylists) {
  const pos = calculateCurrentPosition(weekPlaylists, week.starts_at);
  if (!pos) {
    console.log('[competition] Could not calculate position — no playlists or week not started');
    return;
  }

  state.currentPlaylistIndex = pos.playlistIndex;
  _playlistWrapDetected = false;
  _persistState();

  // Check if the in-game track already matches what we expect
  const current = getCurrentTrack();
  const expected = pos.expectedTrack;
  const trackAlreadyCorrect = expected && current &&
    current.env === expected.env && current.track === expected.track;

  try {
    playlistRunner.resumePlaylist(
      pos.playlistId,
      pos.intervalMs,
      pos.trackIndex,
      pos.remainingMs,
      !trackAlreadyCorrect // forceTrack: only send set_track if track is wrong
    );
    console.log(
      `[competition] Resumed: playlist ${pos.playlistIndex + 1}/${weekPlaylists.length}, ` +
      `track ${pos.trackIndex + 1}, next change in ${Math.round(pos.remainingMs / 1000)}s` +
      (trackAlreadyCorrect ? ' (track already correct)' : ' (track corrected)')
    );
  } catch (err) {
    console.error(`[competition] Failed to resume playlist:`, err.message);
    // Fall back to starting fresh
    try {
      playlistRunner.startPlaylist(pos.playlistId, pos.intervalMs, pos.trackIndex);
    } catch (err2) {
      console.error(`[competition] Fallback start also failed:`, err2.message);
    }
  }

  _broadcastState();
}

// ── Week activation ─────────────────────────────────────────────────────────

function activateWeek(week) {
  console.log(`[competition] Activating week ${week.week_number} (${week.competition_name})`);
  db.updateWeekStatus(week.id, 'active');

  state.running = true;
  state.currentWeekId = week.id;
  state.currentPlaylistIndex = 0;
  state.autoManaged = true;
  _playlistWrapDetected = false;

  const weekPlaylists = db.getWeekPlaylists(week.id);
  state.weekPlaylists = weekPlaylists;

  _persistState();

  broadcast.broadcastAll({
    event_type: 'competition_week_started',
    week_id: week.id,
    week_number: week.week_number,
    competition_name: week.competition_name,
    starts_at: week.starts_at,
    ends_at: week.ends_at,
  });

  // Resume at the calculated position (handles both fresh starts and restarts mid-week)
  if (weekPlaylists.length > 0) {
    resumeFromCalculatedPosition(week, weekPlaylists);
  }
}

// ── Playlist orchestration ──────────────────────────────────────────────────

function advanceToNextPlaylist() {
  if (!state.autoManaged || state.weekPlaylists.length <= 1) return;

  state.currentPlaylistIndex = (state.currentPlaylistIndex + 1) % state.weekPlaylists.length;
  console.log(`[competition] Advancing to playlist ${state.currentPlaylistIndex + 1}/${state.weekPlaylists.length}`);

  const wp = state.weekPlaylists[state.currentPlaylistIndex];
  if (!wp) return;

  try {
    playlistRunner.startPlaylist(wp.playlist_id, wp.interval_ms);
    _playlistWrapDetected = false;
  } catch (err) {
    console.error(`[competition] Failed to start playlist ${wp.playlist_id}:`, err.message);
  }

  _persistState();
  _broadcastState();
}

// ── Broadcast ───────────────────────────────────────────────────────────────

function _broadcastState() {
  broadcast.broadcastAll({
    event_type: 'competition_runner_state',
    ...getState(),
  });
}

module.exports = {
  start,
  stop,
  getState,
  setAutoManaged,
  onPlaylistStateChange,
};
