/* Tally — main app
 * AI scan  : OpenRouter free vision models (fallback chain)
 * Food DB  : Open Food Facts 4M+ products
 * Multi-scan: detects multiple items, groups them, sequential results
 */
(function () {
  'use strict';

  var SK_PROFILE = 'tally_profile_v1';
  var SK_LOGS    = 'tally_logs_v1';
  var SK_APIKEY  = 'tally_openrouter_key_v1';

  // Safe storage wrapper — Safari Private Browsing throws QuotaExceededError
  // on EVERY setItem call (quota is 0), so every write must be guarded or the
  // whole app crashes the instant someone logs a food item.
  var _storageWarned = false;
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); return true; }
    catch (e) {
      if (!_storageWarned) {
        _storageWarned = true;
        showToast('Private Browsing blocks saving — your data won\'t persist');
      }
      return false;
    }
  }
  function safeGet(key) {
    try { return localStorage.getItem(key); }
    catch (_) { return null; }
  }

  function loadProfile() { try { return JSON.parse(safeGet(SK_PROFILE)) || null; } catch (_) { return null; } }
  function saveProfile(p) { safeSet(SK_PROFILE, JSON.stringify(p)); }
  function loadLogs()    { try { return JSON.parse(safeGet(SK_LOGS)) || []; } catch (_) { return []; } }
  function saveLogs(l)   { safeSet(SK_LOGS, JSON.stringify(l)); }
  function loadApiKey()  { return safeGet(SK_APIKEY) || ''; }
  function saveApiKey(k) { safeSet(SK_APIKEY, k.trim()); }

  var S = {
    profile:   null,
    logs:      [],
    budgets:   null,
    weekState: null,
    apiKey:    '',
    // Multi-scan state
    scanItems:    [],  // raw items from AI [{food}, ...]
    groups:       [],  // [{name, items:[food,food,...], result}]
    groupIdx:     0,   // which group we're currently showing results for
    result:       null // current single result being shown
  };

  function recompute() {
    if (!S.profile) return;
    S.budgets   = TallyCalc.deriveBudgets(S.profile);
    S.weekState = TallyCalc.computeWeekState(S.logs, S.budgets);
  }

  function init() {
    TallyFeatures.initTheme();
    S.profile = loadProfile();
    S.logs    = loadLogs();
    S.apiKey  = loadApiKey();
    recompute();
    if (!S.profile) { showOnboarding(); } else { hideOnboarding(); navigate('home'); }
    renderTopbar();
  }

  /* ─────────────────────────────────────────────────────────────
     NAVIGATION
     ───────────────────────────────────────────────────────────── */
  function navigate(id) {
    document.querySelectorAll('.view').forEach(function(v) {
      v.classList.toggle('active', v.dataset.view === id);
    });
    document.querySelectorAll('.nav-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.nav === id);
    });
    var main = document.querySelector('.app-main');
    if (main) main.scrollTop = 0;
    if (id === 'home')     renderHome();
    if (id === 'scan')     renderScan();
    if (id === 'log')      renderLog();
    if (id === 'settings') renderSettings();
    if (id === 'run')      renderRunView();
  }

  /* ─────────────────────────────────────────────────────────────
     TOPBAR
     ───────────────────────────────────────────────────────────── */
  function renderTopbar() {
    var el = document.getElementById('topbar-meta');
    if (!el || !S.budgets) return;
    var rem = S.weekState ? S.weekState.totalRemaining : S.budgets.weeklyBudget;
    var sign = rem < 0 ? '-' : '';
    el.innerHTML = '<span class="week-label">This week</span>' +
      sign + Math.abs(Math.round(rem)).toLocaleString() + ' kcal left';
  }

  /* ─────────────────────────────────────────────────────────────
     HOME
     ───────────────────────────────────────────────────────────── */
  function renderHome() {
    if (!S.budgets || !S.weekState) return;
    var ws = S.weekState;
    var pct = Math.min(ws.totalUsed / (ws.weeklyBudget || 1), 1);

    setText('ledger-remaining', fmt(ws.totalRemaining));
    setText('ledger-used',      fmt(ws.totalUsed) + ' used');
    setText('ledger-budget',    fmt(ws.weeklyBudget) + ' budget');

    var g = document.getElementById('ledger-gauge');
    if (g) {
      g.style.width = Math.round(pct * 100) + '%';
      g.className = 'balance-fill' + (ws.totalUsed > ws.weeklyBudget ? ' over' : pct > 0.8 ? ' warn' : '');
    }

    var flexPct = Math.min(ws.flexibleUsed / (ws.flexibleBudget || 1), 1);
    setText('flex-remaining', fmt(Math.max(0, ws.flexibleRemaining)));
    setText('flex-used',      fmt(ws.flexibleUsed) + ' / ' + fmt(ws.flexibleBudget) + ' used');
    var fg = document.getElementById('flex-gauge');
    if (fg) {
      fg.style.width = Math.round(flexPct * 100) + '%';
      fg.className = 'balance-flex-fill' + (flexPct >= 1 ? ' over' : '');
    }

    renderRecentScans();
    renderHabits();
    renderWaterSection();
    renderStreakSection();
    renderMoodSection();
    renderTopbar();
  }

  function renderRecentScans() {
    var el = document.getElementById('recent-scans');
    if (!el) return;
    var logs = S.logs.slice().sort(function(a, b) { return b.timestamp - a.timestamp; }).slice(0, 7);
    if (!logs.length) {
      el.innerHTML = '<div class="empty-state">' +
        '<div class="e-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg></div>' +
        '<div class="e-title">Nothing logged yet</div>' +
        '<div class="e-sub">Scan your first food item to start tracking.</div></div>';
      return;
    }
    el.innerHTML = logs.map(function(l) {
      var v = l.verdict || 'neutral';
      return '<div class="log-item">' +
        '<div class="log-dot ' + v + '"></div>' +
        '<div class="log-item-name">' + esc(l.name) + '</div>' +
        '<div class="log-item-kcal ' + v + '">' + Math.round(l.kcal) + '</div>' +
        '</div>';
    }).join('');
  }

  function renderHabits() {
    var el = document.getElementById('habits-section');
    if (!el) return;
    var flags = TallyCalc.detectHabits(S.logs);
    if (!flags.length) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div style="padding:var(--s4) var(--s4) 0">' +
        '<div class="section-header" style="padding:0;margin-bottom:var(--s3)">Pattern watch</div>' +
      '</div>' +
      flags.map(function(f) {
        return '<div class="habit-chip">' +
          '<div class="habit-chip-row">' +
            '<span class="habit-chip-name">' + esc(f.name) + '</span>' +
            '<span class="habit-chip-count">×' + f.count + ' this week</span>' +
          '</div>' +
          (f.swap ? '<div class="habit-chip-swap">💡 ' + esc(f.swap) + '</div>' : '') +
          '</div>';
      }).join('');
  }

  /* ─────────────────────────────────────────────────────────────
     API KEY SCREEN
     ───────────────────────────────────────────────────────────── */
  function showApiKeyScreen(onSuccess) {
    var el  = document.getElementById('apikey-screen');
    var inp = document.getElementById('apikey-input');
    var err = document.getElementById('apikey-error');
    var btn = document.getElementById('apikey-save-btn');
    if (!el) return;
    el.className = 'apikey-screen visible';
    err.style.display = 'none';
    inp.value = S.apiKey || '';

    function trySave() {
      var key = inp.value.trim();
      if (!key || key.length < 20) {
        err.textContent = 'Doesn\'t look right — OpenRouter keys start with "sk-or-" and are longer than 20 characters.';
        err.style.display = 'block';
        return;
      }
      saveApiKey(key);
      S.apiKey = key;
      el.className = 'apikey-screen';
      if (typeof onSuccess === 'function') onSuccess();
    }

    var nb = btn.cloneNode(true);
    btn.parentNode.replaceChild(nb, btn);
    nb.addEventListener('click', trySave);
    inp.onkeydown = function(e) { if (e.key === 'Enter') trySave(); };
  }

  function hideApiKeyScreen() {
    var el = document.getElementById('apikey-screen');
    if (el) el.className = 'apikey-screen';
  }

  /* ─────────────────────────────────────────────────────────────
     SCAN VIEW
     ───────────────────────────────────────────────────────────── */
  var scanState = { dataUrl: null, scanning: false };
  var _offTimer = null, _offCtrl = null;

  function renderScan() {
    var vf = document.getElementById('vf-image');
    if (vf) { vf.src = ''; vf.classList.add('hidden'); }
    var ph = document.getElementById('vf-placeholder');
    if (ph) ph.classList.remove('hidden');
    hideScanStatus();
    var inp = document.getElementById('scan-search-input');
    if (inp) inp.value = '';
    var res = document.getElementById('scan-search-results');
    if (res) res.innerHTML = '';
  }

  function hideScanStatus() {
    var s = document.getElementById('scan-status');
    if (s) s.classList.add('hidden');
  }

  function showScanStatus(msg) {
    var s = document.getElementById('scan-status');
    if (!s) return;
    var t = s.querySelector('.scan-status-text');
    if (t) t.textContent = msg;
    s.classList.remove('hidden');
  }

  function handleImageCapture(file) {
    if (!file) return;

    // File size sanity check — iPhone photos can be 10-30MB; reject absurd
    // outliers early with a clear message rather than letting canvas ops
    // silently fail on memory-constrained devices.
    var MAX_FILE_MB = 50;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showScanStatus('Photo is too large (' + Math.round(file.size / 1024 / 1024) + 'MB) — try again');
      setTimeout(hideScanStatus, 3500);
      return;
    }

    var img = new Image();
    var obj = URL.createObjectURL(file);
    img.onload = function() {
      URL.revokeObjectURL(obj);
      try {
        var MAX = 1280, w = img.width, h = img.height;
        if (!w || !h) throw new Error('Image has no dimensions');
        if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        if (!dataUrl || dataUrl === 'data:,') throw new Error('Canvas export failed');

        scanState.dataUrl = dataUrl;
        var vf = document.getElementById('vf-image');
        var ph = document.getElementById('vf-placeholder');
        if (vf) { vf.src = dataUrl; vf.classList.remove('hidden'); }
        if (ph) ph.classList.add('hidden');

        if (!navigator.onLine) {
          showScanStatus('You\'re offline — AI scan needs internet. Use search below.');
          setTimeout(hideScanStatus, 4500);
          return;
        }
        if (!S.apiKey) {
          showApiKeyScreen(function() { triggerAIScan(dataUrl, 0); });
        } else {
          triggerAIScan(dataUrl, 0);
        }
      } catch (procErr) {
        console.error('Image processing failed:', procErr);
        showScanStatus('Couldn\'t process that photo — try a different one or use search below.');
        setTimeout(hideScanStatus, 4000);
      }
    };
    img.onerror = function() {
      URL.revokeObjectURL(obj);
      showScanStatus('Could not load image — try again');
      setTimeout(hideScanStatus, 3000);
    };
    img.src = obj;
  }

  /* ─────────────────────────────────────────────────────────────
     AI SCAN — MULTI-ITEM
     ───────────────────────────────────────────────────────────── */
  var FREE_MODELS = [
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'moonshotai/kimi-vl-a3b-thinking:free'
  ];

  function triggerAIScan(dataUrl, modelIdx) {
    modelIdx = modelIdx || 0;
    if (modelIdx >= FREE_MODELS.length) {
      scanState.scanning = false;
      showScanStatus('No free AI models available — use search below.');
      setTimeout(hideScanStatus, 6000);
      return;
    }
    if (scanState.scanning && modelIdx === 0) return;
    scanState.scanning = true;
    showScanStatus('Scanning for food items… (' + (modelIdx + 1) + '/' + FREE_MODELS.length + ')');

    var base64 = dataUrl.split(',')[1];
    var mime   = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    // fetch() has no built-in timeout — on a weak/hanging connection the
    // request can stay pending indefinitely, leaving the spinner stuck
    // forever with no way out short of force-closing the app. 30s is
    // generous for a vision model response but still bounded.
    var SCAN_TIMEOUT_MS = 30000;
    var timedOut = false;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = ctrl ? setTimeout(function() {
      timedOut = true;
      ctrl.abort();
    }, SCAN_TIMEOUT_MS) : null;

    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + S.apiKey,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Tally Food Scanner'
      },
      body: JSON.stringify({
        model: FREE_MODELS[modelIdx],
        max_tokens: 1200,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
            { type: 'text',      text: buildMultiPrompt() }
          ]
        }]
      }),
      signal: ctrl ? ctrl.signal : undefined
    })
    .then(function(r) {
      if (timeoutId) clearTimeout(timeoutId);
      if (!r.ok) return r.json().then(function(b) {
        throw new Error('CODE:' + r.status + ' ' + ((b.error && b.error.message) || ''));
      });
      return r.json();
    })
    .then(function(data) {
      scanState.scanning = false;
      hideScanStatus();
      var raw = '';
      try { raw = data.choices[0].message.content || ''; } catch (_) {}
      handleMultiScanRaw(raw);
    })
    .catch(function(err) {
      if (timeoutId) clearTimeout(timeoutId);

      if (timedOut || (err && err.name === 'AbortError')) {
        // Timeout — try the next free model rather than giving up entirely,
        // same recovery path as a "model unavailable" response.
        scanState.scanning = false;
        if (modelIdx + 1 < FREE_MODELS.length) {
          triggerAIScan(dataUrl, modelIdx + 1);
        } else {
          showScanStatus('Scan timed out — check your connection and try again.');
          setTimeout(hideScanStatus, 6000);
        }
        return;
      }

      var msg = String(err.message || err).toLowerCase();
      if (msg.includes('404') || msg.includes('not found') || msg.includes('unavailable') ||
          msg.includes('paid') || msg.includes('not available for free')) {
        scanState.scanning = false;
        triggerAIScan(dataUrl, modelIdx + 1);
        return;
      }
      scanState.scanning = false;
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
        showScanStatus('Rate limited — wait a moment then try again.');
        setTimeout(hideScanStatus, 6000);
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key')) {
        hideScanStatus();
        showApiKeyScreen(function() { triggerAIScan(scanState.dataUrl, 0); });
      } else if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
        showScanStatus('No internet — use search below.');
        setTimeout(hideScanStatus, 5000);
      } else {
        showScanStatus('Scan error: ' + String(err.message || err).slice(0, 80));
        setTimeout(hideScanStatus, 7000);
      }
    });
  }

  function buildMultiPrompt() {
    var goal = S.profile ? (TallyData.GOALS[S.profile.goal] || {}).label || S.profile.goal : 'general health';
    return [
      'You are a professional nutrition expert. Carefully examine this image and identify EVERY distinct food item, drink, sauce, condiment, or ingredient visible.',
      'User goal: ' + goal + '.',
      '',
      'Return ONLY a valid JSON array — no markdown, no explanation, no text before or after.',
      'Each element must have ALL these fields:',
      '{"name":"","brand":"","serving":"","kcal":0,"protein":0,"carbs":0,"fat":0,"satFat":0,"sugar":0,"fiber":0,"sodium":0,"processed":false,"category":"","swap":""}',
      '',
      'Field rules:',
      '- name: concise item name e.g. "Big Mac", "Coca-Cola", "Ketchup"',
      '- brand: visible brand name or empty string',
      '- serving: exact serving visible e.g. "1 burger (219g)", "1 can (330ml)", "1 tbsp (17g)"',
      '- kcal: calories for that serving as integer — BE ACCURATE, use label if visible',
      '- protein/carbs/fat/satFat/sugar/fiber: grams as decimals',
      '- sodium: milligrams as integer',
      '- processed: true if ultra-processed (fast food, packaged snacks, soda)',
      '- category: EXACTLY one of: snack drink fastfood meal protein dairy fruit veg grain bakery dessert spread dip',
      '- swap: one sentence healthier swap, or empty string if item is already healthy',
      '',
      'IMPORTANT:',
      '- If you see only ONE item, return an array with ONE object.',
      '- If you see a burger AND fries AND a drink, return THREE objects.',
      '- Use nutrition label values if readable. Otherwise use well-known standard values.',
      '- Return ONLY the JSON array. Nothing else.'
    ].join('\n');
  }

  function handleMultiScanRaw(raw) {
    // Strip markdown fences
    var clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Try to extract a JSON array first
    var arrMatch = clean.match(/\[[\s\S]*\]/);
    // Fallback: try object (single item)
    var objMatch = clean.match(/\{[\s\S]*\}/);

    var items = [];

    if (arrMatch) {
      try { items = JSON.parse(arrMatch[0]); } catch (_) {}
    }

    // If array parse failed or returned empty, try single object
    if (!Array.isArray(items) || items.length === 0) {
      if (objMatch) {
        try {
          var single = JSON.parse(objMatch[0]);
          if (single && single.name) items = [single];
        } catch (_) {}
      }
    }

    // Normalise every item
    items = items.filter(function(f) { return f && f.name; }).map(normaliseFood);

    if (items.length === 0) {
      showScanStatus('Couldn\'t identify any food — use search below');
      setTimeout(hideScanStatus, 3000);
      return;
    }

    if (items.length === 1) {
      // Single item — go straight to results (existing flow)
      S.scanItems = items;
      S.groups = [{ name: items[0].name, items: items, result: buildResult(items[0]) }];
      S.groupIdx = 0;
      S.result = S.groups[0].result;
      renderResults(S.result, 0, S.groups.length);
      navigate('results');
    } else {
      // Multiple items — show pairing screen
      S.scanItems = items;
      S.groups = [];
      S.groupIdx = 0;
      showPairingScreen(items);
    }
  }

  function normaliseFood(food) {
    ['kcal','protein','carbs','fat','satFat','sugar','fiber','sodium'].forEach(function(k) {
      food[k] = parseFloat(food[k]) || 0;
    });
    food.processed = !!food.processed;
    food.name    = (food.name    || 'Unknown').slice(0, 60);
    food.serving = food.serving  || '1 serving';
    food.swap    = food.swap     || '';
    return food;
  }

  function buildResult(food) {
    var eval_     = TallyCalc.evaluateFood(food, S.profile);
    var copy      = TallyCalc.verdictCopy(eval_.verdict, S.profile);
    var burn      = TallyCalc.calcBurnOff(food.kcal, S.profile ? S.profile.weightKg : 70);
    var allow     = TallyCalc.calcWeeklyAllowance(food, eval_.verdict, S.weekState);
    var compounds = getCompounds(food);
    var dietPlan  = generateDietPlan(food);
    return { food: food, eval: eval_, copy: copy, burn: burn, allow: allow, compounds: compounds, dietPlan: dietPlan };
  }

  /* ─────────────────────────────────────────────────────────────
     PAIRING SCREEN
     ───────────────────────────────────────────────────────────── */
  // pairingState: tracks which group each item is assigned to
  var pairingState = {
    items: [],          // [{food, groupId}]  groupId = 0,1,2... or null (unassigned)
    groupNames: {},     // {0: 'name', 1: 'name'}
    createdGroups: [],  // [0, 1, 2...] — tracks groups in creation order (even if empty)
    nextGroupId: 0
  };

  function showPairingScreen(items) {
    pairingState.items = items.map(function(f) { return { food: f, groupId: null }; });
    pairingState.groupNames = {};
    pairingState.createdGroups = [];
    pairingState.nextGroupId = 0;

    var view = document.getElementById('v-pairing');
    if (!view) return;

    // Activate pairing view
    document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
    document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); });
    view.classList.add('active');

    renderPairingScreen();
  }

  function renderPairingScreen() {
    var el = document.getElementById('pairing-content');
    if (!el) return;

    var groups = getGroupMap();
    var ungrouped = pairingState.items.filter(function(pi) { return pi.groupId === null; });

    var html = '';

    // Detected items header
    html += '<div class="pairing-section-label">Detected in photo</div>';
    html += '<div class="pairing-items-grid">';
    pairingState.items.forEach(function(pi, idx) {
      var food = pi.food;
      var isAssigned = pi.groupId !== null;
      var groupColor = isAssigned ? getGroupColor(pi.groupId) : '';
      html += '<div class="pairing-item' + (isAssigned ? ' assigned' : '') + '" data-idx="' + idx + '">' +
        '<div class="pairing-item-indicator" style="background:' + (isAssigned ? groupColor : 'var(--label-4)') + '"></div>' +
        '<div class="pairing-item-body">' +
          '<div class="pairing-item-name">' + esc(food.name) + '</div>' +
          '<div class="pairing-item-meta">' + (food.brand ? esc(food.brand) + ' · ' : '') + Math.round(food.kcal) + ' kcal</div>' +
        '</div>' +
        '<div class="pairing-item-tag">' + getCategoryEmoji(food.category) + '</div>' +
        '</div>';
    });
    html += '</div>';

    // Groups — use createdGroups so empty groups still render
    var groupIds = pairingState.createdGroups.slice();
    if (groupIds.length > 0) {
      html += '<div class="pairing-section-label" style="margin-top:var(--s5)">Your groups</div>';
      groupIds.forEach(function(gid) {
        var gItems = groups[gid] || [];
        var gName  = pairingState.groupNames[gid] || '';
        var gColor = getGroupColor(gid);
        var totalKcal = gItems.reduce(function(s, pi) { return s + pi.food.kcal; }, 0);
        html += '<div class="pairing-group" data-gid="' + gid + '">' +
          '<div class="pairing-group-bar" style="background:' + gColor + '"></div>' +
          '<div class="pairing-group-body">' +
            '<div class="pairing-group-name-row">' +
              '<input class="pairing-group-name-input" data-gid="' + gid + '" placeholder="Name this group…" value="' + esc(gName) + '" maxlength="40">' +
              '<span class="pairing-group-kcal">' + Math.round(totalKcal) + ' kcal total</span>' +
            '</div>' +
            '<div class="pairing-group-items">' +
              gItems.map(function(pi) {
                return '<div class="pairing-group-chip">' +
                  getCategoryEmoji(pi.food.category) + ' ' + esc(pi.food.name) +
                  '<button class="pairing-chip-remove" data-idx="' + pairingState.items.indexOf(pi) + '">×</button>' +
                  '</div>';
              }).join('') +
            '</div>' +
          '</div>' +
          '</div>';
      });
    }

    // Add group button — always visible so user can create as many groups as needed
    html += '<button class="pairing-add-group-btn" id="pairing-add-group">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' +
      'Create new group' +
      '</button>';

    el.innerHTML = html;

    // Footer button state
    var doneBtn = document.getElementById('pairing-done-btn');
    if (doneBtn) {
      var allAssigned = pairingState.items.every(function(pi) { return pi.groupId !== null; });
      doneBtn.disabled = !allAssigned || groupIds.length === 0;
      doneBtn.textContent = 'Analyse ' + groupIds.length + ' group' + (groupIds.length !== 1 ? 's' : '');
    }

    bindPairingEvents(el);
  }

  function getGroupMap() {
    var map = {};
    pairingState.items.forEach(function(pi) {
      if (pi.groupId !== null) {
        if (!map[pi.groupId]) map[pi.groupId] = [];
        map[pi.groupId].push(pi);
      }
    });
    return map;
  }

  var GROUP_COLORS = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF3B30', '#30B0C7'];
  function getGroupColor(gid) { return GROUP_COLORS[gid % GROUP_COLORS.length]; }

  function getCategoryEmoji(cat) {
    var map = { drink:'🥤', fastfood:'🍔', meal:'🍽️', protein:'🥩', dairy:'🥛', fruit:'🍎', veg:'🥦', grain:'🌾', bakery:'🥐', dessert:'🍦', spread:'🧈', dip:'🫙', snack:'🍿' };
    return map[cat] || '🍴';
  }

  function bindPairingEvents(el) {
    // Tap item to assign to group (cycle through groups, then unassign)
    el.querySelectorAll('.pairing-item').forEach(function(card) {
      card.addEventListener('click', function() {
        var idx  = parseInt(card.dataset.idx, 10);
        var pi   = pairingState.items[idx];
        var gids = Object.keys(getGroupMap()).map(Number).sort();

        if (gids.length === 0) {
          showToast('Create a group first');
          return;
        }

        if (pi.groupId === null) {
          // Assign to first group
          pi.groupId = gids[0];
        } else {
          // Cycle to next group, or unassign
          var curIdx = gids.indexOf(pi.groupId);
          if (curIdx === gids.length - 1) {
            pi.groupId = null; // unassign
          } else {
            pi.groupId = gids[curIdx + 1];
          }
        }
        renderPairingScreen();
      });
    });

    // Remove chip from group
    el.querySelectorAll('.pairing-chip-remove').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx, 10);
        pairingState.items[idx].groupId = null;
        renderPairingScreen();
      });
    });

    // Group name inputs
    el.querySelectorAll('.pairing-group-name-input').forEach(function(input) {
      input.addEventListener('input', function() {
        var gid = parseInt(input.dataset.gid, 10);
        pairingState.groupNames[gid] = input.value;
      });
      // Stop tap on input from triggering parent
      input.addEventListener('click', function(e) { e.stopPropagation(); });
    });

    // Add group button
    var addBtn = el.querySelector('#pairing-add-group');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var newId = pairingState.nextGroupId++;
        pairingState.groupNames[newId] = '';
        pairingState.createdGroups.push(newId);
        renderPairingScreen();
        // Scroll to bottom so user sees the new group
        var pContent = document.getElementById('pairing-content');
        if (pContent) setTimeout(function(){ pContent.scrollTop = pContent.scrollHeight; }, 50);
      });
    }
  }

  function finalisePairing() {
    var groups = getGroupMap();
    // Use createdGroups order, filter out empty groups
    var groupIds = pairingState.createdGroups.filter(function(gid){ return groups[gid] && groups[gid].length > 0; });

    // Build merged food per group
    S.groups = groupIds.map(function(gid) {
      var gItems = groups[gid].map(function(pi) { return pi.food; });
      var gName  = (pairingState.groupNames[gid] || '').trim() || mergeGroupName(gItems);
      var merged = mergeFoods(gItems, gName);
      return { name: gName, items: gItems, merged: merged, result: buildResult(merged) };
    });

    S.groupIdx = 0;
    S.result   = S.groups[0].result;
    renderResults(S.result, 0, S.groups.length);
    navigate('results');
  }

  function mergeGroupName(foods) {
    if (foods.length === 1) return foods[0].name;
    return foods.map(function(f) { return f.name; }).join(' + ');
  }

  function mergeFoods(foods, name) {
    // Sum all nutritional values across foods in the group
    var merged = {
      name:      name || mergeGroupName(foods),
      brand:     foods.map(function(f) { return f.brand; }).filter(Boolean).join(', '),
      serving:   foods.map(function(f) { return f.serving; }).join(' + '),
      kcal:      0, protein: 0, carbs: 0, fat: 0,
      satFat:    0, sugar:   0, fiber: 0, sodium: 0,
      processed: foods.some(function(f) { return f.processed; }),
      category:  foods[0].category,
      swap:      foods.map(function(f) { return f.swap; }).filter(Boolean).join(' ')
    };
    foods.forEach(function(f) {
      merged.kcal    += f.kcal    || 0;
      merged.protein += f.protein || 0;
      merged.carbs   += f.carbs   || 0;
      merged.fat     += f.fat     || 0;
      merged.satFat  += f.satFat  || 0;
      merged.sugar   += f.sugar   || 0;
      merged.fiber   += f.fiber   || 0;
      merged.sodium  += f.sodium  || 0;
    });
    // Round sensibly
    ['protein','carbs','fat','satFat','sugar','fiber'].forEach(function(k) {
      merged[k] = Math.round(merged[k] * 10) / 10;
    });
    merged.kcal   = Math.round(merged.kcal);
    merged.sodium = Math.round(merged.sodium);
    return merged;
  }

  /* ─────────────────────────────────────────────────────────────
     OPEN FOOD FACTS SEARCH
     ───────────────────────────────────────────────────────────── */
  function handleManualSearch(query) {
    query = (query || '').trim();
    var el = document.getElementById('scan-search-results');
    if (!el) return;
    clearTimeout(_offTimer);
    if (_offCtrl) { try { _offCtrl.abort(); } catch (_) {} }
    if (query.length < 2) { el.innerHTML = ''; return; }
    showLocalHits(query, el);
    _offTimer = setTimeout(function() { searchOFF(query, el); }, 400);
  }

  function showLocalHits(query, el) {
    var q = query.toLowerCase();
    var hits = TallyData.FOOD_DB.filter(function(f) {
      return f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q));
    }).slice(0, 4);
    var html = '';
    if (hits.length) html += '<div class="search-results-label">Quick results</div>' + renderFoodCards(hits);
    html += '<div id="off-results"><div style="font-size:13px;color:var(--label-3);padding:var(--s3) 0">Searching 4M+ products…</div></div>';
    el.innerHTML = html;
    bindCards(el);
  }

  function searchOFF(query, el) {
    _offCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var sig = _offCtrl ? _offCtrl.signal : undefined;
    var url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query) +
      '&search_simple=1&action=process&json=1&page_size=9&fields=product_name,brands,serving_size,nutriments,nova_group,categories_tags';
    fetch(url, sig ? { signal: sig } : {})
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var products = (data.products || []).filter(function(p) {
          return p.product_name && ((p.nutriments || {})['energy-kcal_serving'] || (p.nutriments || {})['energy-kcal'] || 0) > 0;
        });
        var offEl = el.querySelector('#off-results') || el;
        if (!products.length) {
          offEl.innerHTML = '<p style="font-size:13px;color:var(--label-3);padding:var(--s3) 0">No results from Open Food Facts.</p>';
          return;
        }
        var foods = products.slice(0, 7).map(offToFood);
        offEl.innerHTML = '<div class="search-results-label">Open Food Facts · 4M+ products</div>' + renderFoodCards(foods);
        bindCards(el);
      })
      .catch(function(e) {
        if (e && e.name === 'AbortError') return;
        var offEl = el.querySelector('#off-results');
        if (offEl) offEl.innerHTML = '<p style="font-size:13px;color:var(--label-3)">Couldn\'t reach Open Food Facts.</p>';
      });
  }

  function offToFood(p) {
    var n = p.nutriments || {};
    function g(k) { return parseFloat(n[k + '_serving'] || n[k] || 0) || 0; }
    var kcal  = parseFloat(n['energy-kcal_serving'] || n['energy-kcal'] || 0) || 0;
    var sod   = g('sodium'), salt = g('salt');
    var sodMg = sod > 0 ? sod * 1000 : salt > 0 ? salt * 390 : 0;
    var cats  = (p.categories_tags || []).join(' ').toLowerCase();
    var cat   = 'meal';
    if (/snack|chip|biscuit|candy|chocolate|crisp/.test(cats))      cat = 'snack';
    else if (/beverage|drink|juice|soda|cola|water|tea|coffee/.test(cats)) cat = 'drink';
    else if (/dairy|milk|yogurt|cheese|cream/.test(cats))           cat = 'dairy';
    else if (/fruit/.test(cats))                                     cat = 'fruit';
    else if (/vegetable|veggie/.test(cats))                         cat = 'veg';
    else if (/bread|cereal|grain|pasta|rice|oat/.test(cats))        cat = 'grain';
    else if (/meat|fish|seafood|protein|egg|poultry/.test(cats))    cat = 'protein';
    else if (/dessert|ice.cream|cake|sweet/.test(cats))             cat = 'dessert';
    else if (/fast.food|burger|pizza|sandwich/.test(cats))          cat = 'fastfood';
    else if (/bakery|pastry|croissant|muffin/.test(cats))           cat = 'bakery';
    return {
      id: null,
      name:      (p.product_name || 'Unknown').slice(0, 60),
      brand:     (p.brands || '').split(',')[0].trim().slice(0, 30),
      serving:   p.serving_size || '1 serving',
      kcal:      kcal,
      protein:   g('proteins'),
      carbs:     g('carbohydrates'),
      fat:       g('fat'),
      satFat:    g('saturated-fat'),
      sugar:     g('sugars'),
      fiber:     g('fiber') || g('fibers'),
      sodium:    sodMg,
      processed: p.nova_group == 4,
      category:  cat,
      swap:      ''
    };
  }

  function renderFoodCards(foods) {
    return foods.map(function(f) {
      var safe = JSON.stringify(f).replace(/\\/g, '\\\\').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      return '<button class="sr-item" data-food=\'' + safe + '\'>' +
        '<div class="sr-item-info">' +
          '<div class="sr-item-name">' + esc(f.name) + '</div>' +
          '<div class="sr-item-meta">' + esc(f.brand || '') + (f.serving ? ' · ' + esc(f.serving) : '') + '</div>' +
        '</div>' +
        '<div class="sr-item-kcal">' + Math.round(f.kcal || 0) + ' kcal</div>' +
        '</button>';
    }).join('');
  }

  function bindCards(container) {
    container.querySelectorAll('.sr-item').forEach(function(btn) {
      if (btn._b) return;
      btn._b = true;
      btn.addEventListener('click', function() {
        try {
          var food = JSON.parse(btn.getAttribute('data-food').replace(/&quot;/g, '"'));
          if (food) {
            S.groups = [{ name: food.name, items: [food], result: buildResult(food) }];
            S.groupIdx = 0;
            S.result   = S.groups[0].result;
            renderResults(S.result, 0, 1);
            navigate('results');
          }
        } catch (e) { console.error(e); }
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     COMPOUND ANALYSIS
     ───────────────────────────────────────────────────────────── */
  function getCompounds(food) {
    var compounds = [];

    if (food.sugar > 0) {
      var sg = food.sugar >= 25 ? 'bad' : food.sugar >= 12 ? 'neutral' : 'good';
      compounds.push({ name: 'Sugar', amount: r1(food.sugar) + 'g', grade: sg,
        effect: sg === 'bad'
          ? 'High added sugar spikes blood glucose, promotes insulin resistance, and contributes to fat storage. Linked to increased risk of type 2 diabetes and cardiovascular disease with frequent consumption.'
          : sg === 'neutral'
          ? 'Moderate sugar load. Causes a blood glucose rise — pairing with fibre or protein helps slow absorption and blunt the insulin response.'
          : 'Low sugar content. Minimal impact on blood glucose. Supports stable energy and reduces the insulin burden on your pancreas.' });
    }

    if (food.satFat > 0) {
      var sfg = food.satFat >= 8 ? 'bad' : food.satFat >= 4 ? 'neutral' : 'good';
      compounds.push({ name: 'Saturated fat', amount: r1(food.satFat) + 'g', grade: sfg,
        effect: sfg === 'bad'
          ? 'Saturated fat at this level raises LDL ("bad") cholesterol, which deposits on artery walls. Frequent intake above ~20g/day is associated with increased cardiovascular disease risk.'
          : sfg === 'neutral'
          ? 'Moderate saturated fat. Current research is nuanced — dairy saturated fats behave differently than those from red meat. Overall diet pattern matters more than single items.'
          : 'Low saturated fat. Minimal cardiovascular concern at this amount.' });
    }

    if (food.sodium > 0) {
      var sodg = food.sodium >= 800 ? 'bad' : food.sodium >= 400 ? 'neutral' : 'good';
      compounds.push({ name: 'Sodium', amount: Math.round(food.sodium) + 'mg', grade: sodg,
        effect: sodg === 'bad'
          ? 'Very high sodium — over a third of the daily recommended 2300mg limit in one serving. Excess sodium causes water retention, raises blood pressure, and stresses the kidneys over time.'
          : sodg === 'neutral'
          ? 'Moderate sodium. Worth accounting for — multiple high-sodium meals stack quickly toward the 2300mg daily limit.'
          : 'Low sodium. No meaningful concern for blood pressure or fluid balance at this level.' });
    }

    if (food.fiber > 0) {
      var fibg = food.fiber >= 5 ? 'good' : food.fiber >= 2 ? 'neutral' : 'bad';
      compounds.push({ name: 'Dietary fibre', amount: r1(food.fiber) + 'g', grade: fibg,
        effect: fibg === 'good'
          ? 'Excellent fibre content. Feeds beneficial gut bacteria, slows glucose absorption, reduces LDL cholesterol, and promotes satiety. High fibre intake is one of the strongest predictors of long-term health.'
          : fibg === 'neutral'
          ? 'Some fibre — a contribution toward the 25–30g daily target, but not a primary source.'
          : 'Minimal fibre. No significant prebiotic or satiety benefit. Faster digestion means a quicker return of hunger.' });
    }

    if (food.protein > 0) {
      var goal = S.profile ? S.profile.goal : 'maintain';
      var prog = food.protein >= 20 ? 'good' : food.protein >= 8 ? 'neutral' : 'bad';
      compounds.push({ name: 'Protein', amount: r1(food.protein) + 'g', grade: prog,
        effect: prog === 'good'
          ? 'High protein hit. Essential for muscle protein synthesis, immune function, and enzyme production. ' +
            (goal === 'gain' ? 'Critical for muscle growth — a meaningful contribution toward the ~1.6–2.2g/kg daily target.'
            : goal === 'lose' ? 'The most satiating macronutrient — helps you stay full and preserve muscle in a deficit.'
            : 'Supports maintenance of muscle mass and metabolic rate.')
          : prog === 'neutral'
          ? 'Moderate protein — a partial contribution toward daily needs.'
          : 'Low protein. Minimal contribution to muscle maintenance or satiety.' });
    }

    if (food.processed) {
      compounds.push({ name: 'Ultra-processing', amount: 'NOVA 4', grade: 'bad',
        effect: 'Ultra-processed foods contain additives, emulsifiers, and flavour enhancers absent from home cooking. Research links frequent NOVA 4 consumption to increased all-cause mortality, gut microbiome disruption, and higher rates of depression and metabolic syndrome — independent of macronutrient content.' });
    }

    return compounds;
  }

  /* ─────────────────────────────────────────────────────────────
     DIET PLAN
     ───────────────────────────────────────────────────────────── */
  function generateDietPlan(food) {
    if (!S.profile || !S.budgets) return null;
    var daily = S.budgets.dailyTarget;
    var goal  = S.profile.goal;
    var name  = food.name;
    var kcal  = food.kcal || 0;
    var DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

    var breakfasts = goal === 'gain'
      ? ['Oatmeal + 2 eggs + banana','Greek yogurt + granola + berries','Wholegrain toast + peanut butter + shake','Egg scramble + avocado + toast','Overnight oats + mixed nuts + fruit','Smoothie bowl + chia seeds','Pancakes + eggs + OJ']
      : goal === 'lose'
      ? ['2 eggs + spinach + black coffee','Greek yogurt + berries','Oatmeal + cinnamon + green tea','Cottage cheese + sliced apple','Egg whites + mushrooms','2 boiled eggs + cucumber','Smoked salmon + cucumber']
      : ['Wholegrain toast + eggs + fruit','Oatmeal + banana + coffee','Yogurt + granola + berries','Egg muffins + OJ','Avocado toast + poached egg','Smoothie + toast','Scrambled eggs + toast'];

    var lunches = goal === 'gain'
      ? ['Chicken rice bowl + broccoli','Tuna sandwich + salad','Beef stir-fry + noodles','Salmon + sweet potato','Turkey wrap + avocado','Pasta + chicken + tomato sauce','Quinoa + chickpeas + roasted veg']
      : goal === 'lose'
      ? ['Grilled chicken salad','Tuna + mixed greens','Turkey lettuce wraps','Salmon + steamed broccoli','Chickpea salad + feta','Chicken soup + salad','Prawn + courgette noodles']
      : ['Chicken + rice + salad','Salmon + quinoa + greens','Turkey sandwich on rye','Veggie soup + bread','Tuna wrap + salad','Chicken stir-fry + brown rice','Lentil soup + roll'];

    var dinners = goal === 'gain'
      ? ['Beef burger + sweet potato fries','Pasta bolognese','Grilled salmon + rice','Chicken thighs + roasted potatoes','Steak + mash + salad','Pizza — 2-3 slices','Pork chops + veg']
      : goal === 'lose'
      ? ['Baked cod + asparagus','Grilled chicken + peppers','Prawn stir-fry + courgette','Salmon + spinach','Turkey mince + lettuce cups','Egg white omelette + tomatoes','Chicken broth + veg']
      : ['Grilled salmon + roasted veg','Chicken + brown rice + salad','Beef + sweet potato + greens','Veggie curry + rice','Grilled fish + new potatoes','Turkey + pasta + tomato','Steak + salad + sourdough'];

    var snacks = food.processed
      ? ['Skip — ' + name + ' budgeted today','Apple + almond butter','Mixed nuts','Greek yogurt + honey','Rice cakes + avocado','Carrots + hummus','Protein shake']
      : ['Apple + almond butter','Greek yogurt','Mixed nuts','Rice cakes + hummus', name + ' ← fits here','Banana + peanut butter','Boiled egg'];

    return DAYS.map(function(day, i) {
      var showFood = (i === 0 || i === 3);
      var snack = showFood && kcal > 0 ? name + ' (' + Math.round(kcal) + ' kcal)' : snacks[i % snacks.length];
      return { day: day, kcal: Math.round(daily), meals: [
        { label: 'Breakfast', text: breakfasts[i] },
        { label: 'Lunch',     text: lunches[i] },
        { label: 'Snack',     text: snack },
        { label: 'Dinner',    text: dinners[i] }
      ]};
    });
  }

  /* ─────────────────────────────────────────────────────────────
     RENDER RESULTS
     groupIdx: which group index this is (0-based)
     totalGroups: total number of groups
     ───────────────────────────────────────────────────────────── */
  function renderResults(r, groupIdx, totalGroups) {
    if (!r) return;
    var food = r.food, ev = r.eval, copy = r.copy, burn = r.burn, allow = r.allow;
    var isMultiGroup = totalGroups > 1;
    var isLast = (groupIdx === totalGroups - 1);

    // Group progress indicator
    var progressEl = document.getElementById('result-group-progress');
    if (progressEl) {
      if (isMultiGroup) {
        var dots = '';
        for (var i = 0; i < totalGroups; i++) {
          dots += '<div class="rg-dot' + (i === groupIdx ? ' active' : i < groupIdx ? ' done' : '') + '"></div>';
        }
        progressEl.innerHTML = '<div class="rg-progress">' + dots + '</div>' +
          '<div class="rg-label">Group ' + (groupIdx + 1) + ' of ' + totalGroups + '</div>';
        progressEl.style.display = 'block';
      } else {
        progressEl.style.display = 'none';
      }
    }

    // Header
    setText('result-food-name', food.name);
    var metaParts = [];
    if (food.brand) metaParts.push(food.brand);
    if (isMultiGroup && r.items && r.items.length > 1) {
      metaParts.push(r.items.length + ' items combined');
    } else {
      if (food.serving) metaParts.push(food.serving);
    }
    setText('result-food-meta', metaParts.join(' · '));

    // If multi-group, show constituent items
    var itemsBreakdownEl = document.getElementById('result-items-breakdown');
    if (itemsBreakdownEl) {
      var grp = S.groups[groupIdx];
      if (grp && grp.items && grp.items.length > 1) {
        itemsBreakdownEl.innerHTML =
          '<div class="section-header">Items in this group</div>' +
          '<div class="card" style="margin:0 var(--s4)">' +
          grp.items.map(function(f) {
            return '<div class="result-breakdown-row">' +
              '<span class="result-breakdown-name">' + getCategoryEmoji(f.category) + ' ' + esc(f.name) + '</span>' +
              '<span class="result-breakdown-kcal">' + Math.round(f.kcal) + ' kcal</span>' +
              '</div>';
          }).join('') +
          '</div>';
        itemsBreakdownEl.style.display = 'block';
      } else {
        itemsBreakdownEl.style.display = 'none';
      }
    }

    // Verdict pill
    var vp = document.getElementById('result-verdict-pill');
    if (vp) vp.innerHTML = '<div class="verdict-pill ' + ev.verdict + '">' +
      '<div class="verdict-pill-dot"></div>' + esc(copy.stamp) + '</div>';
    setText('result-headline', copy.headline);
    setText('result-summary',  copy.summary);

    // Nutrition
    setText('result-kcal',    Math.round(food.kcal) || 0);
    setText('result-protein', r1(food.protein) || 0);
    setText('result-carbs',   r1(food.carbs) || 0);
    setText('result-fat',     r1(food.fat) || 0);
    setText('result-sugar',   r1(food.sugar) || 0);
    setText('result-fiber',   r1(food.fiber) || 0);

    // Compounds
    var compEl = document.getElementById('result-compounds');
    if (compEl) {
      compEl.innerHTML = r.compounds.length === 0
        ? '<div style="padding:var(--s4);color:var(--label-2);font-size:15px">No significant compounds flagged.</div>'
        : r.compounds.map(function(c) {
            return '<div class="compound-item">' +
              '<div class="compound-row">' +
                '<span class="compound-name">' + esc(c.name) + '</span>' +
                '<span class="compound-badge ' + c.grade + '">' +
                  (c.grade === 'good' ? 'Beneficial' : c.grade === 'bad' ? 'Concern' : 'Neutral') +
                '</span>' +
              '</div>' +
              '<div class="compound-amount">' + esc(c.amount) + ' per serving</div>' +
              '<div class="compound-effect">' + esc(c.effect) + '</div>' +
              '</div>';
          }).join('');
    }

    // Effects
    var posEl = document.getElementById('result-positives');
    var negEl = document.getElementById('result-negatives');
    if (posEl) posEl.innerHTML = ev.positives.length
      ? ev.positives.map(function(p) { return '<div class="effect-item pos"><p>' + esc(p) + '</p></div>'; }).join('')
      : '<div style="padding:var(--s3) 0;font-size:14px;color:var(--label-2)">No positive effects flagged.</div>';
    if (negEl) negEl.innerHTML = ev.negatives.length
      ? ev.negatives.map(function(n) { return '<div class="effect-item neg"><p>' + esc(n) + '</p></div>'; }).join('')
      : '<div style="padding:var(--s3) 0;font-size:14px;color:var(--label-2)">No downsides flagged.</div>';

    // Ticket
    var tFig = document.getElementById('ticket-figure');
    var tLbl = document.getElementById('ticket-figure-label');
    var tMsg = document.getElementById('ticket-message');
    if (allow.type === 'free') {
      if (tFig) tFig.textContent = '∞';
      if (tLbl) tLbl.textContent = 'no limit';
    } else if (allow.servings !== null) {
      if (tFig) tFig.textContent = allow.servings;
      if (tLbl) tLbl.textContent = allow.servings === 1 ? 'serving left this week' : 'servings left this week';
    } else {
      if (tFig) tFig.textContent = '0';
      if (tLbl) tLbl.textContent = 'servings left this week';
    }
    if (tMsg) tMsg.textContent = allow.message;

    // Burn
    var burnEl = document.getElementById('result-burn');
    if (burnEl) {
      var bicons = {
        walk:  '<path d="M13 4a1 1 0 100-2 1 1 0 000 2z"/><path d="M7 21l2-5 3 2 2-8 3 3h2"/>',
        cycle: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h12M9 7h5l2 5H7z"/>',
        jog:   '<circle cx="12" cy="4" r="1"/><path d="M6 21l3-7 3 2 3-8 3 4h2"/>',
        swim:  '<path d="M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 11l3-3 3 2 3-4 3 2"/>',
        hiit:  '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>'
      };
      burnEl.innerHTML = (!burn || !burn.length)
        ? '<div style="padding:var(--s4);font-size:15px;color:var(--label-2)">Zero calories — nothing to burn!</div>'
        : burn.map(function(b) {
            return '<div class="burn-item">' +
              '<div class="burn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
                (bicons[b.id] || bicons.walk) +
              '</svg></div>' +
              '<div class="burn-name">' + esc(b.label) + '</div>' +
              '<div class="burn-mins">' + b.minutes + '<span> min</span></div>' +
              '</div>';
          }).join('');
    }

    // Diet plan
    var dpEl = document.getElementById('result-diet-plan');
    if (dpEl) {
      dpEl.innerHTML = !r.dietPlan
        ? '<div style="padding:var(--s4);color:var(--label-2);font-size:15px">Complete setup to get a personalised plan.</div>'
        : r.dietPlan.map(function(d) {
            return '<div class="diet-plan-day">' +
              '<div class="diet-plan-day-header">' +
                '<span class="diet-plan-day-name">' + d.day + '</span>' +
                '<span class="diet-plan-day-kcal">~' + d.kcal.toLocaleString() + ' kcal</span>' +
              '</div>' +
              '<div class="diet-plan-meals">' +
                d.meals.map(function(m) {
                  return '<div class="diet-plan-meal"><strong>' + m.label + '</strong> — ' + esc(m.text) + '</div>';
                }).join('') +
              '</div>' +
              '</div>';
          }).join('');
    }

    // Micronutrients
    renderMicronutrients(food);

    // Swap
    var swapEl = document.getElementById('result-swap');
    if (swapEl) swapEl.innerHTML = food.swap
      ? '<div class="swap-card"><div class="swap-card-label">Healthier swap</div><p>' + esc(food.swap) + '</p></div>'
      : '';

    // Action buttons
    var logBtn  = document.getElementById('log-food-btn');
    var backBtn = document.getElementById('result-back-btn');
    if (logBtn) {
      logBtn.textContent = isLast
        ? (isMultiGroup ? 'Log group & finish' : 'Log this')
        : 'Log group & next →';
    }
    if (backBtn) {
      backBtn.textContent = groupIdx > 0 ? '← Previous' : 'Back';
    }
  }

  /* ─────────────────────────────────────────────────────────────
     LOG FROM RESULTS (handles multi-group sequential flow)
     ───────────────────────────────────────────────────────────── */
  function logCurrentFood() {
    var grp = S.groups[S.groupIdx];
    if (!grp) return;
    var food = grp.result.food;
    var ev   = grp.result.eval;

    S.logs.unshift({
      id:        Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      timestamp: Date.now(),
      foodId:    food.id || null,
      name:      food.name,
      brand:     food.brand || '',
      serving:   food.serving || '',
      kcal:      food.kcal || 0,
      verdict:   ev.verdict,
      swap:      food.swap || ''
    });
    saveLogs(S.logs);
    TallyFeatures.updateStreak();
    recompute();

    showToast(food.name + ' logged');

    // Advance to next group or go home
    if (S.groupIdx < S.groups.length - 1) {
      S.groupIdx++;
      S.result = S.groups[S.groupIdx].result;
      renderResults(S.result, S.groupIdx, S.groups.length);
      // Scroll to top
      var main = document.querySelector('.app-main');
      if (main) main.scrollTop = 0;
    } else {
      S.groups = [];
      S.groupIdx = 0;
      navigate('home');
    }
  }

  function goToPrevGroup() {
    if (S.groupIdx > 0) {
      S.groupIdx--;
      S.result = S.groups[S.groupIdx].result;
      renderResults(S.result, S.groupIdx, S.groups.length);
      var main = document.querySelector('.app-main');
      if (main) main.scrollTop = 0;
    } else {
      navigate('scan');
    }
  }

  /* ─────────────────────────────────────────────────────────────
     LOG VIEW
     ───────────────────────────────────────────────────────────── */
  function renderLog() {
    recompute();
    var chartEl   = document.getElementById('week-chart');
    var contentEl = document.getElementById('log-content');
    if (!contentEl) return;

    var days    = getWeekDays();
    var daily   = S.budgets ? S.budgets.dailyTarget : 2000;
    var maxVal  = Math.max(daily * 1.2, 500);

    if (chartEl) {
      chartEl.innerHTML = days.map(function(d) {
        var tot  = d.logs.reduce(function(s, l) { return s + l.kcal; }, 0);
        var pct  = Math.min(tot / maxVal, 1);
        var over = tot > daily;
        var cls  = d.isToday ? 'today' : over ? 'over' : '';
        return '<div class="wc-bar' + (d.isToday ? ' is-today' : '') + '">' +
          '<div class="wc-track"><div class="wc-fill ' + cls + '" style="height:' + Math.round(pct * 100) + '%"></div></div>' +
          '<div class="wc-label">' + d.short + '</div>' +
          '</div>';
      }).join('');
    }

    if (!S.logs.length) {
      contentEl.innerHTML = '<div class="empty-state">' +
        '<div class="e-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg></div>' +
        '<div class="e-title">Nothing logged yet</div>' +
        '<div class="e-sub">Scan a food item to begin tracking your week.</div>' +
        '</div>';
      return;
    }

    var grouped = groupByDay(S.logs);
    contentEl.innerHTML = grouped.map(function(grp) {
      var tot = grp.logs.reduce(function(s, l) { return s + l.kcal; }, 0);
      return '<div class="day-group-header">' +
          '<span>' + grp.label + '</span>' +
          '<span class="day-group-total">' + Math.round(tot).toLocaleString() + ' kcal</span>' +
        '</div>' +
        '<div class="card" style="margin:0 var(--s4) var(--s3);border-radius:var(--r-lg);overflow:hidden">' +
        grp.logs.map(function(l) {
          return '<div class="log-entry">' +
            '<div class="log-entry-dot ' + (l.verdict || 'neutral') + '"></div>' +
            '<div class="log-entry-info">' +
              '<div class="log-entry-name">' + esc(l.name) + '</div>' +
              '<div class="log-entry-meta">' + esc(l.serving || '') + (l.brand ? ' · ' + esc(l.brand) : '') + '</div>' +
            '</div>' +
            '<div class="log-entry-kcal">' + Math.round(l.kcal) + '</div>' +
            '<button class="log-entry-del" data-id="' + l.id + '" aria-label="Delete">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>' +
            '</button>' +
            '</div>';
        }).join('') +
        '</div>';
    }).join('');

    contentEl.querySelectorAll('.log-entry-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        S.logs = S.logs.filter(function(l) { return l.id !== btn.dataset.id; });
        saveLogs(S.logs);
        recompute();
        renderLog();
        renderTopbar();
      });
    });
  }

  function getWeekDays() {
    var now = new Date(), ws = TallyCalc.getWeekStart(now);
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(short, i) {
      var d  = new Date(ws.getTime() + i * 86400000);
      var ds = d.getTime(), de = ds + 86400000;
      return {
        short:   short,
        date:    d,
        logs:    S.logs.filter(function(l) { return l.timestamp >= ds && l.timestamp < de; }),
        isToday: d.toDateString() === now.toDateString()
      };
    });
  }

  function groupByDay(logs) {
    var map = {}, order = [];
    logs.forEach(function(l) {
      var k = new Date(l.timestamp).toDateString();
      if (!map[k]) { map[k] = { label: fmtDay(new Date(l.timestamp)), ts: l.timestamp, logs: [] }; order.push(k); }
      map[k].logs.push(l);
    });
    var seen = {};
    var unique = order.filter(function(k) { if (seen[k]) return false; seen[k] = true; return true; });
    unique.sort(function(a, b) { return map[b].ts - map[a].ts; });
    return unique.map(function(k) { return map[k]; });
  }

  function fmtDay(date) {
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (date.toDateString() === y.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /* ─────────────────────────────────────────────────────────────
     SETTINGS
     ───────────────────────────────────────────────────────────── */
  function renderSettings() {
    if (!S.profile || !S.budgets) return;
    var p = S.profile, b = S.budgets;
    setText('settings-name', p.name || 'Profile');
    var goalObj = TallyData.GOALS[p.goal] || {};
    var dietObj = TallyData.DIET_PHILOSOPHIES[p.diet] || {};
    var actObj  = TallyData.ACTIVITY_LEVELS[p.activity] || {};
    setText('settings-goal-sub',  (goalObj.label || p.goal) + ' · ' + (dietObj.label || p.diet));
    setText('stat-daily',         fmtK(b.dailyTarget));
    setText('stat-weekly',        fmtK(b.weeklyBudget));
    setText('stat-flex',          fmtK(b.flexibleBudget));
    setText('stat-bmr',           fmtK(b.bmr));
    setText('settings-goal-label', goalObj.label || p.goal);
    setText('settings-diet-label', dietObj.label || p.diet);
    setText('settings-act-label',  actObj.label  || p.activity);
    setText('settings-pace-label', (((goalObj.paces || {})[p.pace]) || {}).desc || p.pace);

    var av = document.getElementById('profile-avatar');
    if (av) av.textContent = (p.name || '?').charAt(0).toUpperCase();
    renderThemeGrid();

    var ks = document.getElementById('apikey-status');
    var kd = document.getElementById('key-dot');
    if (ks) ks.textContent = S.apiKey
      ? S.apiKey.slice(0, 8) + '…' + S.apiKey.slice(-4) + ' (tap Edit to change)'
      : 'Not set — tap Scan to add your free key';
    if (kd) kd.className = 'key-dot' + (S.apiKey ? '' : ' unset');
  }

  /* ─────────────────────────────────────────────────────────────
     ONBOARDING
     ───────────────────────────────────────────────────────────── */
  var ob = { step: 0, data: { name:'', sex:'female', weightKg:null, heightCm:null, age:null, units:'metric', activity:'moderate', goal:'lose', pace:'standard', diet:'balanced' } };
  var OB_STEPS = ['basics','body','activity','goal','diet'];

  function showOnboarding() { document.getElementById('onboarding').classList.remove('hidden'); ob.step = 0; renderObStep(); }
  function hideOnboarding() { document.getElementById('onboarding').classList.add('hidden'); }

  function renderObStep() {
    OB_STEPS.forEach(function(s, i) {
      var el = document.getElementById('ob-' + s);
      if (el) el.className = 'ob-step' + (i === ob.step ? ' active' : '');
    });
    document.querySelectorAll('.ob-progress-dot').forEach(function(d, i) {
      d.className = 'ob-progress-dot' + (i < ob.step ? ' done' : i === ob.step ? ' active' : '');
    });
    var bb = document.getElementById('ob-back'); if (bb) bb.classList.toggle('hidden', ob.step === 0);
    var nb = document.getElementById('ob-next'); if (nb) nb.textContent = ob.step === OB_STEPS.length - 1 ? 'Get started' : 'Continue';
    clearObError();
  }

  function obNext() { if (!validateObStep()) return; if (ob.step === OB_STEPS.length - 1) { finishOnboarding(); return; } ob.step++; renderObStep(); }
  function obBack() { if (ob.step > 0) { ob.step--; renderObStep(); } }

  function validateObStep() {
    var s = OB_STEPS[ob.step]; clearObError();
    if (s === 'basics') {
      var name = document.getElementById('ob-name').value.trim();
      var age  = parseInt(document.getElementById('ob-age').value, 10);
      if (!name) { showObError('Please enter your name.'); return false; }
      if (!age || age < 10 || age > 120) { showObError('Please enter a valid age (10–120).'); return false; }
      ob.data.name = name; ob.data.age = age;
      var sp = document.querySelector('#ob-basics .option-item.selected input');
      if (sp) ob.data.sex = sp.value;
    }
    if (s === 'body') {
      if (ob.data.units === 'metric') {
        var wkg = parseFloat(document.getElementById('ob-weight-kg').value);
        var hcm = parseFloat(document.getElementById('ob-height-cm').value);
        if (!wkg || wkg < 30 || wkg > 300) { showObError('Enter weight in kg (30–300).'); return false; }
        if (!hcm || hcm < 100 || hcm > 250) { showObError('Enter height in cm (100–250).'); return false; }
        ob.data.weightKg = wkg; ob.data.heightCm = hcm;
      } else {
        var wlb = parseFloat(document.getElementById('ob-weight-lb').value);
        var hft = parseInt(document.getElementById('ob-height-ft').value, 10);
        var hin = parseInt(document.getElementById('ob-height-in').value, 10) || 0;
        if (!wlb || wlb < 66 || wlb > 660) { showObError('Enter weight in lbs (66–660).'); return false; }
        if (!hft || hft < 3 || hft > 8) { showObError('Enter height in feet (3–8).'); return false; }
        ob.data.weightKg = TallyCalc.lbsToKg(wlb);
        ob.data.heightCm = TallyCalc.ftInToCm(hft, hin);
      }
    }
    if (s === 'activity') { var ap = document.querySelector('#ob-activity .option-item.selected input'); if (!ap) { showObError('Please select activity level.'); return false; } ob.data.activity = ap.value; }
    if (s === 'goal') {
      var gp = document.querySelector('#ob-goal .goal-group .option-item.selected input');
      if (!gp) { showObError('Please select a goal.'); return false; }
      ob.data.goal = gp.value;
      var pp = document.querySelector('#ob-goal .pace-group .option-item.selected input');
      ob.data.pace = pp ? pp.value : ((TallyData.GOALS[ob.data.goal] || {}).defaultPace || 'standard');
    }
    if (s === 'diet') { var dp = document.querySelector('#ob-diet .option-item.selected input'); if (!dp) { showObError('Please choose a diet style.'); return false; } ob.data.diet = dp.value; }
    return true;
  }

  function finishOnboarding() {
    S.profile = { name: ob.data.name, sex: ob.data.sex, age: ob.data.age, weightKg: ob.data.weightKg, heightCm: ob.data.heightCm, activity: ob.data.activity, goal: ob.data.goal, pace: ob.data.pace, diet: ob.data.diet, units: ob.data.units };
    saveProfile(S.profile); recompute(); hideOnboarding(); navigate('home'); renderTopbar();
  }

  function showObError(msg) { var el = document.getElementById('ob-error'); if (el) { el.textContent = msg; el.className = 'ob-error visible'; } }
  function clearObError()   { var el = document.getElementById('ob-error'); if (el) { el.textContent = ''; el.className = 'ob-error'; } }

  function setObUnits(units) {
    ob.data.units = units;
    document.querySelectorAll('#unit-seg button').forEach(function(b) { b.classList.toggle('active', b.dataset.units === units); });
    document.getElementById('metric-fields').classList.toggle('hidden', units !== 'metric');
    document.getElementById('imperial-fields').classList.toggle('hidden', units !== 'imperial');
  }

  function updatePacePills() {
    var goalVal = (document.querySelector('#ob-goal .goal-group .option-item.selected input') || {}).value;
    var ps = document.getElementById('ob-pace-section');
    if (!ps) return;
    if (!goalVal || goalVal === 'maintain') { ps.style.display = 'none'; return; }
    ps.style.display = 'block';
    var pg = ps.querySelector('.pace-group');
    var goalObj = TallyData.GOALS[goalVal] || {}, paces = goalObj.paces || {};
    pg.innerHTML = Object.keys(paces).map(function(pk) {
      var pace = paces[pk], isD = pk === goalObj.defaultPace;
      return '<label class="option-item' + (isD ? ' selected' : '') + '">' +
        '<input type="radio" name="ob_pace" value="' + pk + '"' + (isD ? ' checked' : '') + '>' +
        '<div class="option-radio"></div>' +
        '<div class="option-body"><div class="option-title">' + pace.label + '</div><div class="option-desc">' + pace.desc + '</div></div>' +
        '</label>';
    }).join('');
    bindOptions(pg);
  }

  function bindOptions(container) {
    (container || document).querySelectorAll('.option-item input[type="radio"]').forEach(function(input) {
      input.addEventListener('change', function() {
        var name = input.getAttribute('name');
        document.querySelectorAll('.option-item input[name="' + name + '"]').forEach(function(o) {
          o.closest('.option-item').classList.toggle('selected', o === input);
        });
        if (name === 'ob_goal') updatePacePills();
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     OFFLINE BANNER
     ───────────────────────────────────────────────────────────── */
  function showOfflineBanner() {
    var b = document.getElementById('offline-banner');
    if (b) b.classList.add('show');
  }
  function hideOfflineBanner() {
    var b = document.getElementById('offline-banner');
    if (b) b.classList.remove('show');
  }

  /* ─────────────────────────────────────────────────────────────
     TOAST
     ───────────────────────────────────────────────────────────── */
  var _tt = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_tt);
    _tt = setTimeout(function() { t.classList.remove('show'); }, 2200);
  }

  /* ─────────────────────────────────────────────────────────────
     HELPERS
     ───────────────────────────────────────────────────────────── */
  function esc(s)     { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function setText(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
  function fmt(n)  { n = Math.round(n || 0); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString() + ' kcal'; }
  function fmtK(n) { return Math.abs(Math.round(n || 0)).toLocaleString(); }
  function r1(n)   { return Math.round((n || 0) * 10) / 10; }

  /* ─────────────────────────────────────────────────────────────
     WIRE EVENTS
     ───────────────────────────────────────────────────────────── */
  function wire() {
    // Online/offline awareness — search and AI scan both need a network
    // connection; tell the user proactively rather than letting every
    // fetch silently fail one at a time.
    window.addEventListener('online',  function() {
      hideOfflineBanner();
      showToast('Back online');
    });
    window.addEventListener('offline', function() {
      showOfflineBanner();
    });
    if (!navigator.onLine) showOfflineBanner();

    // Bottom nav
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var v = btn.dataset.nav;
        if (v && S.profile) navigate(v);
        else if (!S.profile) showToast('Complete setup first');
      });
    });

    // Onboarding
    document.getElementById('ob-next').addEventListener('click', obNext);
    document.getElementById('ob-back').addEventListener('click', obBack);
    document.querySelectorAll('#unit-seg button').forEach(function(b) {
      b.addEventListener('click', function() { setObUnits(b.dataset.units); });
    });
    bindOptions(document);

    // Camera
    var cam = document.getElementById('camera-input');
    if (cam) cam.addEventListener('change', function() {
      if (cam.files && cam.files[0]) { handleImageCapture(cam.files[0]); cam.value = ''; }
    });
    var scanBtn = document.getElementById('take-photo-btn');
    if (scanBtn) scanBtn.addEventListener('click', function() { document.getElementById('camera-input').click(); });

    // Search
    var si = document.getElementById('scan-search-input');
    if (si) si.addEventListener('input', function() { handleManualSearch(si.value); });

    // Results navigation
    var logBtn  = document.getElementById('log-food-btn');
    var backBtn = document.getElementById('result-back-btn');
    if (logBtn)  logBtn.addEventListener('click',  logCurrentFood);
    if (backBtn) backBtn.addEventListener('click',  goToPrevGroup);

    // Pairing screen done button
    var pairingDone = document.getElementById('pairing-done-btn');
    if (pairingDone) pairingDone.addEventListener('click', finalisePairing);

    // Pairing back to scan
    var pairingBack = document.getElementById('pairing-back-btn');
    if (pairingBack) pairingBack.addEventListener('click', function() { navigate('scan'); });

    // API key
    var ckBtn = document.getElementById('change-apikey-btn');
    if (ckBtn) ckBtn.addEventListener('click', function() {
      showApiKeyScreen(function() { renderSettings(); showToast('Key saved'); });
    });
    var cancelKey = document.getElementById('apikey-cancel-btn');
    if (cancelKey) cancelKey.addEventListener('click', hideApiKeyScreen);

    // Reset
    var editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) editBtn.addEventListener('click', function() {
      document.getElementById('confirm-modal').classList.add('visible');
    });
    document.getElementById('modal-cancel').addEventListener('click', function() {
      document.getElementById('confirm-modal').classList.remove('visible');
    });
    document.getElementById('modal-confirm').addEventListener('click', function() {
      document.getElementById('confirm-modal').classList.remove('visible');
      S.logs = []; saveLogs(S.logs); S.profile = null; saveProfile(null); showOnboarding();
    });
    document.getElementById('confirm-modal').addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('visible');
    });

    // Home scan CTA
    var hScan = document.getElementById('home-scan-btn');
    if (hScan) hScan.addEventListener('click', function() { navigate('scan'); });
  }


  /* ─────────────────────────────────────────────────────────────
     WATER SECTION
     ───────────────────────────────────────────────────────────── */
  function renderWaterSection() {
    var el = document.getElementById('water-section');
    if (!el) return;
    var ml      = TallyFeatures.getWaterMl();
    var goal    = TallyFeatures.WATER_GOAL_ML;
    var glasses = TallyFeatures.GLASS_ML;
    var pct     = Math.min(ml / goal, 1);
    var filled  = Math.floor(ml / glasses);
    var total   = Math.ceil(goal / glasses);

    var glassHtml = '';
    for (var i = 0; i < total; i++) {
      glassHtml += '<button class="water-glass' + (i < filled ? ' filled' : '') + '" data-glass="' + i + '" aria-label="Glass ' + (i+1) + '">💧</button>';
    }

    el.innerHTML =
      '<div class="water-card">' +
        '<div class="water-header">' +
          '<div class="water-title"><span class="water-title-emoji">💧</span> Hydration</div>' +
          '<div class="water-amount">' + ml + '<span> / ' + goal + ' ml</span></div>' +
        '</div>' +
        '<div class="water-track"><div class="water-fill" style="width:' + Math.round(pct*100) + '%"></div></div>' +
        '<div class="water-glasses">' + glassHtml + '</div>' +
        '<div class="water-actions">' +
          '<button class="water-btn water-btn-add" id="water-add-btn">+ ' + glasses + ' ml</button>' +
          '<button class="water-btn water-btn-remove" id="water-remove-btn">− ' + glasses + ' ml</button>' +
        '</div>' +
      '</div>';

    var addBtn = el.querySelector('#water-add-btn');
    var remBtn = el.querySelector('#water-remove-btn');
    if (addBtn) addBtn.addEventListener('click', function() {
      TallyFeatures.addWater(glasses);
      renderWaterSection();
      showToast('💧 ' + TallyFeatures.getWaterMl() + ' ml today');
    });
    if (remBtn) remBtn.addEventListener('click', function() {
      TallyFeatures.removeWater(glasses);
      renderWaterSection();
    });
    // Tap glass to toggle
    el.querySelectorAll('.water-glass').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var idx = parseInt(btn.dataset.glass, 10);
        var cur = Math.floor(TallyFeatures.getWaterMl() / glasses);
        if (idx < cur) {
          TallyFeatures.removeWater(glasses);
        } else {
          TallyFeatures.addWater(glasses);
        }
        renderWaterSection();
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     STREAK SECTION
     ───────────────────────────────────────────────────────────── */
  function renderStreakSection() {
    var el = document.getElementById('streak-section');
    if (!el) return;
    var data   = TallyFeatures.getStreakData();
    var badges = TallyFeatures.getBadges(data, S.logs);
    var streak = data.current;
    var flame  = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : streak >= 1 ? '✨' : '○';

    var badgeHtml = '';
    if (badges.length > 0) {
      badgeHtml = '<div style="padding:0 var(--s4) var(--s4)">' +
        '<div class="section-header" style="padding:0;margin-bottom:var(--s3)">Badges earned</div>' +
        '<div class="badges-grid">' +
        badges.map(function(b) {
          return '<div class="badge-cell">' +
            '<div class="badge-emoji">' + b.emoji + '</div>' +
            '<div class="badge-info"><div class="badge-name">' + esc(b.name) + '</div><div class="badge-desc">' + esc(b.desc) + '</div></div>' +
            '</div>';
        }).join('') +
        '</div></div>';
    }

    el.innerHTML =
      '<div style="padding:0 0 0 0">' +
        '<div class="streak-bar">' +
          '<div class="streak-flame">' + flame + '</div>' +
          '<div class="streak-info">' +
            '<div class="streak-number">' + streak + '</div>' +
            '<div class="streak-label">' + (streak === 1 ? 'day streak' : 'day streak') + '</div>' +
            (data.best > streak ? '<div class="streak-best">Personal best: ' + data.best + ' days</div>' : '') +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:12px;color:var(--label-3);margin-bottom:4px">Today</div>' +
            '<div style="font-size:13px;font-weight:600;color:' + (data.lastLogDate === new Date().toDateString() ? 'var(--positive)' : 'var(--label-3)') + '">' +
              (data.lastLogDate === new Date().toDateString() ? '✓ Logged' : 'Not yet') +
            '</div>' +
          '</div>' +
        '</div>' +
        badgeHtml +
      '</div>';
  }

  /* ─────────────────────────────────────────────────────────────
     MOOD SECTION
     ───────────────────────────────────────────────────────────── */
  var _moodState = { emoji: null, energy: 0 };

  function renderMoodSection() {
    // mood-section-wrap is a dedicated div already in HTML (inside home view)
    var moodEl = document.getElementById('mood-section-wrap');
    if (!moodEl) return;

    var today = TallyFeatures.getTodayMood();
    if (today) {
      moodEl.innerHTML =
        '<div class="mood-card">' +
          '<div class="mood-title">Today\'s check-in</div>' +
          '<div class="mood-done-state">' +
            '<div class="mood-done-emoji">' + today.emoji + '</div>' +
            '<div class="mood-done-text">Energy ' + today.energy + '/5 — thanks for checking in today.</div>' +
          '</div>' +
        '</div>';
      return;
    }

    var emojis = ['😴','😐','🙂','😄','🚀'];
    var emojiHtml = emojis.map(function(e, i) {
      return '<button class="mood-emoji-btn' + (_moodState.emoji === e ? ' selected' : '') + '" data-emoji="' + e + '" aria-label="' + e + '">' + e + '</button>';
    }).join('');

    var energyDots = '';
    for (var i = 1; i <= 5; i++) {
      var cls = i <= _moodState.energy ? (i >= 4 ? ' lit high' : ' lit') : '';
      energyDots += '<button class="mood-energy-dot' + cls + '" data-level="' + i + '" aria-label="Energy level ' + i + ' of 5"><span class="mood-energy-num">' + i + '</span></button>';
    }

    moodEl.innerHTML =
      '<div class="mood-card">' +
        '<div class="mood-title">How are you feeling today?</div>' +
        '<div class="mood-emojis" id="mood-emojis">' + emojiHtml + '</div>' +
        '<div class="mood-energy-label">Energy level</div>' +
        '<div class="mood-energy-row" id="mood-energy">' + energyDots + '</div>' +
        '<button class="mood-submit-btn" id="mood-submit" ' + (!_moodState.emoji || !_moodState.energy ? 'disabled' : '') + '>Save check-in</button>' +
      '</div>';

    moodEl.querySelectorAll('.mood-emoji-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _moodState.emoji = btn.dataset.emoji;
        renderMoodSection();
      });
    });
    moodEl.querySelectorAll('.mood-energy-dot').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _moodState.energy = parseInt(btn.dataset.level, 10);
        renderMoodSection();
      });
    });
    var submitBtn = moodEl.querySelector('#mood-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        if (!_moodState.emoji || !_moodState.energy) return;
        var savedEmoji = _moodState.emoji;
        TallyFeatures.logMood(_moodState.energy, savedEmoji);
        _moodState = { emoji: null, energy: 0 };
        renderMoodSection();
        showToast('Check-in saved ' + savedEmoji);
      });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     MICRONUTRIENTS
     ───────────────────────────────────────────────────────────── */
  function renderMicronutrients(food) {
    var el = document.getElementById('result-micros');
    var disc = document.getElementById('micro-disclaimer');
    if (!el) return;

    var micros  = TallyFeatures.estimateMicronutrients(food);
    var rdv     = TallyFeatures.MICRO_RDV;
    var labels  = TallyFeatures.MICRO_LABELS;
    var keys    = Object.keys(labels);

    el.innerHTML = keys.map(function(k) {
      var val  = micros[k] || 0;
      var pct  = Math.min(Math.round(val / rdv[k] * 100), 150);
      var cls  = pct >= 20 ? 'rich' : 'low';
      return '<div class="micro-cell">' +
        '<div class="micro-cell-header">' +
          '<span class="micro-cell-name">' + labels[k].name + '</span>' +
          '<span class="micro-cell-pct">' + pct + '% DV</span>' +
        '</div>' +
        '<div>' +
          '<span class="micro-cell-val">' + val + '</span>' +
          '<span class="micro-cell-unit">' + labels[k].unit + '</span>' +
        '</div>' +
        '<div class="micro-bar"><div class="micro-bar-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div></div>' +
        '</div>';
    }).join('');

    if (disc) disc.textContent = '* Micronutrient values are category-based estimates for planning guidance, not lab-measured amounts.';
  }

  /* ─────────────────────────────────────────────────────────────
     THEME GRID
     ───────────────────────────────────────────────────────────── */
  function renderThemeGrid() {
    var el = document.getElementById('theme-grid');
    if (!el) return;
    var current = TallyFeatures.loadTheme();
    var themes  = TallyFeatures.THEMES;

    el.innerHTML = Object.keys(themes).map(function(id) {
      var t = themes[id];
      return '<div class="theme-swatch theme-swatch-' + id + (id === current ? ' active' : '') + '" data-theme="' + id + '">' +
        '<div class="theme-swatch-circle">' + t.emoji + '</div>' +
        '<div class="theme-swatch-name">' + t.name + '</div>' +
        '</div>';
    }).join('');

    el.querySelectorAll('.theme-swatch').forEach(function(sw) {
      sw.addEventListener('click', function() {
        var id = sw.dataset.theme;
        TallyFeatures.applyTheme(id);
        renderThemeGrid();
        showToast(TallyFeatures.THEMES[id].emoji + ' ' + TallyFeatures.THEMES[id].name + ' theme applied');
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     GPS RUN VIEW
     ───────────────────────────────────────────────────────────── */
  var _runSummary = null;

  function renderRunView() {
    var el = document.getElementById('run-view-content');
    if (!el) return;
    var F = TallyFeatures;

    TallyFeatures.setRunUpdateCallback(function() {
      if (document.querySelector('[data-view="run"].active')) renderRunView();
    });

    if (_runSummary) {
      renderRunSummary(el, _runSummary);
      return;
    }

    // Offer recovery of a run interrupted by an accidental tab close
    if (!F.runState.active && !_runRecoveryDismissed) {
      var recovery = F.getRunRecovery();
      if (recovery) {
        renderRunRecoveryPrompt(el, recovery);
        return;
      }
    }

    var rs       = F.runState;
    var active   = rs.active;
    var paused   = rs.paused;
    var dur      = F.getRunDurationMs();
    var dist     = rs.distanceKm || 0;
    var pace     = F.getPace();
    var cals     = rs.calories || 0;
    var weightKg = S.profile ? S.profile.weightKg : 70;
    var gpsStatus = rs.gpsStatus;

    // Detect a tracking gap: if the screen was locked/backgrounded and Wake
    // Lock failed (pre-iOS 18.4 PWA bug, or low battery rejection), GPS fixes
    // stop arriving entirely. Surface this honestly instead of showing a
    // confidently "live" UI that's actually frozen.
    var lastFix = rs.positions.length ? rs.positions[rs.positions.length - 1] : null;
    var gapMs   = (active && !paused && lastFix) ? (Date.now() - lastFix.ts) : 0;
    var trackingStale = gapMs > 30000; // no GPS fix in 30+ seconds while "active"

    var statusText = active
      ? (paused ? 'Paused'
        : trackingStale ? 'Tracking interrupted'
        : gpsStatus === 'acquiring' ? 'Finding GPS signal…'
        : gpsStatus === 'weak-signal' ? 'Weak GPS signal'
        : 'Running')
      : 'Ready to run';
    var dotClass = active
      ? (paused || trackingStale ? 'paused' : (gpsStatus === 'weak-signal' || gpsStatus === 'acquiring' ? 'paused' : ''))
      : 'idle';

    var controls = '';
    if (!active) {
      controls = '<button class="run-btn run-btn-start" id="run-start-btn">' +
        '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        'Start Run</button>';
    } else if (paused) {
      controls =
        '<button class="run-btn run-btn-resume" id="run-resume-btn">' +
          '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
          'Resume' +
        '</button>' +
        '<button class="run-btn run-btn-stop" id="run-stop-btn">' +
          '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>' +
          'Finish' +
        '</button>';
    } else {
      controls =
        '<button class="run-btn run-btn-pause" id="run-pause-btn">' +
          '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' +
          'Pause' +
        '</button>' +
        '<button class="run-btn run-btn-stop" id="run-stop-btn">' +
          '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>' +
          'Finish' +
        '</button>';
    }

    var mapHtml = renderRunMap(rs.positions);

    // Honest, accurate guidance based on real iOS/PWA constraints — not
    // claiming "background tracking" works, because it genuinely doesn't.
    var tips = !active ? [
      { icon: '📍', text: 'Allow location access when prompted. GPS accuracy improves after about 10–15 seconds of movement.' },
      { icon: '🔆', text: 'Keep this screen open and unlocked for the whole run — tracking pauses if your phone sleeps or you switch apps.' },
      { icon: '🎯', text: 'For best accuracy, enable Precise Location for Safari in Settings → Privacy → Location Services.' },
      { icon: '🔥', text: 'Calories burned are calculated from your body weight and running MET values, and auto-logged when you finish.' },
    ] : [];

    // Weak signal / GPS warning banner
    var warningHtml = '';
    if (active && !paused) {
      if (trackingStale) {
        warningHtml = '<div class="run-warning">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' +
          '<span>No GPS update in over 30 seconds — your screen may have locked. Keep this screen open and unlocked to keep tracking.</span>' +
          '</div>';
      } else if (gpsStatus === 'weak-signal') {
        warningHtml = '<div class="run-warning">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' +
          '<span>Weak GPS signal — distance may be inaccurate. Move to an open area or check Precise Location is on.</span>' +
          '</div>';
      } else if (gpsStatus === 'acquiring') {
        warningHtml = '<div class="run-warning info">' +
          '<div class="spinner" style="border-top-color:var(--accent);width:14px;height:14px"></div>' +
          '<span>Locating you… distance tracking starts once GPS locks on.</span>' +
          '</div>';
      }
    }

    el.innerHTML =
      '<div style="padding:var(--s4) 0 0">' +
        '<div class="run-hero">' +
          '<div class="run-status-row">' +
            '<div class="run-status-dot ' + dotClass + '"></div>' +
            '<span class="run-status-text">' + statusText + '</span>' +
          '</div>' +
          '<div class="run-timer">' + F.formatDuration(dur) + '</div>' +
          '<div class="run-stats-row">' +
            '<div class="run-stat"><div class="run-stat-value">' + dist.toFixed(2) + '</div><div class="run-stat-label">km</div></div>' +
            '<div class="run-stat"><div class="run-stat-value">' + (pace ? F.formatPace(pace) : '--:--') + '</div><div class="run-stat-label">pace</div></div>' +
            '<div class="run-stat"><div class="run-stat-value">' + Math.round(cals) + '</div><div class="run-stat-label">kcal</div></div>' +
          '</div>' +
        '</div>' +

        warningHtml +

        '<div class="run-controls" style="margin-top:var(--s4)">' + controls + '</div>' +

        mapHtml +

        (tips.length ? '<div class="run-tips" style="margin-top:var(--s4)">' +
          '<div class="run-tips-title">Before you start</div>' +
          tips.map(function(t) { return '<div class="run-tip"><span class="run-tip-icon">' + t.icon + '</span><span>' + t.text + '</span></div>'; }).join('') +
          '</div>' : '') +

        '<div style="height:var(--s6)"></div>' +
      '</div>';

    var startBtn  = el.querySelector('#run-start-btn');
    var pauseBtn  = el.querySelector('#run-pause-btn');
    var resumeBtn = el.querySelector('#run-resume-btn');
    var stopBtn   = el.querySelector('#run-stop-btn');

    if (startBtn) startBtn.addEventListener('click', function() {
      if (!navigator.geolocation) { showToast('GPS not available on this device'); return; }
      F.startRun(weightKg, {
        onError: function(type) {
          if (type === 'denied') {
            showToast('Location access denied — check Settings → Privacy → Location Services');
          } else {
            showToast('GPS unavailable on this device');
          }
          renderRunView();
        }
      });
      renderRunView();
    });
    if (pauseBtn)  pauseBtn.addEventListener('click',  function() { F.pauseRun();  renderRunView(); });
    if (resumeBtn) resumeBtn.addEventListener('click', function() { F.resumeRun(); renderRunView(); });
    if (stopBtn) stopBtn.addEventListener('click', function() {
      var summary = F.stopRun();
      if (summary) {
        _runSummary = summary;
        if (summary.calories > 0) {
          S.logs.unshift({
            id:        Date.now() + '-run',
            timestamp: Date.now(),
            foodId:    null,
            name:      'Run — ' + summary.distanceKm.toFixed(2) + ' km',
            brand:     '',
            serving:   F.formatDuration(summary.durationMs),
            kcal:      -Math.round(summary.calories),
            verdict:   'positive',
            swap:      ''
          });
          saveLogs(S.logs);
          TallyFeatures.updateStreak();
          recompute();
          renderTopbar();
        }
        renderRunView();
      }
    });
  }

  var _runRecoveryDismissed = false;

  function renderRunRecoveryPrompt(el, recovery) {
    var F = TallyFeatures;
    var elapsedMs = (recovery.savedAt - recovery.startTime) - recovery.pausedMs;
    var distKm    = recovery.distanceKm || 0;
    var ago       = Math.round((Date.now() - recovery.savedAt) / 60000);

    el.innerHTML =
      '<div style="padding:var(--s4) 0 0">' +
        '<div class="run-recovery-card">' +
          '<div class="run-recovery-icon">\u26A0\uFE0F</div>' +
          '<div class="run-recovery-title">Unfinished run found</div>' +
          '<div class="run-recovery-sub">It looks like a run was interrupted ' + (ago < 1 ? 'just now' : ago + ' min ago') + ' \u2014 maybe the app was closed accidentally.</div>' +
          '<div class="run-recovery-stats">' +
            '<div><strong>' + distKm.toFixed(2) + ' km</strong><span> tracked</span></div>' +
            '<div><strong>' + F.formatDuration(Math.max(0, elapsedMs)) + '</strong><span> elapsed</span></div>' +
          '</div>' +
          '<div class="action-row" style="padding:0;margin-top:var(--s4)">' +
            '<button class="btn btn-ghost" id="recovery-discard-btn">Discard</button>' +
            '<button class="btn btn-primary" id="recovery-log-btn">Log it &amp; finish</button>' +
          '</div>' +
        '</div>' +
        '<div style="height:var(--s6)"></div>' +
      '</div>';

    var discardBtn = el.querySelector('#recovery-discard-btn');
    var logBtn     = el.querySelector('#recovery-log-btn');

    if (discardBtn) discardBtn.addEventListener('click', function() {
      TallyFeatures.discardRunRecovery();
      _runRecoveryDismissed = true;
      renderRunView();
    });
    if (logBtn) logBtn.addEventListener('click', function() {
      var weightKg = S.profile ? S.profile.weightKg : 70;
      var mins     = Math.max(0, elapsedMs) / 60000;
      var cals     = Math.round((8.0 * 3.5 * weightKg / 200) * mins);
      if (cals > 0) {
        S.logs.unshift({
          id:        Date.now() + '-run-recovered',
          timestamp: Date.now(),
          foodId:    null,
          name:      'Run \u2014 ' + distKm.toFixed(2) + ' km (recovered)',
          brand:     '',
          serving:   F.formatDuration(Math.max(0, elapsedMs)),
          kcal:      -cals,
          verdict:   'positive',
          swap:      ''
        });
        saveLogs(S.logs);
        TallyFeatures.updateStreak();
        recompute();
        renderTopbar();
        showToast('Recovered run logged');
      }
      TallyFeatures.discardRunRecovery();
      _runRecoveryDismissed = true;
      renderRunView();
    });
  }

  function renderRunMap(positions) {
    if (!positions || positions.length < 2) {
      return '<div class="run-map-container" style="margin-top:var(--s4)">' +
        '<div class="run-map-placeholder">' +
          '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
          'Route will appear here once you start moving' +
        '</div>' +
        '</div>';
    }

    // Normalize to SVG viewport
    var lats = positions.map(function(p) { return p.lat; });
    var lngs = positions.map(function(p) { return p.lng; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var W = 360, H = 180, pad = 20;

    function toX(lng) { return maxLng === minLng ? W/2 : pad + (lng - minLng) / (maxLng - minLng) * (W - pad*2); }
    function toY(lat) { return maxLat === minLat ? H/2 : pad + (maxLat - lat) / (maxLat - minLat) * (H - pad*2); }

    var pts = positions.map(function(p) { return toX(p.lng) + ',' + toY(p.lat); }).join(' ');
    var last = positions[positions.length - 1];

    return '<div class="run-map-container" style="margin-top:var(--s4)">' +
      '<svg class="run-map-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
        '<polyline points="' + pts + '" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>' +
        // Start dot
        '<circle cx="' + toX(positions[0].lng) + '" cy="' + toY(positions[0].lat) + '" r="6" fill="var(--positive)"/>' +
        // End dot
        '<circle cx="' + toX(last.lng) + '" cy="' + toY(last.lat) + '" r="6" fill="var(--accent)"/>' +
        '<circle cx="' + toX(last.lng) + '" cy="' + toY(last.lat) + '" r="10" fill="var(--accent)" opacity="0.25"/>' +
      '</svg>' +
      '</div>';
  }

  function renderRunSummary(el, summary) {
    var F = TallyFeatures;
    var mins = summary.durationMs / 60000;
    var avgSpeedKmh = mins > 0 ? (summary.distanceKm / mins * 60) : 0;

    el.innerHTML =
      '<div style="padding:var(--s4) 0 0">' +
        '<div class="run-summary-card">' +
          '<div class="run-summary-title">🏁 Run complete!</div>' +
          '<div class="run-summary-grid">' +
            '<div class="run-summary-stat"><div class="val">' + summary.distanceKm.toFixed(2) + '</div><div class="lbl">Kilometres</div></div>' +
            '<div class="run-summary-stat"><div class="val">' + F.formatDuration(summary.durationMs) + '</div><div class="lbl">Duration</div></div>' +
            '<div class="run-summary-stat"><div class="val">' + (summary.paceMinKm ? F.formatPace(summary.paceMinKm) : '--') + '</div><div class="lbl">Avg pace</div></div>' +
            '<div class="run-summary-stat"><div class="val">' + summary.calories + '</div><div class="lbl">kcal burned</div></div>' +
            '<div class="run-summary-stat"><div class="val">' + avgSpeedKmh.toFixed(1) + '</div><div class="lbl">km/h avg</div></div>' +
            '<div class="run-summary-stat"><div class="val">' + summary.positions.length + '</div><div class="lbl">GPS points</div></div>' +
          '</div>' +
          (summary.calories > 0 ? '<div style="background:var(--positive-bg);border-radius:var(--r-sm);padding:var(--s3) var(--s4);font-size:14px;color:var(--positive);font-weight:600;margin-bottom:var(--s4)">−' + summary.calories + ' kcal auto-logged to this week\'s balance ✓</div>' : '') +
          renderRunMap(summary.positions) +
          '<div class="action-row" style="padding:var(--s4) 0 0;margin:0">' +
            '<button class="btn btn-primary" id="run-new-btn">New run</button>' +
            '<button class="btn btn-ghost" id="run-home-btn">Home</button>' +
          '</div>' +
        '</div>' +
        '<div style="height:var(--s6)"></div>' +
      '</div>';

    var newBtn  = el.querySelector('#run-new-btn');
    var homeBtn = el.querySelector('#run-home-btn');
    if (newBtn) newBtn.addEventListener('click', function() { _runSummary = null; renderRunView(); });
    if (homeBtn) homeBtn.addEventListener('click', function() { _runSummary = null; navigate('home'); });
  }


    document.addEventListener('DOMContentLoaded', function() { wire(); init(); });

})();
