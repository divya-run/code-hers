// GreenPrompt Background Service Worker
// Handles session tracking, impact calculations, and streak management

// ─── IMPACT CONSTANTS ────────────────────────────────────────────────────────
// Based on published research:
// - Patterson et al. 2021 (ML carbon footprint)
// - IEA data center energy estimates
// - Luccioni et al. 2023 (power consumption per token)

const AI_PLATFORMS = {
  'chat.openai.com':      { name: 'ChatGPT',    model: 'GPT-4',        wattage: 0.001, co2PerToken: 0.0023, waterPerQuery: 0.5  },
  'claude.ai':            { name: 'Claude',     model: 'Claude 3',     wattage: 0.0008,co2PerToken: 0.0018, waterPerQuery: 0.4  },
  'gemini.google.com':    { name: 'Gemini',     model: 'Gemini Pro',   wattage: 0.0009,co2PerToken: 0.0019, waterPerQuery: 0.45 },
  'copilot.microsoft.com':{ name: 'Copilot',   model: 'GPT-4',        wattage: 0.001, co2PerToken: 0.0023, waterPerQuery: 0.5  },
  'www.perplexity.ai':    { name: 'Perplexity', model: 'Mixed',        wattage: 0.0007,co2PerToken: 0.0015, waterPerQuery: 0.35 },
  'chat.mistral.ai':      { name: 'Mistral',   model: 'Mistral Large', wattage: 0.0006,co2PerToken: 0.0012, waterPerQuery: 0.3  },
};

// Average tokens per query (input + output combined)
const AVG_TOKENS_PER_QUERY = 750;

// ─── SESSION STATE ────────────────────────────────────────────────────────────
const activeSessions = {}; // tabId -> sessionData

// ─── MESSAGE HANDLER ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (msg.type === 'SESSION_START') {
    activeSessions[tabId] = {
      platform: msg.platform,
      startTime: Date.now(),
      queryCount: 0,
      totalTokensEst: 0,
    };
    sendResponse({ ok: true });
  }

  if (msg.type === 'QUERY_DETECTED') {
    if (!activeSessions[tabId]) {
      activeSessions[tabId] = {
        platform: msg.platform,
        startTime: Date.now(),
        queryCount: 0,
        totalTokensEst: 0,
      };
    }
    const session = activeSessions[tabId];
    session.queryCount++;
    session.totalTokensEst += msg.estimatedTokens || AVG_TOKENS_PER_QUERY;

    // Save incremental data
    saveQuery(msg.platform, msg.estimatedTokens || AVG_TOKENS_PER_QUERY, msg.promptLength || 0);
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_STATS') {
    getStats().then(sendResponse);
    return true;
  }

  if (msg.type === 'GET_TODAY_IMPACT') {
    getTodayImpact().then(sendResponse);
    return true;
  }

  if (msg.type === 'OPTIMIZE_PROMPT') {
    optimizePrompt(msg.prompt).then(sendResponse);
    return true;
  }




  return true;
});

// ─── TAB CLOSED ──────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeSessions[tabId]) {
    finalizeSession(tabId);
    delete activeSessions[tabId];
  }
});

// ─── DATA PERSISTENCE ────────────────────────────────────────────────────────
async function saveQuery(platform, tokens, promptLength) {
  const platformInfo = AI_PLATFORMS[platform] || { co2PerToken: 0.002, waterPerQuery: 0.4, name: platform };
  const co2g = tokens * platformInfo.co2PerToken;
  const waterMl = platformInfo.waterPerQuery;
  const energyWh = tokens * (platformInfo.wattage || 0.001);

  const today = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();

  const result = await chrome.storage.local.get(['queries', 'dailySummary', 'streak', 'xp', 'achievements']);

  // Save query
  const queries = result.queries || [];
  queries.push({ platform, tokens, co2g, waterMl, energyWh, promptLength, timestamp, date: today });
  // Keep last 1000 queries
  if (queries.length > 1000) queries.splice(0, queries.length - 1000);

  // Update daily summary
  const dailySummary = result.dailySummary || {};
  if (!dailySummary[today]) dailySummary[today] = { co2g: 0, waterMl: 0, energyWh: 0, queryCount: 0, tokensUsed: 0 };
  dailySummary[today].co2g += co2g;
  dailySummary[today].waterMl += waterMl;
  dailySummary[today].energyWh += energyWh;
  dailySummary[today].queryCount += 1;
  dailySummary[today].tokensUsed += tokens;

  // XP system
  let xp = result.xp || 0;
  xp += 5; // 5 XP per query tracked
  if (promptLength < 100) xp += 3; // Bonus for concise prompts

  // Streak tracking
  let streak = result.streak || { current: 0, longest: 0, lastDate: null };
  if (streak.lastDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    if (streak.lastDate === yesterdayStr) {
      streak.current++;
    } else if (streak.lastDate !== today) {
      streak.current = 1;
    }
    streak.lastDate = today;
    if (streak.current > streak.longest) streak.longest = streak.current;
  }

  // Achievements
  const achievements = result.achievements || [];
  const totalQueries = queries.length;
  checkAchievements(achievements, totalQueries, streak.current, xp);

  await chrome.storage.local.set({ queries, dailySummary, streak, xp, achievements });

  // Nudge if high usage today
  const todayData = dailySummary[today];
  if (todayData.queryCount > 0 && todayData.queryCount % 20 === 0) {
    showNudge(todayData, platform);
  }
}

