/* Tally — main application
 * Depends on: data.js, calc.js
 * AI scan  : Google Gemini 1.5 Flash (free tier, user's own key stored locally)
 * Food DB  : Open Food Facts — 4M+ products, no API key needed
 */
(function () {
  'use strict';

  var STORAGE_KEY_PROFILE = 'tally_profile_v1';
  var STORAGE_KEY_LOGS    = 'tally_logs_v1';
  var STORAGE_KEY_APIKEY  = 'tally_gemini_key_v1';

  function loadProfile() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE)) || null; } catch (_) { return null; } }
  function saveProfile(p) { localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(p)); }
  function loadLogs() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS)) || []; } catch (_) { return []; } }
  function saveLogs(l) { localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(l)); }
  function loadApiKey() { try { return localStorage.getItem(STORAGE_KEY_APIKEY) || ''; } catch (_) { return ''; } }
  function saveApiKey(k) { localStorage.setItem(STORAGE_KEY_APIKEY, k.trim()); }

  var state = { profile: null, logs: [], budgets: null, weekState: null, currentResult: null, geminiKey: '' };

  function recompute() {
    if (!state.profile) return;
    state.budgets   = TallyCalc.deriveBudgets(state.profile);
    state.weekState = TallyCalc.computeWeekState(state.logs, state.budgets);
  }

  function init() {
    state.profile   = loadProfile();
    state.logs      = loadLogs();
    state.geminiKey = loadApiKey();
    recompute();
    if (!state.profile) { showOnboarding(); } else { hideOnboarding(); navigate('home'); }
    renderTopbar();
  }

  var currentView = null;
  function navigate(viewId) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.dataset.view === viewId); });
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === viewId); });
    currentView = viewId;
    if (viewId === 'home')     renderHome();
    if (viewId === 'scan')     renderScan();
    if (viewId === 'log')      renderLog();
    if (viewId === 'settings') renderSettings();
  }

  function renderTopbar() {
    if (!state.profile || !state.budgets) return;
    var el = document.getElementById('topbar-meta');
    if (!el) return;
    var rem = state.weekState ? state.weekState.totalRemaining : state.budgets.weeklyBudget;
    el.innerHTML = '<span class="label">This week</span>' + fmtKcal(rem) + ' left';
  }

  /* ---- HOME ---- */
  function renderHome() {
    if (!state.profile || !state.budgets || !state.weekState) return;
    var ws = state.weekState;
    var pct = Math.min(ws.totalUsed / ws.weeklyBudget, 1);
    var isOver = ws.totalUsed > ws.weeklyBudget;
    document.getElementById('ledger-remaining').textContent = fmtKcal(ws.totalRemaining);
    document.getElementById('ledger-used').textContent      = fmtKcal(ws.totalUsed) + ' used';
    document.getElementById('ledger-budget').textContent    = fmtKcal(ws.weeklyBudget) + ' budget';
    var fill = document.getElementById('ledger-gauge');
    fill.style.width = Math.round(pct * 100) + '%';
    fill.className   = 'gauge-fill' + (isOver ? ' over' : pct < 0.5 ? ' good' : '');
    var flexPct = Math.min(ws.flexibleUsed / (ws.flexibleBudget || 1), 1);
    document.getElementById('flex-used').textContent      = fmtKcal(ws.flexibleUsed) + ' / ' + fmtKcal(ws.flexibleBudget);
    document.getElementById('flex-remaining').textContent = fmtKcal(Math.max(0, ws.flexibleRemaining));
    var fFill = document.getElementById('flex-gauge');
    fFill.style.width = Math.round(flexPct * 100) + '%';
    fFill.className   = 'gauge-fill' + (flexPct >= 1 ? ' over' : '');
    renderRecentScans();
    renderHabits();
    renderTopbar();
  }

  function renderRecentScans() {
    var el = document.getElementById('recent-scans');
    if (!el) return;
    var logs = state.logs.slice().sort(function (a, b) { return b.timestamp - a.timestamp; }).slice(0, 5);
    if (logs.length === 0) { el.innerHTML = '<div class="empty-state"><div class="emoji-rule"></div><p class="title">Nothing logged yet</p><p>Scan your first item to get started.</p></div>'; return; }
    el.innerHTML = '<ul class="receipt-list">' + logs.map(function (l) {
      return '<li class="receipt-item-row"><div class="verdict-dot ' + (l.verdict || 'neutral') + '"></div><div class="receipt-row"><span class="name">' + esc(l.name) + '</span><span class="leader"></span><span class="value text-' + (l.verdict || 'neutral') + '">' + fmtKcal(l.kcal) + '</span></div></li>';
    }).join('') + '</ul>';
  }

  function renderHabits() {
    var el = document.getElementById('habits-section');
    if (!el) return;
    var flags = TallyCalc.detectHabits(state.logs);
    if (flags.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="section-title" style="margin-top:var(--sp-5)">Pattern watch</p>' + flags.map(function (f) {
      return '<div class="card habit-card" style="margin-top:var(--sp-2)"><div style="display:flex;justify-content:space-between;align-items:baseline"><span style="font-weight:700;font-size:14px">' + esc(f.name) + '</span><span class="habit-count">&times;' + f.count + ' this week</span></div>' + (f.swap ? '<div class="habit-swap">Swap idea: ' + esc(f.swap) + '</div>' : '') + '</div>';
    }).join('');
  }

  /* ---- API KEY SCREEN ---- */
  function showApiKeyScreen(onSuccess) {
    var el = document.getElementById('apikey-screen');
    if (!el) return;
    el.classList.remove('hidden');
    var input = document.getElementById('apikey-input');
    var err   = document.getElementById('apikey-error');
    var btn   = document.getElementById('apikey-save-btn');
    err.classList.add('hidden');
    input.value = state.geminiKey || '';

    function trySave() {
      var key = input.value.trim();
      if (!key || key.length < 20) { err.textContent = 'Doesn\'t look right — Gemini keys start with "AIza" and are ~39 chars.'; err.classList.remove('hidden'); return; }
      saveApiKey(key); state.geminiKey = key;
      el.classList.add('hidden');
      if (typeof onSuccess === 'function') onSuccess();
    }
    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', trySave);
    input.onkeydown = function (e) { if (e.key === 'Enter') trySave(); };
  }
  function hideApiKeyScreen() { var el = document.getElementById('apikey-screen'); if (el) el.classList.add('hidden'); }

  /* ---- SCAN VIEW ---- */
  var scanState = { imageDataUrl: null, scanning: false };
  var _offTimer = null, _offCtrl = null;

  function renderScan() {
    var vf = document.getElementById('vf-image');
    if (vf) { vf.src = ''; vf.classList.add('hidden'); }
    var ph = document.getElementById('vf-placeholder');
    if (ph) ph.classList.remove('hidden');
    hideScanStatus();
    var inp = document.getElementById('scan-search-input'); if (inp) inp.value = '';
    var res = document.getElementById('scan-search-results'); if (res) res.innerHTML = '';
  }

  function hideScanStatus() { var s = document.getElementById('scan-status'); if (s) s.classList.add('hidden'); }
  function showScanStatus(msg) {
    var s = document.getElementById('scan-status'); if (!s) return;
    var t = s.querySelector('.scan-status-text'); if (t) t.textContent = msg;
    s.classList.remove('hidden');
  }

  function handleImageCapture(file) {
    if (!file) return;
    var img = new Image();
    var obj = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(obj);
      var MAX = 1024, w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      scanState.imageDataUrl = dataUrl;
      var vf = document.getElementById('vf-image'), ph = document.getElementById('vf-placeholder');
      if (vf) { vf.src = dataUrl; vf.classList.remove('hidden'); }
      if (ph) ph.classList.add('hidden');
      if (!state.geminiKey) { showApiKeyScreen(function () { triggerAIScan(dataUrl); }); }
      else { triggerAIScan(dataUrl); }
    };
    img.onerror = function () { URL.revokeObjectURL(obj); showScanStatus('Could not load image — try again'); setTimeout(hideScanStatus, 3000); };
    img.src = obj;
  }

  function triggerAIScan(dataUrl) {
    if (scanState.scanning) return;
    scanState.scanning = true;
    showScanStatus('Identifying food\u2026');
    var base64 = dataUrl.split(',')[1];
    var mime   = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
    var url    = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(state.geminiKey);
    var prompt = buildGeminiPrompt();
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 600 }
      })
    })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (b) {
        var detail = (b.error && b.error.message) || ('HTTP ' + r.status);
        throw new Error(detail);
      });
      return r.json();
    })
    .then(function (data) {
      scanState.scanning = false; hideScanStatus();
      var raw = '';
      try { raw = data.candidates[0].content.parts[0].text || ''; } catch (_) {}
      var clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      var match = clean.match(/\{[\s\S]*\}/); if (match) clean = match[0];
      try {
        var result = JSON.parse(clean);
        if (result && result.name) { handleScanResult(result); }
        else { showScanStatus('Couldn\'t read food \u2014 try search below'); setTimeout(hideScanStatus, 3000); }
      } catch (_) { showScanStatus('Couldn\'t parse result \u2014 try search below'); setTimeout(hideScanStatus, 3000); }
    })
    .catch(function (err) {
      scanState.scanning = false;
      var msg = String(err.message || err);
      if (msg.includes('API_KEY') || msg.includes('403') || msg.includes('401') || msg.includes('API key')) {
        hideScanStatus();
        showApiKeyScreen(function () { triggerAIScan(scanState.imageDataUrl); });
      } else if (msg.includes('not found') || msg.includes('404') || msg.includes('INVALID_ARGUMENT')) {
        showScanStatus('API error: ' + msg.slice(0, 80)); setTimeout(hideScanStatus, 6000);
      } else {
        showScanStatus('Error: ' + msg.slice(0, 55) + ' \u2014 try search'); setTimeout(hideScanStatus, 5000);
      }
    });
  }

  function buildGeminiPrompt() {
    var p = state.profile;
    var goal = p ? (TallyData.GOALS[p.goal] || {}).label || p.goal : 'general health';
    return 'You are a nutrition expert. Analyse the food/drink in this image. User goal: ' + goal + '.\nReturn ONLY a single valid JSON object (no markdown, no text before or after) with these exact keys:\n{"name":"","brand":"","serving":"","kcal":0,"protein":0,"carbs":0,"fat":0,"satFat":0,"sugar":0,"fiber":0,"sodium":0,"processed":false,"category":"","swap":""}\nname=concise food name, brand=brand or "", serving=e.g."1 bar (50g)", kcal=calories(int), protein/carbs/fat/satFat/sugar/fiber=grams, sodium=mg, processed=true if ultra-processed, category=one of[snack drink fastfood meal protein dairy fruit veg grain bakery dessert spread dip], swap=one-sentence healthier swap or "".\nUse label values if readable. Otherwise use well-known standard values. Return ONLY the JSON.';
  }

  function handleScanResult(food) {
    ['kcal','protein','carbs','fat','satFat','sugar','fiber','sodium'].forEach(function (k) { food[k] = parseFloat(food[k]) || 0; });
    food.processed = !!food.processed;
    food.name    = (food.name    || 'Unknown food').slice(0, 60);
    food.serving = food.serving  || '1 serving';
    food.swap    = food.swap     || '';
    var eval_ = TallyCalc.evaluateFood(food, state.profile);
    var copy   = TallyCalc.verdictCopy(eval_.verdict, state.profile);
    var burn   = TallyCalc.calcBurnOff(food.kcal, state.profile ? state.profile.weightKg : 70);
    var allow  = TallyCalc.calcWeeklyAllowance(food, eval_.verdict, state.weekState);
    state.currentResult = { food: food, eval: eval_, copy: copy, burn: burn, allow: allow };
    renderResults(state.currentResult);
    navigate('results');
  }

  /* ---- OPEN FOOD FACTS SEARCH ---- */
  function handleManualSearch(query) {
    query = (query || '').trim();
    var el = document.getElementById('scan-search-results');
    if (!el) return;
    clearTimeout(_offTimer);
    if (_offCtrl) { try { _offCtrl.abort(); } catch (_) {} }
    if (query.length < 2) { el.innerHTML = ''; return; }
    showLocalHits(query, el);
    _offTimer = setTimeout(function () { searchOFF(query, el); }, 380);
  }

  function showLocalHits(query, el) {
    var q = query.toLowerCase();
    var hits = TallyData.FOOD_DB.filter(function (f) {
      return f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q));
    }).slice(0, 4);
    var html = '';
    if (hits.length > 0) html += '<div style="font-size:11px;color:var(--ink-faint);font-family:var(--font-mono);letter-spacing:0.08em;text-transform:uppercase;padding:2px 0 var(--sp-2)">Quick results</div>' + renderFoodCards(hits);
    html += '<div id="off-results"><div style="font-size:12px;color:var(--ink-faint);font-family:var(--font-mono);padding:var(--sp-1) 0">Searching 4M+ products\u2026</div></div>';
    el.innerHTML = html;
    bindSearchCards(el);
  }

  function searchOFF(query, el) {
    _offCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var sig = _offCtrl ? _offCtrl.signal : undefined;
    var url = 'https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query) +
      '&search_simple=1&action=process&json=1&page_size=9&fields=product_name,brands,serving_size,nutriments,nova_group,categories_tags';
    fetch(url, sig ? { signal: sig } : {})
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var products = (data.products || []).filter(function (p) {
          return p.product_name && ((p.nutriments || {})['energy-kcal_serving'] || (p.nutriments || {})['energy-kcal'] || 0) > 0;
        });
        var offEl = el.querySelector('#off-results') || el;
        if (products.length === 0) { offEl.innerHTML = '<p style="font-size:12px;color:var(--ink-faint);padding:var(--sp-1) 0">No results from Open Food Facts.</p>'; return; }
        var foods = products.slice(0, 7).map(offToFood);
        offEl.innerHTML = '<div style="font-size:11px;color:var(--ink-faint);font-family:var(--font-mono);letter-spacing:0.08em;text-transform:uppercase;padding:var(--sp-2) 0 var(--sp-2)">Open Food Facts (4M+ products)</div>' + renderFoodCards(foods);
        bindSearchCards(el);
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError') return;
        var offEl = el.querySelector('#off-results');
        if (offEl) offEl.innerHTML = '<p style="font-size:12px;color:var(--ink-faint)">Couldn\'t reach Open Food Facts \u2014 check connection.</p>';
      });
  }

  function offToFood(p) {
    var n = p.nutriments || {};
    function g(key) { return parseFloat(n[key + '_serving'] || n[key] || 0) || 0; }
    var kcal = parseFloat(n['energy-kcal_serving'] || n['energy-kcal'] || n['energy_kcal_serving'] || 0) || 0;
    var sodiumG = g('sodium'); var saltG = g('salt');
    var sodiumMg = sodiumG > 0 ? sodiumG * 1000 : saltG > 0 ? saltG * 390 : 0;
    var cats = (p.categories_tags || []).join(' ').toLowerCase();
    var cat = 'meal';
    if (/snack|chip|biscuit|candy|chocolate|crisp/.test(cats)) cat = 'snack';
    else if (/beverage|drink|juice|soda|cola|water|tea|coffee/.test(cats)) cat = 'drink';
    else if (/dairy|milk|yogurt|cheese|cream/.test(cats)) cat = 'dairy';
    else if (/fruit/.test(cats)) cat = 'fruit';
    else if (/vegetable|veggie/.test(cats)) cat = 'veg';
    else if (/bread|cereal|grain|pasta|rice|oat/.test(cats)) cat = 'grain';
    else if (/meat|fish|seafood|protein|egg|poultry/.test(cats)) cat = 'protein';
    else if (/dessert|ice.cream|cake|sweet/.test(cats)) cat = 'dessert';
    else if (/fast.food|burger|pizza|sandwich/.test(cats)) cat = 'fastfood';
    else if (/bakery|pastry|croissant|muffin/.test(cats)) cat = 'bakery';
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
      sodium:    sodiumMg,
      processed: p.nova_group == 4,
      category:  cat,
      swap:      ''
    };
  }

  function renderFoodCards(foods) {
    return foods.map(function (f) {
      var safe = JSON.stringify(f).replace(/\\/g, '\\\\').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      return '<button class="search-result" data-food=\'' + safe + '\'>' +
        '<div><div class="sr-name">' + esc(f.name) + '</div>' +
        (f.brand ? '<div class="sr-brand">' + esc(f.brand) + '</div>' : '') +
        '<div class="sr-brand">' + esc(f.serving) + '</div></div>' +
        '<div class="sr-kcal">' + Math.round(f.kcal || 0) + '<span style="font-size:11px;font-weight:400"> kcal</span></div>' +
        '</button>';
    }).join('');
  }

  function bindSearchCards(container) {
    container.querySelectorAll('.search-result').forEach(function (btn) {
      if (btn._bound) return; btn._bound = true;
      btn.addEventListener('click', function () {
        try {
          var raw = btn.getAttribute('data-food');
          if (!raw) return;
          var food = JSON.parse(raw.replace(/&quot;/g, '"'));
          if (food) handleScanResult(food);
        } catch (e) { console.error('card parse', e); }
      });
    });
  }

  /* ---- RESULTS ---- */
  function renderResults(r) {
    if (!r) return;
    var food = r.food, eval_ = r.eval, copy = r.copy, burn = r.burn, allow = r.allow;
    document.getElementById('result-food-name').textContent = food.name;
    document.getElementById('result-food-meta').textContent = [food.brand, food.serving].filter(Boolean).join(' \u00b7 ');
    var stamp = document.getElementById('result-stamp');
    stamp.textContent = copy.stamp; stamp.className = 'stamp ' + eval_.verdict;
    document.getElementById('result-headline').textContent = copy.headline;
    document.getElementById('result-summary').textContent  = copy.summary;
    document.getElementById('result-kcal').textContent    = Math.round(food.kcal) || 0;
    document.getElementById('result-protein').textContent = round1(food.protein) || 0;
    document.getElementById('result-carbs').textContent   = round1(food.carbs) || 0;
    document.getElementById('result-fat').textContent     = round1(food.fat) || 0;
    document.getElementById('result-sugar').textContent   = round1(food.sugar) || 0;
    document.getElementById('result-fiber').textContent   = round1(food.fiber) || 0;
    document.getElementById('result-positives').innerHTML = eval_.positives.length
      ? '<ul>' + eval_.positives.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
      : '<p class="effects-empty">No positive effects flagged.</p>';
    document.getElementById('result-negatives').innerHTML = eval_.negatives.length
      ? '<ul>' + eval_.negatives.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
      : '<p class="effects-empty">No downsides flagged.</p>';
    var tFig = document.getElementById('ticket-figure'), tLbl = document.getElementById('ticket-figure-label'), tMsg = document.getElementById('ticket-message');
    if (allow.type === 'free') { tFig.textContent = '\u221e'; tLbl.textContent = 'no limit'; }
    else if (allow.servings !== null) { tFig.textContent = allow.servings; tLbl.textContent = allow.servings === 1 ? 'serving left this week' : 'servings left this week'; }
    else { tFig.textContent = '0'; tLbl.textContent = 'servings left this week'; }
    tMsg.textContent = allow.message;
    var burnEl = document.getElementById('result-burn');
    if (!burn || burn.length === 0) { burnEl.innerHTML = '<p class="faint" style="font-size:13px">Zero calories \u2014 nothing to burn!</p>'; }
    else {
      var icons = { walk: walkIcon(), cycle: cycleIcon(), jog: jogIcon(), swim: swimIcon(), hiit: hiitIcon() };
      burnEl.innerHTML = '<div class="burn-list">' + burn.map(function (b) {
        return '<div class="burn-row"><div class="burn-icon">' + (icons[b.id] || walkIcon()) + '</div><div class="burn-name">' + esc(b.label) + '</div><div class="burn-time">' + b.minutes + '<span class="unit"> min</span></div></div>';
      }).join('') + '</div>';
    }
    var swapEl = document.getElementById('result-swap');
    swapEl.innerHTML = food.swap
      ? '<div class="card" style="background:var(--wheat-bg);border-color:var(--wheat);margin-top:var(--sp-3)"><p class="eyebrow" style="color:var(--wheat);margin-bottom:var(--sp-2)">Swap idea</p><p style="font-size:13px">' + esc(food.swap) + '</p></div>'
      : '';
  }

  /* ---- LOG FROM RESULTS ---- */
  function logCurrentFood() {
    if (!state.currentResult) return;
    var food = state.currentResult.food, eval_ = state.currentResult.eval;
    state.logs.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2,7), timestamp: Date.now(), foodId: food.id || null, name: food.name, brand: food.brand || '', serving: food.serving || '', kcal: food.kcal || 0, verdict: eval_.verdict, swap: food.swap || '' });
    saveLogs(state.logs); recompute();
    showToast('Logged ' + food.name); navigate('home');
  }

  /* ---- LOG VIEW ---- */
  function renderLog() {
    recompute();
    var el = document.getElementById('log-content');
    if (!el) return;
    if (state.logs.length === 0) { el.innerHTML = '<div class="empty-state"><div class="emoji-rule"></div><p class="title">Nothing logged yet</p><p>Scan a food item to begin tracking.</p></div>'; return; }
    var days = getWeekDays(), dailyBudget = state.budgets ? state.budgets.dailyTarget : 2000, maxVal = Math.max(dailyBudget * 1.1, 100);
    var barsHtml = '<div class="week-bars">' + days.map(function (d) {
      var total = d.logs.reduce(function (s, l) { return s + l.kcal; }, 0);
      var pct = Math.min(total / maxVal, 1), isOver = total > dailyBudget;
      var cls = d.isToday ? 'today' : isOver ? 'over' : '';
      return '<div class="week-bar' + (d.isToday ? ' is-today' : '') + '"><div class="bar-track"><div class="bar-fill ' + cls + '" style="height:' + Math.round(pct * 100) + '%"></div></div><div class="bar-label">' + d.short + '</div></div>';
    }).join('') + '</div>';
    var grouped = groupByDay(state.logs);
    var daysHtml = grouped.map(function (group) {
      var total = group.logs.reduce(function (s, l) { return s + l.kcal; }, 0);
      return '<div class="day-group"><div class="day-title"><span>' + group.label + '</span><span class="day-total">' + fmtKcal(total) + '</span></div>' +
        group.logs.map(function (l) {
          return '<div class="log-row"><div class="verdict-dot ' + (l.verdict || 'neutral') + '" style="flex-shrink:0;margin-bottom:0"></div><div class="log-main"><div class="log-name">' + esc(l.name) + '</div><div class="log-meta">' + esc(l.serving || '') + (l.brand ? ' \u00b7 ' + esc(l.brand) : '') + '</div></div><div class="log-kcal">' + Math.round(l.kcal) + '</div><button class="log-delete" data-log-id="' + l.id + '" aria-label="Delete">' + trashIcon() + '</button></div>';
        }).join('') + '</div>';
    }).join('');
    el.innerHTML = barsHtml + daysHtml;
    el.querySelectorAll('.log-delete').forEach(function (btn) { btn.addEventListener('click', function () { deleteLog(btn.dataset.logId); }); });
  }

  function deleteLog(id) { state.logs = state.logs.filter(function (l) { return l.id !== id; }); saveLogs(state.logs); recompute(); renderLog(); renderTopbar(); }

  function getWeekDays() {
    var now = new Date(), ws = TallyCalc.getWeekStart(now), labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    return labels.map(function (short, i) {
      var d = new Date(ws.getTime() + i * 86400000), ds = d.getTime(), de = ds + 86400000;
      return { short: short, date: d, logs: state.logs.filter(function (l) { return l.timestamp >= ds && l.timestamp < de; }), isToday: d.toDateString() === now.toDateString() };
    });
  }

  function groupByDay(logs) {
    var map = {}, order = [];
    logs.forEach(function (l) { var k = new Date(l.timestamp).toDateString(); if (!map[k]) { map[k] = { label: formatDay(new Date(l.timestamp)), ts: l.timestamp, logs: [] }; order.push(k); } map[k].logs.push(l); });
    var seen = {}; var unique = order.filter(function (k) { if (seen[k]) return false; seen[k] = true; return true; });
    unique.sort(function (a, b) { return map[b].ts - map[a].ts; });
    return unique.map(function (k) { return map[k]; });
  }

  function formatDay(date) {
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (date.toDateString() === y.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /* ---- SETTINGS ---- */
  function renderSettings() {
    if (!state.profile || !state.budgets) return;
    var p = state.profile, b = state.budgets;
    document.getElementById('settings-name').textContent     = p.name || 'Your profile';
    document.getElementById('stat-daily').textContent        = fmtKcal(b.dailyTarget);
    document.getElementById('stat-weekly').textContent       = fmtKcal(b.weeklyBudget);
    document.getElementById('stat-flex').textContent         = fmtKcal(b.flexibleBudget);
    document.getElementById('stat-bmr').textContent          = fmtKcal(b.bmr);
    var goalObj = TallyData.GOALS[p.goal] || {}, dietObj = TallyData.DIET_PHILOSOPHIES[p.diet] || {}, actObj = TallyData.ACTIVITY_LEVELS[p.activity] || {};
    document.getElementById('settings-goal-label').textContent = goalObj.label || p.goal;
    document.getElementById('settings-diet-label').textContent = dietObj.label || p.diet;
    document.getElementById('settings-act-label').textContent  = actObj.label || p.activity;
    document.getElementById('settings-pace-label').textContent = (((goalObj.paces || {})[p.pace]) || {}).desc || p.pace;
    var ks = document.getElementById('apikey-status');
    if (ks) { ks.textContent = state.geminiKey ? state.geminiKey.slice(0,8) + '\u2026' + state.geminiKey.slice(-4) + ' (tap to change)' : 'Not set \u2014 tap Scan to add your free key'; ks.style.color = state.geminiKey ? 'var(--moss)' : 'var(--brick)'; }
  }

  /* ---- ONBOARDING ---- */
  var ob = { step: 0, data: { name:'', sex:'female', weightKg:null, heightCm:null, age:null, units:'metric', activity:'moderate', goal:'lose', pace:'standard', diet:'balanced' } };
  var OB_STEPS = ['basics','body','activity','goal','diet'];
  function showOnboarding() { document.getElementById('onboarding').classList.remove('hidden'); ob.step = 0; renderObStep(); }
  function hideOnboarding() { document.getElementById('onboarding').classList.add('hidden'); }
  function renderObStep() {
    var stepId = OB_STEPS[ob.step];
    OB_STEPS.forEach(function (s) { var e = document.getElementById('ob-' + s); if (e) e.classList.toggle('hidden', s !== stepId); });
    document.querySelectorAll('.step-dots span').forEach(function (d, i) { d.className = i < ob.step ? 'done' : i === ob.step ? 'current' : ''; });
    var bb = document.getElementById('ob-back'); if (bb) bb.classList.toggle('hidden', ob.step === 0);
    var nb = document.getElementById('ob-next'); if (nb) nb.textContent = ob.step === OB_STEPS.length - 1 ? 'Get started' : 'Continue';
    clearObError();
  }
  function obNext() { if (!validateObStep()) return; if (ob.step === OB_STEPS.length - 1) { finishOnboarding(); return; } ob.step++; renderObStep(); }
  function obBack() { if (ob.step > 0) { ob.step--; renderObStep(); } }
  function validateObStep() {
    var s = OB_STEPS[ob.step]; clearObError();
    if (s === 'basics') {
      var name = document.getElementById('ob-name').value.trim(), age = parseInt(document.getElementById('ob-age').value, 10);
      if (!name) { showObError('Please enter your name.'); return false; }
      if (!age || age < 10 || age > 120) { showObError('Please enter a valid age (10\u2013120).'); return false; }
      ob.data.name = name; ob.data.age = age;
      var sp = document.querySelector('#ob-basics .pill.checked input'); if (sp) ob.data.sex = sp.value;
    }
    if (s === 'body') {
      if (ob.data.units === 'metric') {
        var wkg = parseFloat(document.getElementById('ob-weight-kg').value), hcm = parseFloat(document.getElementById('ob-height-cm').value);
        if (!wkg || wkg < 30 || wkg > 300) { showObError('Enter weight in kg (30\u2013300).'); return false; }
        if (!hcm || hcm < 100 || hcm > 250) { showObError('Enter height in cm (100\u2013250).'); return false; }
        ob.data.weightKg = wkg; ob.data.heightCm = hcm;
      } else {
        var wlb = parseFloat(document.getElementById('ob-weight-lb').value), hft = parseInt(document.getElementById('ob-height-ft').value, 10), hin = parseInt(document.getElementById('ob-height-in').value, 10) || 0;
        if (!wlb || wlb < 66 || wlb > 660) { showObError('Enter weight in lbs (66\u2013660).'); return false; }
        if (!hft || hft < 3 || hft > 8) { showObError('Enter height in feet (3\u20138).'); return false; }
        ob.data.weightKg = TallyCalc.lbsToKg(wlb); ob.data.heightCm = TallyCalc.ftInToCm(hft, hin);
      }
    }
    if (s === 'activity') { var ap = document.querySelector('#ob-activity .pill.checked input'); if (!ap) { showObError('Please select your activity level.'); return false; } ob.data.activity = ap.value; }
    if (s === 'goal') {
      var gp = document.querySelector('#ob-goal .pill.checked input'); if (!gp) { showObError('Please select a goal.'); return false; }
      ob.data.goal = gp.value;
      var pp = document.querySelector('#ob-goal .pace-group .pill.checked input');
      ob.data.pace = pp ? pp.value : ((TallyData.GOALS[ob.data.goal] || {}).defaultPace || 'standard');
    }
    if (s === 'diet') { var dp = document.querySelector('#ob-diet .pill.checked input'); if (!dp) { showObError('Please choose a diet style.'); return false; } ob.data.diet = dp.value; }
    return true;
  }
  function finishOnboarding() {
    state.profile = { name: ob.data.name, sex: ob.data.sex, age: ob.data.age, weightKg: ob.data.weightKg, heightCm: ob.data.heightCm, activity: ob.data.activity, goal: ob.data.goal, pace: ob.data.pace, diet: ob.data.diet, units: ob.data.units };
    saveProfile(state.profile); recompute(); hideOnboarding(); navigate('home'); renderTopbar();
  }
  function showObError(msg) { var el = document.getElementById('ob-error'); if (el) { el.textContent = msg; el.classList.remove('hidden'); } }
  function clearObError() { var el = document.getElementById('ob-error'); if (el) { el.textContent = ''; el.classList.add('hidden'); } }
  function setObUnits(units) {
    ob.data.units = units;
    document.querySelectorAll('.unit-toggle button').forEach(function (b) { b.classList.toggle('active', b.dataset.units === units); });
    document.getElementById('metric-fields').classList.toggle('hidden', units !== 'metric');
    document.getElementById('imperial-fields').classList.toggle('hidden', units !== 'imperial');
  }
  function updatePacePills() {
    var goalVal = (document.querySelector('#ob-goal .goal-group .pill.checked input') || {}).value;
    var ps = document.getElementById('ob-pace-section'); if (!ps) return;
    if (!goalVal || goalVal === 'maintain') { ps.classList.add('hidden'); return; }
    ps.classList.remove('hidden');
    var pg = ps.querySelector('.pace-group'), goalObj = TallyData.GOALS[goalVal] || {}, paces = goalObj.paces || {};
    pg.innerHTML = Object.keys(paces).map(function (pk) {
      var pace = paces[pk], isD = pk === goalObj.defaultPace;
      return '<label class="pill' + (isD ? ' checked' : '') + '"><input type="radio" name="ob_pace" value="' + pk + '"' + (isD ? ' checked' : '') + '><div class="pill-mark"></div><div class="pill-body"><div class="pill-title">' + pace.label + '</div><div class="pill-desc">' + pace.desc + '</div></div></label>';
    }).join('');
    bindPillRadios(pg);
  }

  /* ---- PILL RADIOS ---- */
  function bindPillRadios(container) {
    (container || document).querySelectorAll('.pill input[type="radio"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var name = input.getAttribute('name');
        document.querySelectorAll('.pill input[name="' + name + '"]').forEach(function (o) { o.closest('.pill').classList.toggle('checked', o === input); });
        if (name === 'ob_goal') updatePacePills();
      });
    });
  }

  /* ---- TOAST ---- */
  var _toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(_toastTimer); _toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ---- HELPERS ---- */
  function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtKcal(n) { n = Math.round(n || 0); return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString() + ' kcal'; }
  function round1(n) { return Math.round((n || 0) * 10) / 10; }

  /* ---- ICONS ---- */
  function walkIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="1.5"/><path d="M9 12l2-4 2.5 2L16 8"/><path d="M9 12l-1 5h4l1-3 2 3h2"/><path d="M8 17l-1 4"/></svg>'; }
  function cycleIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h12M9 7h5l2 5H7l2-5z"/><circle cx="13" cy="5" r="1"/></svg>'; }
  function jogIcon()   { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1.5"/><path d="M7 21l3-6 2 3 3-9 2 4h2"/><path d="M6 12l2-3 4 1"/></svg>'; }
  function swimIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 12l3-3 3 2 3-4 3 2"/><circle cx="18" cy="6" r="1.5"/></svg>'; }
  function hiitIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'; }
  function trashIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'; }

  /* ---- WIRE EVENTS ---- */
  function wireEvents() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.dataset.nav;
        if (v && state.profile) navigate(v);
        else if (!state.profile) showToast('Complete setup first');
      });
    });
    document.getElementById('ob-next').addEventListener('click', obNext);
    document.getElementById('ob-back').addEventListener('click', obBack);
    document.querySelectorAll('.unit-toggle button').forEach(function (b) { b.addEventListener('click', function () { setObUnits(b.dataset.units); }); });
    bindPillRadios(document);
    var camInput = document.getElementById('camera-input');
    if (camInput) { camInput.addEventListener('change', function () { if (camInput.files && camInput.files[0]) { handleImageCapture(camInput.files[0]); camInput.value = ''; } }); }
    var scanBtn = document.getElementById('take-photo-btn');
    if (scanBtn) { scanBtn.addEventListener('click', function () { document.getElementById('camera-input').click(); }); }
    var searchInput = document.getElementById('scan-search-input');
    if (searchInput) { searchInput.addEventListener('input', function () { handleManualSearch(searchInput.value); }); }
    var logFoodBtn = document.getElementById('log-food-btn');
    if (logFoodBtn) logFoodBtn.addEventListener('click', logCurrentFood);
    var resultBack = document.getElementById('result-back-btn');
    if (resultBack) resultBack.addEventListener('click', function () { navigate('scan'); });
    var changeKeyBtn = document.getElementById('change-apikey-btn');
    if (changeKeyBtn) { changeKeyBtn.addEventListener('click', function () { showApiKeyScreen(function () { renderSettings(); showToast('API key saved'); }); }); }
    var cancelKeyBtn = document.getElementById('apikey-cancel-btn');
    if (cancelKeyBtn) { cancelKeyBtn.addEventListener('click', hideApiKeyScreen); }
    var editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) { editBtn.addEventListener('click', function () { document.getElementById('confirm-modal').classList.remove('hidden'); }); }
    document.getElementById('modal-cancel').addEventListener('click', function () { document.getElementById('confirm-modal').classList.add('hidden'); });
    document.getElementById('modal-confirm').addEventListener('click', function () {
      document.getElementById('confirm-modal').classList.add('hidden');
      state.logs = []; saveLogs(state.logs); state.profile = null; saveProfile(null); showOnboarding();
    });
    var homeScanBtn = document.getElementById('home-scan-btn');
    if (homeScanBtn) homeScanBtn.addEventListener('click', function () { navigate('scan'); });
  }

  document.addEventListener('DOMContentLoaded', function () { wireEvents(); init(); });
})();
