/**
 * Competition page — public-facing league tables and award highlights.
 * Real-time updates via WebSocket.
 */

let competition = null;
let currentWeek = null;
let weeks = [];
let selectedWeekId = null;

// ── Data Loading ────────────────────────────────────────────────────────────

async function loadCurrentCompetition() {
  try {
    const data = await fetch('/api/competition/current').then(r => r.json());
    competition = data.competition;
    currentWeek = data.current_week;
    renderBanner();
    if (competition) {
      await loadWeeks();
      await loadSeasonStandings();
    }
  } catch {}
}

async function loadWeeks() {
  try {
    weeks = await fetch('/api/competition/weeks').then(r => r.json());
    renderWeekTabs();
    // Auto-select active week or most recent finalised
    const active = weeks.find(w => w.status === 'active');
    const fallback = [...weeks].reverse().find(w => w.status === 'finalised');
    const target = active || fallback || weeks[0];
    if (target) selectWeek(target.id);
  } catch {}
}

async function loadSeasonStandings() {
  try {
    const standings = await fetch('/api/competition/season').then(r => r.json());
    renderSeasonStandings(standings);
  } catch {}
}

async function loadWeeklyStandings(weekId) {
  try {
    const standings = await fetch(`/api/competition/standings/${weekId}`).then(r => r.json());
    renderWeeklyStandings(standings);
    renderAwards(standings);
  } catch {}
}

