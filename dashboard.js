const LEVEL_TITLES = [
  'Eco Seedling', 'Green Curious', 'Byte Saver', 'Carbon Tracker',
  'Emissions Aware', 'Green Advocate', 'Eco Warrior', 'Climate Champion',
  'Carbon Zero Hero', 'Planetary Guardian'
];

const ALL_ACHIEVEMENTS = [
  { id: 'first_track',  emoji: '🌱', label: 'First Track',      desc: 'Started your green journey' },
  { id: 'streak_3',     emoji: '🔥', label: '3-Day Streak',     desc: 'Tracked mindfully 3 days running' },
  { id: 'streak_7',     emoji: '📅', label: 'Green Week',       desc: '7-day mindful streak!' },
  { id: 'queries_50',   emoji: '👁️', label: 'Aware of 50',     desc: 'Tracked 50 AI queries' },
  { id: 'queries_100',  emoji: '💯', label: 'Century Tracker',  desc: '100 queries tracked!' },
  { id: 'xp_100',       emoji: '⚡', label: 'Eco Novice',       desc: 'Earned 100 XP' },
  { id: 'xp_500',       emoji: '🏆', label: 'Eco Warrior',      desc: 'Earned 500 XP' },
];

const TIPS = [
  { icon: '📦', text: 'Batch similar questions into one prompt. Multiple queries cost more than one detailed request.' },
  { icon: '✂️', text: 'Remove filler phrases like "could you please". They add tokens without improving quality.' },
  { icon: '🎯', text: 'Be specific upfront. A clear, direct question needs fewer follow-up queries.' },
  { icon: '♻️', text: 'Reuse context windows. Start a new chat only when topics genuinely change.' },
  { icon: '🔁', text: 'If a response is close, try "refine this" instead of regenerating from scratch.' },
  { icon: '⚡', text: 'Use smaller models (GPT-3.5, Haiku) for simple tasks — they use ~10x less energy.' },
  { icon: '🌙', text: 'AI data centers draw more renewable energy overnight — batch heavy tasks for off-peak hours.' },
  { icon: '📝', text: 'Include examples in your prompt. Concrete context usually halves back-and-forth.' },
  { icon: '🔍', text: 'For research, use web search first. AI inference uses ~10x more energy than a search query.' },
];

const PLATFORM_NAMES = {
  'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'www.perplexity.ai': 'Perplexity',
  'chat.mistral.ai': 'Mistral',
};

const PLATFORM_COLORS = [
  '#4ade80', '#34d399', '#86efac', '#a7f3d0', '#bbf7d0', '#6ee7b7'
];

