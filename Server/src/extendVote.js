/**
 * Extend-vote module.
 *
 * Manages the in-game /extend chat command that lets players collectively
 * vote to add 5 minutes to the current track timer. Uses the same vote
 * threshold as /next.
 *
 * Dependencies are injected via init() so this module stays decoupled
 * from the WebSocket transport layer.
 */

const state = require('./state');

const EXTEND_VOTE_TIMEOUT_MS = 180_000; // votes expire after 3 minutes
const EXTEND_AMOUNT_MS = 5 * 60 * 1000; // 5 minutes

const extendVote = {
  active: false,
  voters: new Set(), // voter keys (user_id or nick) who have voted
  timer: null,
};

let _sendCommand = null;

/**
 * Initialise the module with a sendCommand function (from pluginSocket).
 */
function init(sendCommandFn) {
  _sendCommand = sendCommandFn;
}

function cancelExtendVote() {
  extendVote.active = false;
  extendVote.voters.clear();
  if (extendVote.timer) {
    clearTimeout(extendVote.timer);
    extendVote.timer = null;
  }
}

function getExtendVoteInfo() {
  const total = state.getOnlinePlayerCount();
  const realPlayers = Math.max(total - 1, 0); // exclude the bot
  const needed = realPlayers <= 1 ? 1 : Math.max(Math.round(realPlayers / 2), 2);
  return { realPlayers, needed };
}

function handleExtendVoteCommand(voterId) {
  const { extendTimer, getState: getPlaylistState } = require('./playlistRunner');
  if (!getPlaylistState().running) {
    _sendCommand({ cmd: 'send_chat', message: '<color=#FF0000>EXTEND</color> <color=#FFFF00>No playlist is running — nothing to extend.</color>' });
    return;
  }

  if (extendVote.active) {
    if (extendVote.voters.has(voterId)) {
      _sendCommand({ cmd: 'send_chat', message: '<color=#FFFF00>You have already voted.</color>' });
      return;
    }
    extendVote.voters.add(voterId);
    const { needed } = getExtendVoteInfo();
    const have = extendVote.voters.size;
    _sendCommand({ cmd: 'send_chat', message: `<color=#00BFFF>EXTEND VOTE</color> <color=#00FF00>${have}/${needed}</color>` });
    checkExtendVoteThreshold();
    return;
  }

  // Start a new vote
  extendVote.active = true;
  extendVote.voters.clear();
  extendVote.voters.add(voterId); // the initiator counts as a vote

  const { realPlayers, needed } = getExtendVoteInfo();
  _sendCommand({ cmd: 'send_chat', message: `<color=#00FF00>EXTEND VOTE</color> <color=#FFFF00>Need</color> <color=#00BFFF>${needed}/${realPlayers}</color> <color=#FFFF00>— Type /extend</color> <color=#FF0000>(3m)</color>` });

  // Check immediately in case threshold already met
  checkExtendVoteThreshold();

  extendVote.timer = setTimeout(() => {
    if (extendVote.active) {
      cancelExtendVote();
      _sendCommand({ cmd: 'send_chat', message: '<color=#FF0000>EXTEND VOTE</color> <color=#FFFF00>Extend vote expired.</color>' });
    }
  }, EXTEND_VOTE_TIMEOUT_MS);
}

function checkExtendVoteThreshold() {
  const { realPlayers, needed } = getExtendVoteInfo();
  if (realPlayers === 0) return;
  if (extendVote.voters.size >= needed) {
    cancelExtendVote();
    const { extendTimer, getState: getPlaylistState } = require('./playlistRunner');
    if (!getPlaylistState().running) {
      _sendCommand({ cmd: 'send_chat', message: '<color=#FF0000>EXTEND</color> <color=#FFFF00>Vote passed but playlist has stopped.</color>' });
      return;
    }
    _sendCommand({ cmd: 'send_chat', message: '<color=#00FF00>VOTE PASSED</color> <color=#FFFF00>Adding 5 minutes to the current track.</color>' });
    extendTimer(EXTEND_AMOUNT_MS);
  }
}

/**
 * Whether an extend vote is currently active.
 */
function isActive() {
  return extendVote.active;
}

module.exports = {
  init,
  isActive,
  cancelExtendVote,
  handleExtendVoteCommand,
};
