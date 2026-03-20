/**
 * Idle-kick module.
 *
 * Automatically warns and kicks pilots who have been inactive for too long.
 * Activity is tracked per Photon actor number; any gameplay event (lap, checkpoint,
 * chat message, etc.) resets the timer. Players can type /stay to buy more time.
 *
 * JMT-Bot (the host) and whitelisted nicks are always immune.
 *
 * Dependencies are injected via init() so this module stays decoupled
 * from the WebSocket transport layer.
 */

const state = require('./state');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;       // 5 minutes before warning
const WARN_BEFORE_KICK_MS = 1 * 60 * 1000;   // 1 minute grace after warning
const CHECK_INTERVAL_MS = 30 * 1000;          // sweep every 30 seconds
const BOT_NICK = 'JMT-Bot';

// actor → epoch ms of last activity
const _lastActivity = new Map();
// actors that have already been warned (prevents repeat warnings each sweep)
const _warned = new Set();
// lowercased nicks immune to idle kick
const _whitelist = new Set();

let _checkInterval = null;
let _sendCommand = null;
let _sendCommandAwait = null;

/**
 * Initialise the module.
 * @param {Function} sendCommandFn      fire-and-forget command sender
 * @param {Function} sendCommandAwaitFn command sender that returns a Promise
 */
function init(sendCommandFn, sendCommandAwaitFn) {
  _sendCommand = sendCommandFn;
  _sendCommandAwait = sendCommandAwaitFn;

  // Load whitelist from environment (comma-separated nicks)
  const envList = process.env.IDLE_KICK_WHITELIST || '';
  for (const nick of envList.split(',')) {
    const trimmed = nick.trim();
    if (trimmed) _whitelist.add(trimmed.toLowerCase());
  }

  // Start the periodic sweep
  if (_checkInterval) clearInterval(_checkInterval);
  _checkInterval = setInterval(_runIdleCheck, CHECK_INTERVAL_MS);
}

// ── Activity tracking ────────────────────────────────────────────────────────

function recordActivity(actor) {
  _lastActivity.set(actor, Date.now());
  _warned.delete(actor);
}

function handlePlayerEntered(actor) {
  recordActivity(actor);
}

function handlePlayerLeft(actor) {
  _lastActivity.delete(actor);
  _warned.delete(actor);
}

/**
 * Sync with a full player_list event.
 * Removes stale entries and adds fresh timestamps for new actors.
 */
function handlePlayerListSync(actors) {
  const actorSet = new Set(actors);
  // Remove actors no longer present
  for (const actor of _lastActivity.keys()) {
    if (!actorSet.has(actor)) {
      _lastActivity.delete(actor);
      _warned.delete(actor);
    }
  }
  // Add new actors with a fresh timestamp
  for (const actor of actors) {
    if (!_lastActivity.has(actor)) {
      _lastActivity.set(actor, Date.now());
    }
  }
}

function handleStayCommand(actor) {
  recordActivity(actor);
}

/**
 * Reset all idle timers to now and clear warned state.
 * Called on RACE_RESET (global event) and when the playlist stops.
 */
function resetAllTimers() {
  const now = Date.now();
  for (const actor of _lastActivity.keys()) {
    _lastActivity.set(actor, now);
  }
  _warned.clear();
}

// ── Whitelist management ─────────────────────────────────────────────────────

function getWhitelist() {
  return [..._whitelist];
}

function addToWhitelist(nick) {
  _whitelist.add(nick.toLowerCase());
}

function removeFromWhitelist(nick) {
  _whitelist.delete(nick.toLowerCase());
}

// ── Core idle check ──────────────────────────────────────────────────────────

function _runIdleCheck() {
  // Only kick when a playlist is running
  const { getState: getPlaylistState } = require('./playlistRunner');
  if (!getPlaylistState().running) return;
  if (!_sendCommand) return;

  const onlinePlayers = state.getOnlinePlayers();
  // Build actor → player lookup
  const playerByActor = new Map();
  for (const p of onlinePlayers) {
    playerByActor.set(p.actor, p);
  }

  const now = Date.now();

  for (const [actor, lastTs] of _lastActivity) {
    const player = playerByActor.get(actor);

    // Player no longer online — clean up
    if (!player) {
      _lastActivity.delete(actor);
      _warned.delete(actor);
      continue;
    }

    const nick = player.nick || '';

    // Bot is always immune
    if (nick.toLowerCase() === BOT_NICK.toLowerCase()) continue;

    // Whitelisted players are immune
    if (_whitelist.has(nick.toLowerCase())) continue;

    const idleMs = now - lastTs;

    // Phase 2: kick (warned and grace period expired)
    if (idleMs >= IDLE_TIMEOUT_MS + WARN_BEFORE_KICK_MS && _warned.has(actor)) {
      _sendCommand({
        cmd: 'send_chat',
        message: `<color=#FF0000>KICKED</color> <color=#FFFF00>${nick} was removed for inactivity.</color>`,
      });
      _sendCommandAwait({ cmd: 'kick_player', actor }).catch(() => {});
      _lastActivity.delete(actor);
      _warned.delete(actor);
      continue;
    }

    // Phase 1: warn (idle threshold reached, not yet warned)
    if (idleMs >= IDLE_TIMEOUT_MS && !_warned.has(actor)) {
      _sendCommand({
        cmd: 'send_chat',
        message: `<color=#FF0000>WARNING</color> <color=#FFFF00>${nick}, you will be kicked for being idle in 1 minute!</color>`,
      });
      // Send /stay hint as a separate message after a short delay
      setTimeout(() => {
        _sendCommand({
          cmd: 'send_chat',
          message: '<color=#00FF00>Type /stay in chat to remain in the server.</color>',
        });
      }, 500);
      _warned.add(actor);
    }
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

function destroy() {
  if (_checkInterval) {
    clearInterval(_checkInterval);
    _checkInterval = null;
  }
  _lastActivity.clear();
  _warned.clear();
  _whitelist.clear();
  _sendCommand = null;
  _sendCommandAwait = null;
}

module.exports = {
  init,
  recordActivity,
  handlePlayerEntered,
  handlePlayerLeft,
  handlePlayerListSync,
  handleStayCommand,
  resetAllTimers,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  destroy,
};