async function load() {
  let stats;
  try {
    stats = await chrome.runtime.sendMessage({ type: 'GET_STATS' });
  } catch(e) {
    // Demo mode if not in extension context
    stats = { queries: [], dailySummary: {}, streak: { current: 3, longest: 5 }, xp: 145, achievements: [{ id: 'first_track' }, { id: 'xp_100' }] };
  }

  const { queries, dailySummary, streak, xp, achievements } = stats;

  // ── XP / Level ──────────────────────────────────────────────────────────────
  const level = Math.floor(xp / 100) + 1;
  const levelXP = xp % 100;
  const titleIdx = Math.min(level - 1, LEVEL_TITLES.length - 1);
  const levelTitle = LEVEL_TITLES[titleIdx];

  document.getElementById('xp-level-num').textContent = level;
  document.getElementById('xp-fill').style.width = levelXP + '%';
  document.getElementById('xp-numbers').textContent = `${levelXP} / 100 XP to next level`;
  document.getElementById('level-title').textContent = levelTitle;
  document.getElementById('level-badge').textContent = `⚡ Lv.${level} ${levelTitle}`;
  document.getElementById('streak-badge').textContent = `🔥 ${streak.current || 0}-day streak`;

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalCO2 = queries.reduce((s, q) => s + (q.co2g || 0), 0);
  const totalWater = queries.reduce((s, q) => s + (q.waterMl || 0), 0);
  const totalEnergy = queries.reduce((s, q) => s + (q.energyWh || 0), 0);
  const totalQ = queries.length;

  const co2Display = totalCO2 < 0.1 ? totalCO2.toFixed(3) : totalCO2 < 1 ? totalCO2.toFixed(2) : totalCO2.toFixed(1);
  document.getElementById('total-co2').textContent = co2Display;
  document.getElementById('total-water').textContent = Math.round(totalWater);
  document.getElementById('total-energy').textContent = totalEnergy.toFixed(2);
  document.getElementById('total-queries').textContent = totalQ;

  // CO2 comparison
  const avgCO2 = 3; // g/day avg
  document.getElementById('co2-compare').textContent =
    totalCO2 < avgCO2 ? '✓ Below avg daily user' :
    totalCO2 < avgCO2 * 2 ? '≈ Near avg daily user' : '↑ Above avg — try batching!';

  // ── Real-world equivalents ──────────────────────────────────────────────────
  // 1g CO2 ≈ 4m driven, 0.0003 kWh bulb, 0.0014 min tree absorption
  const driveM = totalCO2 * 4;
  const bulbSec = totalEnergy / 0.060 * 3600;
  const treeSec = totalCO2 / 0.0000317 * 60; // trees absorb ~21kg CO2/year

  document.getElementById('equiv-drive').textContent =
    driveM > 1000 ? (driveM/1000).toFixed(1)+'km' : Math.round(driveM)+'m';
  document.getElementById('equiv-bulb').textContent =
    bulbSec > 3600 ? (bulbSec/3600).toFixed(1)+'h' :
    bulbSec > 60   ? Math.round(bulbSec/60)+'min' : Math.round(bulbSec)+'s';
  document.getElementById('equiv-tree').textContent =
    treeSec > 86400 ? (treeSec/86400).toFixed(1)+'d' :
    treeSec > 3600  ? (treeSec/3600).toFixed(1)+'h' :
    treeSec > 60    ? Math.round(treeSec/60)+'min' : Math.round(treeSec)+'s';

  // ── 14-day chart ────────────────────────────────────────────────────────────
  const days = [];
  const dayCO2 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    days.push(key.slice(5)); // MM-DD
    dayCO2.push(Number(((dailySummary[key]?.co2g) || 0).toFixed(3)));
  }

  const ctx = document.getElementById('co2Chart').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [{
        data: dayCO2,
        backgroundColor: dayCO2.map(v => v > 2 ? 'rgba(248,113,113,0.7)' : v > 1 ? 'rgba(251,191,36,0.7)' : 'rgba(74,222,128,0.7)'),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${ctx.parsed.y.toFixed(3)}g CO₂` }
      }},
      scales: {
        x: {
          ticks: { color: '#52685a', font: { family: 'DM Mono', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
        },
        y: {
          ticks: { color: '#52685a', font: { family: 'DM Mono', size: 10 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          beginAtZero: true,
        }
      }
    }
  });

  // ── Platform breakdown ──────────────────────────────────────────────────────
  const platformCounts = {};
  for (const q of queries) {
    const name = PLATFORM_NAMES[q.platform] || q.platform;
    platformCounts[name] = (platformCounts[name] || 0) + 1;
  }
  const sortedPlatforms = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = sortedPlatforms[0]?.[1] || 1;

  const platformEl = document.getElementById('platform-list');
  if (sortedPlatforms.length === 0) {
    platformEl.innerHTML = '<div class="no-data">No queries tracked yet — visit an AI tool!</div>';
  } else {
    platformEl.innerHTML = sortedPlatforms.map(([name, count], i) => `
      <div class="platform-row">
        <div class="platform-name">${name}</div>
        <div class="platform-bar-wrap">
          <div class="platform-bar" style="width:${(count/maxCount*100).toFixed(0)}%; background:${PLATFORM_COLORS[i % PLATFORM_COLORS.length]}"></div>
        </div>
        <div class="platform-pct">${count}</div>
      </div>
    `).join('');
  }

  // ── Achievements ────────────────────────────────────────────────────────────
  const earnedIds = new Set(achievements.map(a => a.id));
  document.getElementById('achievements-grid').innerHTML = ALL_ACHIEVEMENTS.map(a => `
    <div class="achievement-card${earnedIds.has(a.id) ? '' : ' locked'}">
      <div class="achievement-emoji">${a.emoji}</div>
      <div class="achievement-info">
        <div class="achievement-name">${a.label}</div>
        <div class="achievement-desc">${a.desc}</div>
      </div>
    </div>
  `).join('');

  // ── Tips ────────────────────────────────────────────────────────────────────
  document.getElementById('tips-grid').innerHTML = TIPS.map(t => `
    <div class="tip-card">
      <div class="tip-icon">${t.icon}</div>
      <div class="tip-content">${t.text}</div>
    </div>
  `).join('');
}

load().catch(e => {
  console.error(e);
  // Show demo content if not running in extension
  document.getElementById('xp-level-num').textContent = '2';
  document.getElementById('xp-fill').style.width = '45%';
  document.getElementById('xp-numbers').textContent = '45 / 100 XP to next level';
  document.getElementById('level-title').textContent = 'Green Curious';
  document.getElementById('total-co2').textContent = '2.4';
  document.getElementById('total-water').textContent = '240';
  document.getElementById('total-energy').textContent = '0.08';
  document.getElementById('total-queries').textContent = '32';
});