function checkAchievements(achievements, totalQueries, streak, xp) {
  const defs = [
    { id: 'first_track',    label: 'First Track',       desc: 'Started your green journey!',    check: () => totalQueries >= 1 },
    { id: 'streak_3',       label: '3-Day Streak',      desc: 'Used AI mindfully 3 days in a row', check: () => streak >= 3 },
    { id: 'streak_7',       label: 'Green Week',        desc: '7-day mindful AI streak!',       check: () => streak >= 7 },
    { id: 'queries_50',     label: 'Aware of 50',       desc: 'Tracked 50 AI queries',          check: () => totalQueries >= 50 },
    { id: 'queries_100',    label: 'Carbon Conscious',  desc: 'Tracked 100 AI queries',         check: () => totalQueries >= 100 },
    { id: 'xp_100',         label: 'Eco Novice',        desc: 'Earned 100 XP',                  check: () => xp >= 100 },
    { id: 'xp_500',         label: 'Eco Warrior',       desc: 'Earned 500 XP',                  check: () => xp >= 500 },
  ];

  for (const def of defs) {
    if (!achievements.find(a => a.id === def.id) && def.check()) {
      achievements.push({ id: def.id, label: def.label, desc: def.desc, earnedAt: Date.now() });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: `🏆 Achievement Unlocked: ${def.label}`,
        message: def.desc,
      });
    }
  }
}

function showNudge(todayData, platform) {
  const co2 = todayData.co2g.toFixed(1);
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: '🌿 GreenPrompt Tip',
    message: `You've made ${todayData.queryCount} AI queries today (~${co2}g CO₂). Try batching similar questions into one prompt to cut emissions!`,
  });
}

async function finalizeSession(tabId) {
  const session = activeSessions[tabId];
  if (!session || session.queryCount === 0) return;
  // Session data already saved per-query, nothing extra needed
}

async function getStats() {
  const result = await chrome.storage.local.get(['queries', 'dailySummary', 'streak', 'xp', 'achievements']);
  return {
    queries: result.queries || [],
    dailySummary: result.dailySummary || {},
    streak: result.streak || { current: 0, longest: 0 },
    xp: result.xp || 0,
    achievements: result.achievements || [],
  };
}

async function getTodayImpact() {
  const today = new Date().toISOString().split('T')[0];
  const result = await chrome.storage.local.get(['dailySummary', 'streak', 'xp']);
  const dailySummary = result.dailySummary || {};
  return {
    today: dailySummary[today] || { co2g: 0, waterMl: 0, energyWh: 0, queryCount: 0 },
    streak: result.streak || { current: 0, longest: 0 },
    xp: result.xp || 0,
  };
}

// ─── PROMPT OPTIMIZER (local heuristics) ────────────────────────────────────
async function optimizePrompt(prompt) {
  if (!prompt || prompt.length < 20) return { optimized: prompt, savings: 0, tips: [] };

  let optimized = prompt;
  const tips = [];

  const fillers = [
    [/\bplease\b\s*/gi, ''],
    [/\bcould you\b\s*/gi, ''],
    [/\bcan you\b\s*/gi, ''],
    [/\bi would like you to\b\s*/gi, ''],
    [/\bi want you to\b\s*/gi, ''],
    [/\bkindly\b\s*/gi, ''],
    [/\bas an AI(?: language model)?,?\s*/gi, ''],
    [/\bof course\b[,.]?\s*/gi, ''],
    [/\bcertainly\b[,.]?\s*/gi, ''],
    [/\bI was wondering if\b\s*/gi, ''],
    [/\bwould you be able to\b\s*/gi, ''],
    [/\bdo you think you could\b\s*/gi, ''],
  ];

  let fillerFound = false;
  for (const [pattern, replacement] of fillers) {
    const before = optimized;
    optimized = optimized.replace(pattern, replacement);
    if (optimized !== before) fillerFound = true;
  }
  if (fillerFound) tips.push('Removed courtesy filler phrases');

  optimized = optimized.replace(/\s+/g, ' ').trim();
  if (optimized.length > 0) optimized = optimized[0].toUpperCase() + optimized.slice(1);

  const originalTokens  = Math.ceil(prompt.length / 4);
  const optimizedTokens = Math.ceil(optimized.length / 4);
  const savings = Math.max(0, originalTokens - optimizedTokens);

  if (savings > 0) tips.push(`~${savings} tokens saved · ≈${(savings * 0.002).toFixed(3)}g CO₂`);
  if (prompt.length > 500) tips.push('Consider splitting into multiple focused queries');
  if (!prompt.includes('?') && prompt.split(' ').length > 30) tips.push('A direct question is clearer than a statement');

  return { optimized, savings, tips, originalLength: prompt.length, optimizedLength: optimized.length };
}