async function loadPilotDetail(pilotKey) {
  try {
    const data = await fetch(`/api/competition/pilot/${encodeURIComponent(pilotKey)}`).then(r => r.json());
    renderPilotDetail(data, pilotKey);
  } catch {}
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderBanner() {
  const el = document.getElementById('comp-banner');
  if (!competition) {
    el.innerHTML = '<div class="comp-inactive">No active competition. Check back soon!</div>';
    return;
  }

  let daysLeft = '';
  let daysLabel = '';
  if (currentWeek) {
    const end = new Date(currentWeek.ends_at);
    const now = new Date();
    const diff = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
    daysLeft = diff;
    daysLabel = diff === 1 ? 'day left' : 'days left';
  }

  const weekInfo = currentWeek
    ? `Week ${currentWeek.week_number} &middot; ${fmtDate(currentWeek.starts_at)} – ${fmtDate(currentWeek.ends_at)}`
    : 'Between weeks';

  el.innerHTML = `
    <div class="comp-banner">
      <div>
        <div class="comp-banner-title">${esc(competition.name)}</div>
        <div class="comp-banner-week">${weekInfo}</div>
      </div>
      ${currentWeek ? `
        <div class="comp-banner-progress">
          <div class="comp-banner-days">${daysLeft}</div>
          <div class="comp-banner-days-label">${daysLabel}</div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderWeekTabs() {
  const el = document.getElementById('week-tabs');
  el.innerHTML = weeks.map(w => `
    <div class="week-tab ${selectedWeekId === w.id ? 'active' : ''}" data-week-id="${w.id}">
      Week ${w.week_number}
      <span class="status-dot ${w.status}"></span>
    </div>
  `).join('');
}

function renderSeasonStandings(standings) {
  const tbody = document.getElementById('season-body');
  if (!standings.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No competition data yet.</td></tr>';
    return;
  }
  tbody.innerHTML = standings.map((s, i) => {
    const rank = i + 1;
    const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    return `<tr>
      <td class="rank ${rankClass}">${rank}</td>
      <td class="pilot-name" data-pilot="${esc(s.pilot_key)}">${esc(s.display_name)}</td>
      <td class="pts pts-highlight">${s.total_points}</td>
      <td class="pts-sub">${s.weeks_active || 0}</td>
      <td class="pts-sub">${s.position_points}</td>
      <td class="pts-sub">${s.laps_points}</td>
      <td class="pts-sub">${s.consistency_points}</td>
      <td class="pts-sub">${s.improved_points}</td>
      <td class="pts-sub">${s.participation_points}</td>
    </tr>`;
  }).join('');
}

function renderWeeklyStandings(standings) {
  const tbody = document.getElementById('weekly-body');
  if (!standings.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">No results for this week yet.</td></tr>';
    return;
  }
  tbody.innerHTML = standings.map(s => {
    const rankClass = s.rank === 1 ? 'gold' : s.rank === 2 ? 'silver' : s.rank === 3 ? 'bronze' : '';
    return `<tr>
      <td class="rank ${rankClass}">${s.rank}</td>
      <td class="pilot-name" data-pilot="${esc(s.pilot_key)}">${esc(s.display_name)}</td>
      <td class="pts pts-highlight">${s.total_points}</td>
      <td class="pts-sub">${s.position_points}</td>
      <td class="pts-sub">${s.laps_points}</td>
      <td class="pts-sub">${s.consistency_points}</td>
      <td class="pts-sub">${s.streak_points}</td>
      <td class="pts-sub">${s.improved_points}</td>
      <td class="pts-sub">${s.participation_points}</td>
    </tr>`;
  }).join('');
}

function renderAwards(standings) {
  const el = document.getElementById('awards-grid');
  if (!standings.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">No awards yet for this week.</div>';
    return;
  }

  const sorted = [...standings];
  const topOverall = sorted[0];
  const topPosition = sorted.sort((a, b) => b.position_points - a.position_points)[0];
  const topLaps = [...standings].sort((a, b) => b.laps_points - a.laps_points)[0];
  const topConsistency = [...standings].sort((a, b) => b.consistency_points - a.consistency_points)[0];
  const topStreak = [...standings].sort((a, b) => b.streak_points - a.streak_points)[0];
  const topParticipation = [...standings].sort((a, b) => b.participation_points - a.participation_points)[0];

  const cards = [
    { icon: '&#127942;', title: 'Overall Leader', pilot: topOverall, stat: `${topOverall.total_points} pts` },
    { icon: '&#9889;', title: 'Speed Demon', pilot: topPosition, stat: `${topPosition.position_points} position pts` },
    { icon: '&#128640;', title: 'Most Laps', pilot: topLaps, stat: `${topLaps.laps_points} lap pts` },
    { icon: '&#127919;', title: 'Most Consistent', pilot: topConsistency, stat: `${topConsistency.consistency_points} consistency pts` },
    { icon: '&#128293;', title: 'Hot Streak', pilot: topStreak, stat: `${topStreak.streak_points} streak pts` },
    { icon: '&#128170;', title: 'Iron Pilot', pilot: topParticipation, stat: `${topParticipation.participation_points} participation pts` },
  ].filter(c => c.pilot && (c.stat.match(/^0/) === null));

  el.innerHTML = cards.map(c => `
    <div class="award-card">
      <div class="award-card-icon">${c.icon}</div>
      <div class="award-card-title">${c.title}</div>
      <div class="award-card-name">${esc(c.pilot.display_name)}</div>
      <div class="award-card-stat">${c.stat}</div>
    </div>
  `).join('') || '<div class="empty" style="grid-column:1/-1">No awards yet.</div>';
}

function renderPilotDetail(data, pilotKey) {
  const panel = document.getElementById('pilot-detail');
  const nameEl = document.getElementById('pilot-detail-name');
  const barsEl = document.getElementById('pilot-week-bars');
  const bodyEl = document.getElementById('pilot-detail-body');

  if (!data.weeklyStandings || data.weeklyStandings.length === 0) {
    panel.classList.remove('open');
    return;
  }

  const ws = data.weeklyStandings;
  nameEl.textContent = ws[0].display_name;

  // Bar chart
  const maxPts = Math.max(...ws.map(w => w.total_points), 1);
  barsEl.innerHTML = ws.map(w => {
    const h = Math.max(4, (w.total_points / maxPts) * 56);
    return `<div class="pilot-week-bar" style="height:${h}px" title="Week ${w.week_number}: ${w.total_points} pts">
      <span class="pilot-week-bar-label">W${w.week_number}</span>
    </div>`;
  }).join('');

  // Table
  bodyEl.innerHTML = ws.map(w => `
    <tr>
      <td>Week ${w.week_number}</td>
      <td class="rank">${w.rank || '—'}</td>
      <td class="pts">${w.total_points}</td>
      <td class="pts-sub">${w.position_points}</td>
      <td class="pts-sub">${w.laps_points}</td>
      <td class="pts-sub">${w.consistency_points}</td>
      <td class="pts-sub">${w.improved_points}</td>
      <td class="pts-sub">${w.participation_points}</td>
    </tr>
  `).join('');

  panel.classList.add('open');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectWeek(weekId) {
  selectedWeekId = weekId;
  renderWeekTabs();
  loadWeeklyStandings(weekId);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── WebSocket ───────────────────────────────────────────────────────────────

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/live`);

  ws.onclose = () => setTimeout(connectWs, 3000);
  ws.onmessage = ({ data }) => {
    try {
      const event = JSON.parse(data);
      if (event.event_type === 'competition_standings_update') {
        // Refresh the weekly view if we're looking at the updated week
        if (event.week_id === selectedWeekId) {
          loadWeeklyStandings(selectedWeekId);
        }
        loadSeasonStandings();
      } else if (event.event_type === 'competition_week_started') {
        loadCurrentCompetition();
      } else if (event.event_type === 'competition_week_finalised') {
        loadCurrentCompetition();
      } else if (event.event_type === 'competition_points_awarded') {
        // Flash could go here for live point notifications
      }
    } catch {}
  };
}

// ── Event Delegation ────────────────────────────────────────────────────────

document.addEventListener('click', e => {
  // Week tab clicks
  const tab = e.target.closest('.week-tab');
  if (tab) {
    selectWeek(parseInt(tab.dataset.weekId, 10));
    return;
  }

  // Pilot name clicks (drill-down)
  const pilot = e.target.closest('.pilot-name');
  if (pilot && pilot.dataset.pilot) {
    loadPilotDetail(pilot.dataset.pilot);
    return;
  }

  // Pilot detail close
  if (e.target.id === 'pilot-detail-close') {
    document.getElementById('pilot-detail').classList.remove('open');
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadCurrentCompetition();
  connectWs();
});
