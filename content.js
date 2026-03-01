// GreenPrompt Content Script — Universal query detection
(function () {
  'use strict';

  const PLATFORM = location.hostname;

  const SUPPORTED = [
    'chat.openai.com', 'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
    'copilot.microsoft.com',
    'www.perplexity.ai', 'perplexity.ai',
    'chat.mistral.ai',
  ];
  if (!SUPPORTED.some(s => PLATFORM.includes(s.replace('www.',''))) ) return;

  chrome.runtime.sendMessage({ type: 'SESSION_START', platform: PLATFORM });

  let lastSubmitTime = 0;
  let nudgeCount = 0;
  let totalSessionTokens = 0;

  // ─── GET INPUT TEXT ──────────────────────────────────────────────────────────
  // Tries many selectors — returns the best candidate with text
  function getInputText() {
    const selectors = [
      '#prompt-textarea',                          // ChatGPT
      'textarea[data-id]',                         // ChatGPT alt
      '[contenteditable="true"][data-lexical-editor]', // ChatGPT rich editor
      '.ql-editor',                                // Gemini / Quill
      'div.ProseMirror',                           // Copilot / Mistral
      '[contenteditable="true"][role="textbox"]',  // Copilot
      'textarea[placeholder]',                     // Perplexity / Mistral
      '[contenteditable="true"]',                  // Claude + fallback
      'textarea',                                  // generic fallback
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.value || el.innerText || el.textContent || '').trim();
        if (text.length > 0) return { el, text };
      }
    }
    // Return first editable even if empty
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return { el, text: '' };
    }
    return null;
  }

  // ─── FIRE A QUERY EVENT ──────────────────────────────────────────────────────
  function onQueryFired(sourceLabel) {
    const now = Date.now();
    if (now - lastSubmitTime < 1200) return;
    // Don't count if user is interacting with our own UI
    if (document.querySelector('.gp-optimize-modal, .gp-nudge')) {
      if (sourceLabel !== 'mutation') return;
    }
    lastSubmitTime = now;

    const input = getInputText();
    const promptLength = input?.text?.length || 0;
    // ~4 chars per token for the prompt + 300 token avg for the model's response
    const promptTokens = Math.ceil(promptLength / 4);
    const estimatedTokens = promptTokens + 300;

    chrome.runtime.sendMessage({
      type: 'QUERY_DETECTED',
      platform: PLATFORM,
      estimatedTokens,
      promptLength,
    });

    showMicroNudge(estimatedTokens);
  }

  // ─── METHOD 1: Keyboard events (all three to catch every platform) ───────────
  ['keydown', 'keypress', 'keyup'].forEach(evtName => {
    document.addEventListener(evtName, (e) => {
      if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const el = e.target;
      const tag = el?.tagName?.toLowerCase();
      const isEditable = el?.contentEditable === 'true' || el?.isContentEditable;
      if (tag === 'textarea' || isEditable) {
        onQueryFired('keyboard-' + evtName);
      }
    }, true);
  });

  // ─── METHOD 2: Click detection on send-like buttons ─────────────────────────
  function looksLikeSendBtn(el) {
    const btn = el?.closest?.('button, [role="button"]');
    if (!btn) return false;
    if (btn.disabled) return false;

    const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '').toLowerCase().trim();
    const testid = (btn.getAttribute('data-testid') || '').toLowerCase();

    // Explicit matches
    const SEND_WORDS = ['send', 'submit', 'ask', 'search', 'go', 'run'];
    if (SEND_WORDS.some(w => label.includes(w) || testid.includes(w))) return true;

    // type=submit
    if (btn.type === 'submit') return true;

    // Icon-only button adjacent to a textarea/contenteditable (most send buttons)
    const hasSVG = !!btn.querySelector('svg');
    const nearInput = !!(
      btn.closest('form') ||
      btn.parentElement?.querySelector('textarea, [contenteditable="true"]') ||
      btn.parentElement?.parentElement?.querySelector('textarea, [contenteditable="true"]')
    );
    if (hasSVG && nearInput) return true;

    return false;
  }

  document.addEventListener('click', (e) => {
    if (looksLikeSendBtn(e.target)) {
      onQueryFired('click');
    }
  }, true);

  // ─── METHOD 3: MutationObserver — watch for new user message bubbles ─────────
  // This is the most reliable fallback: when a new user message appears in the
  // DOM, a query was definitely sent — regardless of how the event was triggered.
  // Each platform adds a distinctive element when the user message is rendered.
  const USER_MSG_SELECTORS = [
    // ChatGPT
    '[data-message-author-role="user"]',
    // Claude
    '[data-testid="user-message"]',
    // Gemini
    'user-query, .user-query',
    'model-response',                   // appears after user sends
    // Copilot
    '[class*="userMessage"]',
    '[class*="user-message"]',
    // Perplexity
    '[class*="UserMessage"]',
    '.my-md',                           // Perplexity user bubble class
    // Mistral
    '[class*="HumanTurn"]',
    '[class*="human"]',
  ];

  let knownMsgCount = 0;

  function countUserMessages() {
    let count = 0;
    for (const sel of USER_MSG_SELECTORS) {
      try { count += document.querySelectorAll(sel).length; } catch(e) {}
    }
    return count;
  }

  // Wait for page to settle before baselining
  setTimeout(() => {
    knownMsgCount = countUserMessages();

    const msgObserver = new MutationObserver((mutations) => {
      // Ignore mutations caused by our own injected elements
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          // Skip anything we injected
          if (
            node.className?.toString?.().includes('gp-') ||
            node.closest?.('.gp-nudge') ||
            node.closest?.('.gp-optimize-modal') ||
            node.closest?.('.gp-optimize-btn')
          ) continue;

          // Only count if a known user message selector matches inside this new node
          // or the node itself matches
          const matchedAny = USER_MSG_SELECTORS.some(sel => {
            try {
              return node.matches?.(sel) || node.querySelector?.(sel);
            } catch(e) { return false; }
          });

          if (matchedAny) {
            const current = countUserMessages();
            if (current > knownMsgCount) {
              knownMsgCount = current;
              onQueryFired('mutation');
            }
            return; // only fire once per mutation batch
          }
        }
      }
    });

    msgObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }, 3000);

  // ─── MICRO-NUDGE ─────────────────────────────────────────────────────────────
  function showMicroNudge(tokens) {
    totalSessionTokens += tokens;
    nudgeCount++;
    const sessionCO2 = totalSessionTokens * 0.002;
    if (nudgeCount % 5 !== 0 && sessionCO2 < 1) return;

    document.querySelector('.gp-nudge')?.remove();

    const nudge    = document.createElement('div');
    nudge.className = 'gp-nudge';
    const inner   = document.createElement('div');
    inner.className = 'gp-nudge-inner';
    const leaf    = document.createElement('span');
    leaf.className = 'gp-leaf'; leaf.textContent = '🌿';
    const txt     = document.createElement('span');
    txt.className  = 'gp-text';
    txt.textContent = `Session: ~${sessionCO2.toFixed(2)}g CO₂ · ${nudgeCount} queries`;
    const x       = document.createElement('button');
    x.className    = 'gp-close'; x.textContent = '×';
    x.addEventListener('click', () => nudge.remove());
    inner.append(leaf, txt, x);
    nudge.appendChild(inner);
    document.body.appendChild(nudge);
    setTimeout(() => nudge.remove?.(), 4000);
  }

  // ─── OPTIMIZER BUTTON ────────────────────────────────────────────────────────
  function injectOptimizerButton() {
    if (document.querySelector('.gp-optimize-btn')) return;

    const btn = document.createElement('button');
    btn.className = 'gp-optimize-btn';
    btn.type = 'button';
    btn.title = 'GreenPrompt: Shorten & clarify your prompt';
    btn.textContent = '🌿';
    btn.style.cssText = `
      position:fixed; bottom:80px; right:20px; z-index:2147483640;
      background:rgba(22,101,52,0.92); border:1px solid rgba(74,222,128,0.4);
      border-radius:50%; width:40px; height:40px; font-size:18px; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 12px rgba(0,0,0,0.35); transition:transform 0.15s, opacity 0.15s;
      opacity:0.85;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.opacity='1'; btn.style.transform='scale(1.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity='0.85'; btn.style.transform='scale(1)'; });

    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const input = getInputText();
      if (!input?.text?.trim()) {
        btn.textContent = '✗'; setTimeout(() => btn.textContent='🌿', 1000); return;
      }
      btn.textContent = '⏳'; btn.disabled = true;
      const result = await chrome.runtime.sendMessage({ type: 'OPTIMIZE_PROMPT', prompt: input.text });
      btn.textContent = '🌿'; btn.disabled = false;
      if (result?.optimized && result.optimized !== input.text && result.savings > 0) {
        showOptimizeSuggestion(result, input.el);
      } else {
        btn.textContent = '✓'; setTimeout(() => btn.textContent='🌿', 1500);
      }
    });

    document.body.appendChild(btn);
  }

  // ─── OPTIMIZER MODAL ─────────────────────────────────────────────────────────
  function showOptimizeSuggestion(result, inputEl) {
    document.querySelector('.gp-optimize-modal')?.remove();
    const pct = result.originalLength > 0
      ? Math.round((1 - result.optimizedLength / result.originalLength) * 100) : 0;

    const modal  = document.createElement('div');   modal.className = 'gp-optimize-modal';
    const inner  = document.createElement('div');   inner.className = 'gp-modal-content';
    const header = document.createElement('div');   header.className = 'gp-modal-header';
    const title  = document.createElement('span');  title.textContent = '🌿 Prompt Optimizer';
    const xBtn   = document.createElement('button'); xBtn.className = 'gp-close'; xBtn.textContent = '×';
    xBtn.addEventListener('click', () => modal.remove());
    header.append(title, xBtn);

    const body     = document.createElement('div');    body.className = 'gp-modal-body';
    const savingsEl= document.createElement('p');      savingsEl.className = 'gp-savings';
    savingsEl.textContent = `~${result.savings} tokens saved · ${pct}% shorter · ≈${(result.savings*0.002).toFixed(3)}g CO₂`;
    const optText  = document.createElement('div');    optText.className = 'gp-optimized-text';
    optText.textContent = result.optimized;
    const tipsEl   = document.createElement('div');    tipsEl.className = 'gp-tips';
    result.tips.forEach(t => { const s=document.createElement('span'); s.textContent='• '+t; tipsEl.appendChild(s); });
    const actions  = document.createElement('div');    actions.className = 'gp-modal-actions';

    const applyBtn = document.createElement('button'); applyBtn.className='gp-btn-apply'; applyBtn.textContent='Apply Suggestion';
    applyBtn.addEventListener('click', () => {
      try {
        if (inputEl.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
          setter.call(inputEl, result.optimized);
          inputEl.dispatchEvent(new Event('input', {bubbles:true}));
        } else {
          inputEl.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, result.optimized);
        }
      } catch(e) {
        inputEl.textContent = result.optimized;
      }
      modal.remove();
    });

    const cancelBtn = document.createElement('button'); cancelBtn.className='gp-btn-cancel'; cancelBtn.textContent='Keep Original';
    cancelBtn.addEventListener('click', () => modal.remove());

    actions.append(applyBtn, cancelBtn);
    body.append(savingsEl, optText, tipsEl, actions);
    inner.append(header, body);
    modal.appendChild(inner);
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  // Inject optimizer button, retry as SPA navigates
  setTimeout(injectOptimizerButton, 2500);
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      document.querySelector('.gp-optimize-btn')?.remove();
      setTimeout(injectOptimizerButton, 2500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
