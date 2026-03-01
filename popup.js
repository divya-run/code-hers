const TIPS = [
  { icon: '📦', text: 'Batch similar questions — multiple queries cost more than one detailed prompt.' },
  { icon: '✂️', text: 'Remove "could you please" — filler adds tokens without improving quality.' },
  { icon: '🎯', text: 'Be specific upfront. A clear question needs fewer follow-ups.' },
  { icon: '♻️', text: 'Reuse context windows. New chat only when topics truly change.' },
  { icon: '🔁', text: 'Try "refine this" instead of regenerating from scratch.' },
  { icon: '⚡', text: 'Use smaller models for simple tasks — they use about 10x less energy.' },
  { icon: '🌙', text: 'Grids are greener off-peak. Batch heavy tasks for late night.' },
];

const ALL_ACH = [
  { id: 'first_track', e: '🌱', l: 'First Track' },
  { id: 'streak_3',    e: '🔥', l: '3-Day Streak' },
  { id: 'streak_7',    e: '🏆', l: 'Green Week' },
  { id: 'queries_50',  e: '👁', l: 'Aware of 50' },
  { id: 'xp_100',      e: '⚡', l: 'Eco Novice' },
];

async function render() {
  let data = {};
  try { data = await chrome.storage.local.get(['dailySummary','streak','xp','achievements']); } catch(e){}

  const today   = new Date().toISOString().split('T')[0];
  const summary = (data.dailySummary || {})[today] || {};
  const streak  = data.streak || { current: 0 };
  const xp      = data.xp || 0;
  const earned  = new Set((data.achievements || []).map(a => a.id));

  const rawCo2   = summary.co2g || 0;
  const co2      = rawCo2 < 0.1 ? rawCo2.toFixed(3) : rawCo2 < 1 ? rawCo2.toFixed(2) : rawCo2.toFixed(1);
  const water   = Math.round(summary.waterMl || 0);
  const queries = summary.queryCount || 0;
  const level   = Math.floor(xp / 100) + 1;
  const sc      = streak.current || 0;

  const pct  = Math.min(100, ((summary.co2g || 0) / 3) * 100);
  const fc   = pct > 80 ? 'high' : pct > 50 ? 'mid' : '';
  const desc = queries === 0
    ? 'Visit an AI tool to start tracking!'
    : pct < 50 ? '✓ Below average AI user'
    : pct < 80 ? '≈ Near average usage'
    : '↑ Above average — try batching!';

  const tip  = TIPS[new Date().getDate() % TIPS.length];
  const dots = Array.from({length: 7}, (_, i) =>
    `<div class="dot${i < sc ? ' on' : ''}"></div>`).join('');
  const chips = ALL_ACH.map(a =>
    `<div class="chip${earned.has(a.id) ? '' : ' locked'}">${a.e} ${a.l}</div>`).join('');

  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="header">
      <div class="logo">
        <div class="logo-icon">🌿</div>
        <span class="logo-text">GreenPrompt</span>
      </div>
      <div class="xp-badge">⚡ ${xp} XP · Lv.${level}</div>
    </div>

    <div class="streak-bar">
      <span>🔥</span>
      <span class="streak-text">${sc}-day streak</span>
      <div class="streak-dots">${dots}</div>
    </div>

    <div class="section">
      <div class="section-label">Today's Footprint</div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val">${co2}</div><div class="stat-unit">g CO₂</div></div>
        <div class="stat-card"><div class="stat-val">${water}</div><div class="stat-unit">ml Water</div></div>
        <div class="stat-card"><div class="stat-val">${queries}</div><div class="stat-unit">Queries</div></div>
      </div>
      <div class="compare">
        <div class="compare-label">vs. avg AI user today</div>
        <div class="compare-track">
          <div class="compare-fill ${fc}" style="width:${Math.max(3, pct)}%"></div>
        </div>
        <div class="compare-desc">${desc}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Today's Tip</div>
      <div class="tip-card">
        <span class="tip-icon">${tip.icon}</span>
        <span class="tip-text">${tip.text}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Achievements</div>
      <div class="chips">${chips}</div>
    </div>

    <div class="actions">
      <button class="btn-dash" id="openDash">📊 Full Dashboard</button>
    </div>

    <div class="privacy">
      <span class="privacy-badge">🔒 No prompt data collected · Local only</span>
    </div>
  `;

  document.getElementById('openDash').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  render().catch(() => {
    document.getElementById('app').innerHTML = `
      <div class="welcome">
        🌿 <strong>GreenPrompt</strong> is installed!<br><br>
        Visit <strong>ChatGPT, Claude, or Gemini</strong><br>
        and send a message to begin tracking.
      </div>`;
  });
});
