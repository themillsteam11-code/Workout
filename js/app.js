/* Tally — main application
 * Depends on: data.js, calc.js (loaded before this in HTML)
 */
(function () {
  'use strict';

  /* ============================================================
     Storage helpers
     ============================================================ */
  var STORAGE_KEY_PROFILE = 'tally_profile_v1';
  var STORAGE_KEY_LOGS    = 'tally_logs_v1';

  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PROFILE)) || null; }
    catch (_) { return null; }
  }

  function saveProfile(p) {
    localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(p));
  }

  function loadLogs() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOGS)) || []; }
    catch (_) { return []; }
  }

  function saveLogs(logs) {
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
  }

  /* ============================================================
     App state
     ============================================================ */
  var state = {
    profile: null,
    logs: [],
    budgets: null,
    weekState: null,
    currentResult: null   // last scan result for results view
  };

  function recompute() {
    if (!state.profile) return;
    state.budgets  = TallyCalc.deriveBudgets(state.profile);
    state.weekState = TallyCalc.computeWeekState(state.logs, state.budgets);
  }

  function init() {
    state.profile = loadProfile();
    state.logs    = loadLogs();
    recompute();

    if (!state.profile) {
      showOnboarding();
    } else {
      hideOnboarding();
      navigate('home');
    }
    renderTopbar();
  }

  /* ============================================================
     Navigation
     ============================================================ */
  var currentView = null;

  function navigate(viewId) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.dataset.view === viewId);
    });
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.nav === viewId);
    });
    currentView = viewId;

    if (viewId === 'home')     renderHome();
    if (viewId === 'scan')     renderScan();
    if (viewId === 'log')      renderLog();
    if (viewId === 'settings') renderSettings();
  }

  /* ============================================================
     Top bar
     ============================================================ */
  function renderTopbar() {
    if (!state.profile || !state.budgets) return;
    var el = document.getElementById('topbar-meta');
    if (!el) return;
    var remaining = state.weekState ? state.weekState.totalRemaining : state.budgets.weeklyBudget;
    el.innerHTML = '<span class="label">This week</span>' + fmtKcal(remaining) + ' left';
  }

  /* ============================================================
     Home view
     ============================================================ */
  function renderHome() {
    if (!state.profile || !state.budgets || !state.weekState) return;
    var ws = state.weekState;
    var pct = Math.min(ws.totalUsed / ws.weeklyBudget, 1);
    var isOver = ws.totalUsed > ws.weeklyBudget;

    // Ledger
    document.getElementById('ledger-remaining').textContent = fmtKcal(ws.totalRemaining);
    document.getElementById('ledger-used').textContent = fmtKcal(ws.totalUsed) + ' used';
    document.getElementById('ledger-budget').textContent = fmtKcal(ws.weeklyBudget) + ' budget';
    var fill = document.getElementById('ledger-gauge');
    fill.style.width = Math.round(pct * 100) + '%';
    fill.className = 'gauge-fill' + (isOver ? ' over' : pct < 0.5 ? ' good' : '');

    // Flexible budget
    var flexPct = Math.min(ws.flexibleUsed / ws.flexibleBudget, 1);
    document.getElementById('flex-used').textContent = fmtKcal(ws.flexibleUsed) + ' / ' + fmtKcal(ws.flexibleBudget);
    document.getElementById('flex-remaining').textContent = fmtKcal(Math.max(0, ws.flexibleRemaining));
    var fFill = document.getElementById('flex-gauge');
    fFill.style.width = Math.round(flexPct * 100) + '%';
    fFill.className = 'gauge-fill' + (flexPct >= 1 ? ' over' : '');

    // Recent scans
    renderRecentScans();

    // Habits
    renderHabits();

    renderTopbar();
  }

  function renderRecentScans() {
    var el = document.getElementById('recent-scans');
    if (!el) return;
    var logs = state.logs.slice().sort(function (a, b) { return b.timestamp - a.timestamp; }).slice(0, 5);
    if (logs.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="emoji-rule"></div><p class="title">Nothing logged yet</p><p>Scan your first item to get started.</p></div>';
      return;
    }
    el.innerHTML = '<ul class="receipt-list">' + logs.map(function (l) {
      return '<li class="receipt-item-row">' +
        '<div class="verdict-dot ' + (l.verdict || 'neutral') + '"></div>' +
        '<div class="receipt-row">' +
        '<span class="name">' + esc(l.name) + '</span>' +
        '<span class="leader"></span>' +
        '<span class="value text-' + (l.verdict || 'neutral') + '">' + fmtKcal(l.kcal) + '</span>' +
        '</div></li>';
    }).join('') + '</ul>';
  }

  function renderHabits() {
    var el = document.getElementById('habits-section');
    if (!el) return;
    var flags = TallyCalc.detectHabits(state.logs);
    if (flags.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="section-title" style="margin-top:var(--sp-5)">Pattern watch</p>' +
      flags.map(function (f) {
        return '<div class="card habit-card" style="margin-top:var(--sp-2)">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<span style="font-weight:700;font-size:14px">' + esc(f.name) + '</span>' +
          '<span class="habit-count">&times;' + f.count + ' this week</span>' +
          '</div>' +
          (f.swap ? '<div class="habit-swap">Swap idea: ' + esc(f.swap) + '</div>' : '') +
          '</div>';
      }).join('');
  }

  /* ============================================================
     Scan view
     ============================================================ */
  var scanState = {
    imageDataUrl: null,
    scanning: false
  };

  function renderScan() {
    var vf = document.getElementById('vf-image');
    if (vf) vf.src = '';
    var ph = document.getElementById('vf-placeholder');
    if (ph) ph.classList.remove('hidden');
    if (vf) vf.classList.add('hidden');
    hideScanStatus();
    document.getElementById('scan-search-input').value = '';
    document.getElementById('scan-search-results').innerHTML = '';
    if (!state.profile) return;
    var banner = document.getElementById('no-api-banner');
    if (banner) banner.classList.remove('hidden');
  }

  function hideScanStatus() {
    var s = document.getElementById('scan-status');
    if (s) s.classList.add('hidden');
  }

  function showScanStatus(msg) {
    var s = document.getElementById('scan-status');
    if (!s) return;
    s.querySelector('.scan-status-text').textContent = msg;
    s.classList.remove('hidden');
  }

  function handleImageCapture(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      scanState.imageDataUrl = e.target.result;
      var vf = document.getElementById('vf-image');
      var ph = document.getElementById('vf-placeholder');
      if (vf) { vf.src = e.target.result; vf.classList.remove('hidden'); }
      if (ph) ph.classList.add('hidden');
      triggerAIScan(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  function triggerAIScan(dataUrl) {
    if (scanState.scanning) return;
    scanState.scanning = true;
    showScanStatus('Analysing image…');

    var base64Data = dataUrl.split(',')[1];
    var mimeType   = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    var prompt = buildScanSystemPrompt();

    fetch('https://tally-gemini.ammiller1151.workers.dev/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: { mime_type: mimeType, data: base64Data }
            },
            {
              text: prompt + '\n\nIdentify the food or drink in this image. Return ONLY a JSON object, no markdown, no commentary.'
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 1000
        }
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      scanState.scanning = false;
      hideScanStatus();
      var raw = '';
      try {
        raw = data.candidates[0].content.parts[0].text || '';
      } catch (_) { raw = ''; }
      var clean = raw.replace(/```json|```/g, '').trim();
      try {
        var result = JSON.parse(clean);
        if (result && result.name) {
          handleScanResult(result);
        } else {
          showScanStatus('Could not identify food — try the search below');
          setTimeout(hideScanStatus, 3000);
        }
      } catch (_) {
        showScanStatus('Could not parse response — try the search below');
        setTimeout(hideScanStatus, 3000);
      }
    })
    .catch(function (err) {
      scanState.scanning = false;
      console.error('Scan error:', err);
      showScanStatus('Scan failed — use the search below');
      setTimeout(hideScanStatus, 3000);
    });
  }

  function buildScanSystemPrompt() {
    var p = state.profile;
    var goalLabel = p ? (TallyData.GOALS[p.goal] || {}).label || p.goal : 'general health';
    var dietLabel = p ? (TallyData.DIET_PHILOSOPHIES[p.diet] || {}).label || p.diet : 'balanced';
    return [
      'You are a food identification and nutrition AI embedded in the Tally PWA.',
      'The user\'s goal is: ' + goalLabel + '.',
      'Their diet philosophy is: ' + dietLabel + '.',
      '',
      'When given a food image, identify the item and return ONLY a valid JSON object with these fields (no markdown fences):',
      '  name       (string)  — concise human-readable name e.g. "Snickers Bar"',
      '  brand      (string)  — brand name or empty string',
      '  serving    (string)  — the serving size visible or typical e.g. "1 bar (50g)"',
      '  kcal       (number)  — calories per serving',
      '  protein    (number)  — grams protein',
      '  carbs      (number)  — grams carbohydrates',
      '  fat        (number)  — grams total fat',
      '  satFat     (number)  — grams saturated fat',
      '  sugar      (number)  — grams sugar',
      '  fiber      (number)  — grams fibre',
      '  sodium     (number)  — milligrams sodium',
      '  processed  (boolean) — is it ultra-processed?',
      '  category   (string)  — one of: snack, drink, fastfood, meal, protein, dairy, fruit, veg, grain, bakery, dessert, spread, dip',
      '  swap       (string)  — a single sentence suggesting a healthier alternative (empty string if the food is already healthy)',
      '',
      'Use nutrition label values if visible in the image. Otherwise use well-known typical values.',
      'Return ONLY the JSON object. No markdown fences, no preamble, no explanation.'
    ].join('\n');
  }

  function handleScanResult(food) {
    // Merge AI result with local evaluation
    var eval_ = TallyCalc.evaluateFood(food, state.profile);
    var copy   = TallyCalc.verdictCopy(eval_.verdict, state.profile);
    var burn   = TallyCalc.calcBurnOff(food.kcal, state.profile ? state.profile.weightKg : 70);
    var allow  = TallyCalc.calcWeeklyAllowance(food, eval_.verdict, state.weekState);

    state.currentResult = { food: food, eval: eval_, copy: copy, burn: burn, allow: allow };
    renderResults(state.currentResult);
    navigate('results');
  }

  function handleManualSearch(query) {
    query = (query || '').trim().toLowerCase();
    var el = document.getElementById('scan-search-results');
    if (!el) return;
    if (query.length < 2) { el.innerHTML = ''; return; }

    var hits = TallyData.FOOD_DB.filter(function (f) {
      return f.name.toLowerCase().includes(query) ||
             (f.brand && f.brand.toLowerCase().includes(query)) ||
             (f.category && f.category.toLowerCase().includes(query));
    }).slice(0, 6);

    if (hits.length === 0) {
      el.innerHTML = '<p class="faint" style="font-size:13px;padding:var(--sp-2) 0">No matches in local database.</p>';
      return;
    }

    el.innerHTML = hits.map(function (f) {
      return '<button class="search-result" data-food-id="' + f.id + '">' +
        '<div><div class="sr-name">' + esc(f.name) + '</div>' +
        (f.brand ? '<div class="sr-brand">' + esc(f.brand) + '</div>' : '') +
        '<div class="sr-brand">' + esc(f.serving) + '</div></div>' +
        '<div class="sr-kcal">' + f.kcal + '<span style="font-size:11px;font-weight:400"> kcal</span></div>' +
        '</button>';
    }).join('');

    el.querySelectorAll('.search-result').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var food = TallyData.FOOD_DB.find(function (f) { return f.id === btn.dataset.foodId; });
        if (food) handleScanResult(food);
      });
    });
  }

  /* ============================================================
     Results view
     ============================================================ */
  function renderResults(r) {
    if (!r) return;
    var food  = r.food;
    var eval_ = r.eval;
    var copy  = r.copy;
    var burn  = r.burn;
    var allow = r.allow;

    // Head
    document.getElementById('result-food-name').textContent = food.name;
    document.getElementById('result-food-meta').textContent =
      [food.brand, food.serving].filter(Boolean).join(' · ');

    // Stamp
    var stamp = document.getElementById('result-stamp');
    stamp.textContent = copy.stamp;
    stamp.className = 'stamp ' + eval_.verdict;
    document.getElementById('result-headline').textContent = copy.headline;
    document.getElementById('result-summary').textContent  = copy.summary;

    // Nutrition
    document.getElementById('result-kcal').textContent    = food.kcal || 0;
    document.getElementById('result-protein').textContent = round1(food.protein) || 0;
    document.getElementById('result-carbs').textContent   = round1(food.carbs) || 0;
    document.getElementById('result-fat').textContent     = round1(food.fat) || 0;
    document.getElementById('result-sugar').textContent   = round1(food.sugar) || 0;
    document.getElementById('result-fiber').textContent   = round1(food.fiber) || 0;

    // Effects
    var posEl = document.getElementById('result-positives');
    var negEl = document.getElementById('result-negatives');
    posEl.innerHTML = eval_.positives.length
      ? '<ul>' + eval_.positives.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
      : '<p class="effects-empty">No positive effects flagged.</p>';
    negEl.innerHTML = eval_.negatives.length
      ? '<ul>' + eval_.negatives.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
      : '<p class="effects-empty">No downsides flagged.</p>';

    // Weekly allowance ticket
    var ticketFig = document.getElementById('ticket-figure');
    var ticketLbl = document.getElementById('ticket-figure-label');
    var ticketMsg = document.getElementById('ticket-message');
    if (allow.type === 'free') {
      ticketFig.textContent = '∞';
      ticketLbl.textContent = 'no limit';
    } else if (allow.servings !== null) {
      ticketFig.textContent = allow.servings;
      ticketLbl.textContent = allow.servings === 1 ? 'serving left this week' : 'servings left this week';
    } else {
      ticketFig.textContent = '0';
      ticketLbl.textContent = 'servings left this week';
    }
    ticketMsg.textContent = allow.message;

    // Burn-off
    var burnEl = document.getElementById('result-burn');
    if (!burn || burn.length === 0) {
      burnEl.innerHTML = '<p class="faint" style="font-size:13px">Zero calories — nothing to burn!</p>';
    } else {
      var icons = { walk: walkIcon(), cycle: cycleIcon(), jog: jogIcon(), swim: swimIcon(), hiit: hiitIcon() };
      burnEl.innerHTML = '<div class="burn-list">' + burn.map(function (b) {
        return '<div class="burn-row">' +
          '<div class="burn-icon">' + (icons[b.id] || walkIcon()) + '</div>' +
          '<div class="burn-name">' + esc(b.label) + '</div>' +
          '<div class="burn-time">' + b.minutes + '<span class="unit"> min</span></div>' +
          '</div>';
      }).join('') + '</div>';
    }

    // Swap
    var swapEl = document.getElementById('result-swap');
    if (food.swap) {
      swapEl.innerHTML = '<div class="card" style="background:var(--wheat-bg);border-color:var(--wheat);margin-top:var(--sp-3)">' +
        '<p class="eyebrow" style="color:var(--wheat);margin-bottom:var(--sp-2)">Swap idea</p>' +
        '<p style="font-size:13px">' + esc(food.swap) + '</p></div>';
    } else {
      swapEl.innerHTML = '';
    }
  }

  /* ============================================================
     Log food from results
     ============================================================ */
  function logCurrentFood() {
    if (!state.currentResult) return;
    var food = state.currentResult.food;
    var eval_ = state.currentResult.eval;
    var entry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2,7),
      timestamp: Date.now(),
      foodId: food.id || null,
      name: food.name,
      brand: food.brand || '',
      serving: food.serving || '',
      kcal: food.kcal || 0,
      verdict: eval_.verdict,
      swap: food.swap || ''
    };
    state.logs.unshift(entry);
    saveLogs(state.logs);
    recompute();
    showToast('Logged ' + food.name);
    navigate('home');
  }

  /* ============================================================
     Log view
     ============================================================ */
  function renderLog() {
    recompute();
    var el = document.getElementById('log-content');
    if (!el) return;
    if (state.logs.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="emoji-rule"></div><p class="title">Nothing logged yet</p><p>Scan a food item to begin tracking your week.</p></div>';
      return;
    }

    // Render week bar chart
    var days = getWeekDays();
    var dailyBudget = state.budgets ? state.budgets.dailyTarget : 2000;
    var maxBarVal = Math.max(dailyBudget * 1.1, 100);
    var barsHtml = '<div class="week-bars">' + days.map(function (d) {
      var total = d.logs.reduce(function (s, l) { return s + l.kcal; }, 0);
      var pct = Math.min(total / maxBarVal, 1);
      var isOver = total > dailyBudget;
      var cls = d.isToday ? 'today' : isOver ? 'over' : '';
      return '<div class="week-bar' + (d.isToday ? ' is-today' : '') + '">' +
        '<div class="bar-track"><div class="bar-fill ' + cls + '" style="height:' + Math.round(pct * 100) + '%"></div></div>' +
        '<div class="bar-label">' + d.short + '</div>' +
        '</div>';
    }).join('') + '</div>';

    // Group by day
    var grouped = groupByDay(state.logs);
    var daysHtml = grouped.map(function (group) {
      var total = group.logs.reduce(function (s, l) { return s + l.kcal; }, 0);
      return '<div class="day-group">' +
        '<div class="day-title"><span>' + group.label + '</span><span class="day-total">' + fmtKcal(total) + '</span></div>' +
        group.logs.map(function (l) {
          return '<div class="log-row">' +
            '<div class="verdict-dot ' + (l.verdict || 'neutral') + '" style="flex-shrink:0;margin-bottom:0"></div>' +
            '<div class="log-main"><div class="log-name">' + esc(l.name) + '</div>' +
            '<div class="log-meta">' + esc(l.serving || '') + (l.brand ? ' · ' + esc(l.brand) : '') + '</div></div>' +
            '<div class="log-kcal">' + l.kcal + '</div>' +
            '<button class="log-delete" data-log-id="' + l.id + '" aria-label="Delete">' + trashIcon() + '</button>' +
            '</div>';
        }).join('') + '</div>';
    }).join('');

    el.innerHTML = barsHtml + daysHtml;

    el.querySelectorAll('.log-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        deleteLog(btn.dataset.logId);
      });
    });
  }

  function deleteLog(id) {
    state.logs = state.logs.filter(function (l) { return l.id !== id; });
    saveLogs(state.logs);
    recompute();
    renderLog();
    renderTopbar();
  }

  function getWeekDays() {
    var now = new Date();
    var weekStart = TallyCalc.getWeekStart(now);
    var labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    return labels.map(function (short, i) {
      var d = new Date(weekStart.getTime() + i * 86400000);
      var dayStart = d.getTime();
      var dayEnd   = dayStart + 86400000;
      var logs = state.logs.filter(function (l) { return l.timestamp >= dayStart && l.timestamp < dayEnd; });
      var isToday = d.toDateString() === now.toDateString();
      return { short: short, date: d, logs: logs, isToday: isToday };
    });
  }

  function groupByDay(logs) {
    var map = {};
    var order = [];
    logs.forEach(function (l) {
      var d = new Date(l.timestamp);
      var key = d.toDateString();
      if (!map[key]) { map[key] = { label: formatDay(d), ts: l.timestamp, logs: [] }; order.push(key); }
      map[key].logs.push(l);
    });
    // Most recent day first, deduplicate order
    var seen = {};
    var unique = order.filter(function (k) { if (seen[k]) return false; seen[k] = true; return true; });
    unique.sort(function (a, b) { return map[b].ts - map[a].ts; });
    return unique.map(function (k) { return map[k]; });
  }

  function formatDay(date) {
    var now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  /* ============================================================
     Settings view
     ============================================================ */
  function renderSettings() {
    if (!state.profile || !state.budgets) return;
    var p = state.profile;
    var b = state.budgets;

    document.getElementById('settings-name').textContent = p.name || 'Your profile';
    document.getElementById('stat-daily').textContent = fmtKcal(b.dailyTarget);
    document.getElementById('stat-weekly').textContent = fmtKcal(b.weeklyBudget);
    document.getElementById('stat-flex').textContent = fmtKcal(b.flexibleBudget);
    document.getElementById('stat-bmr').textContent = fmtKcal(b.bmr);

    var goalObj = TallyData.GOALS[p.goal] || {};
    var dietObj = TallyData.DIET_PHILOSOPHIES[p.diet] || {};
    var actObj  = TallyData.ACTIVITY_LEVELS[p.activity] || {};
    document.getElementById('settings-goal-label').textContent  = goalObj.label || p.goal;
    document.getElementById('settings-diet-label').textContent  = dietObj.label || p.diet;
    document.getElementById('settings-act-label').textContent   = actObj.label || p.activity;
    document.getElementById('settings-pace-label').textContent  = (((goalObj.paces || {})[p.pace]) || {}).desc || p.pace;
  }

  /* ============================================================
     Onboarding (5-step wizard)
     ============================================================ */
  var ob = {
    step: 0,
    data: {
      name: '', sex: 'other',
      weightKg: null, heightCm: null,
      age: null,
      units: 'metric',  // 'metric' | 'imperial'
      activity: 'moderate',
      goal: 'lose', pace: 'standard',
      diet: 'balanced'
    }
  };

  var OB_STEPS = ['basics', 'body', 'activity', 'goal', 'diet'];

  function showOnboarding() {
    document.getElementById('onboarding').classList.remove('hidden');
    ob.step = 0;
    renderObStep();
  }

  function hideOnboarding() {
    document.getElementById('onboarding').classList.add('hidden');
  }

  function renderObStep() {
    var stepId = OB_STEPS[ob.step];
    OB_STEPS.forEach(function (s) {
      var el = document.getElementById('ob-' + s);
      if (el) el.classList.toggle('hidden', s !== stepId);
    });
    // Step dots
    var dots = document.querySelectorAll('.step-dots span');
    dots.forEach(function (d, i) {
      d.className = i < ob.step ? 'done' : i === ob.step ? 'current' : '';
    });
    // Back button
    var backBtn = document.getElementById('ob-back');
    if (backBtn) backBtn.classList.toggle('hidden', ob.step === 0);
    // Next button label
    var nextBtn = document.getElementById('ob-next');
    if (nextBtn) nextBtn.textContent = ob.step === OB_STEPS.length - 1 ? 'Get started' : 'Continue';

    clearObError();
  }

  function obNext() {
    if (!validateObStep()) return;
    if (ob.step === OB_STEPS.length - 1) {
      finishOnboarding();
      return;
    }
    ob.step++;
    renderObStep();
  }

  function obBack() {
    if (ob.step > 0) { ob.step--; renderObStep(); }
  }

  function validateObStep() {
    var stepId = OB_STEPS[ob.step];
    clearObError();

    if (stepId === 'basics') {
      var name = document.getElementById('ob-name').value.trim();
      var age  = parseInt(document.getElementById('ob-age').value, 10);
      if (!name) { showObError('Please enter your name.'); return false; }
      if (!age || age < 10 || age > 120) { showObError('Please enter a valid age (10–120).'); return false; }
      ob.data.name = name;
      ob.data.age  = age;
      var sexPill = document.querySelector('#ob-basics .pill.checked input');
      if (sexPill) ob.data.sex = sexPill.value;
    }

    if (stepId === 'body') {
      var units = ob.data.units;
      if (units === 'metric') {
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

    if (stepId === 'activity') {
      var actPill = document.querySelector('#ob-activity .pill.checked input');
      if (!actPill) { showObError('Please select your activity level.'); return false; }
      ob.data.activity = actPill.value;
    }

    if (stepId === 'goal') {
      var goalPill = document.querySelector('#ob-goal .pill.checked input');
      if (!goalPill) { showObError('Please select a goal.'); return false; }
      ob.data.goal = goalPill.value;
      var goalObj = TallyData.GOALS[ob.data.goal];
      var pacePill = document.querySelector('#ob-goal .pace-group .pill.checked input');
      ob.data.pace = pacePill ? pacePill.value : (goalObj ? goalObj.defaultPace : 'standard');
    }

    if (stepId === 'diet') {
      var dietPill = document.querySelector('#ob-diet .pill.checked input');
      if (!dietPill) { showObError('Please choose a diet style.'); return false; }
      ob.data.diet = dietPill.value;
    }

    return true;
  }

  function finishOnboarding() {
    state.profile = {
      name:      ob.data.name,
      sex:       ob.data.sex,
      age:       ob.data.age,
      weightKg:  ob.data.weightKg,
      heightCm:  ob.data.heightCm,
      activity:  ob.data.activity,
      goal:      ob.data.goal,
      pace:      ob.data.pace,
      diet:      ob.data.diet,
      units:     ob.data.units
    };
    saveProfile(state.profile);
    recompute();
    hideOnboarding();
    navigate('home');
    renderTopbar();
  }

  function showObError(msg) {
    var el = document.getElementById('ob-error');
    if (el) { el.textContent = msg; el.classList.remove('hidden'); }
  }

  function clearObError() {
    var el = document.getElementById('ob-error');
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  }

  /* unit toggle in body step */
  function setObUnits(units) {
    ob.data.units = units;
    document.querySelectorAll('.unit-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.units === units);
    });
    document.getElementById('metric-fields').classList.toggle('hidden', units !== 'metric');
    document.getElementById('imperial-fields').classList.toggle('hidden', units !== 'imperial');
  }

  /* goal pace sub-section: show only for lose/gain */
  function updatePacePills() {
    var goalVal = (document.querySelector('#ob-goal .goal-group .pill.checked input') || {}).value;
    var paceSection = document.getElementById('ob-pace-section');
    if (!paceSection) return;
    if (!goalVal || goalVal === 'maintain') {
      paceSection.classList.add('hidden');
      return;
    }
    paceSection.classList.remove('hidden');
    var paceGroup = paceSection.querySelector('.pace-group');
    var goalObj = TallyData.GOALS[goalVal] || {};
    var paces = goalObj.paces || {};
    paceGroup.innerHTML = Object.keys(paces).map(function (pk) {
      var pace = paces[pk];
      var isDefault = pk === goalObj.defaultPace;
      return '<label class="pill' + (isDefault ? ' checked' : '') + '">' +
        '<input type="radio" name="ob_pace" value="' + pk + '"' + (isDefault ? ' checked' : '') + '>' +
        '<div class="pill-mark"></div>' +
        '<div class="pill-body"><div class="pill-title">' + pace.label + '</div><div class="pill-desc">' + pace.desc + '</div></div>' +
        '</label>';
    }).join('');
    bindPillRadios(paceGroup);
  }

  /* ============================================================
     Pill radio binding (reusable)
     ============================================================ */
  function bindPillRadios(container) {
    (container || document).querySelectorAll('.pill input[type="radio"]').forEach(function (input) {
      input.addEventListener('change', function () {
        var name = input.getAttribute('name');
        document.querySelectorAll('.pill input[name="' + name + '"]').forEach(function (other) {
          other.closest('.pill').classList.toggle('checked', other === input);
        });
        if (name === 'ob_goal') updatePacePills();
      });
    });
  }

  /* ============================================================
     Toast
     ============================================================ */
  var _toastTimer = null;
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ============================================================
     Helpers
     ============================================================ */
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function fmtKcal(n) {
    n = Math.round(n || 0);
    return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString() + ' kcal';
  }

  function round1(n) { return Math.round((n || 0) * 10) / 10; }

  /* ============================================================
     SVG icons (inline — no external deps)
     ============================================================ */
  function walkIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4" r="1.5"/><path d="M9 12l2-4 2.5 2L16 8"/><path d="M9 12l-1 5h4l1-3 2 3h2"/><path d="M8 17l-1 4"/></svg>'; }
  function cycleIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h12M9 7h5l2 5H7l2-5z"/><circle cx="13" cy="5" r="1"/></svg>'; }
  function jogIcon()   { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="1.5"/><path d="M7 21l3-6 2 3 3-9 2 4h2"/><path d="M6 12l2-3 4 1"/></svg>'; }
  function swimIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 12l3-3 3 2 3-4 3 2"/><circle cx="18" cy="6" r="1.5"/></svg>'; }
  function hiitIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'; }
  function trashIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>'; }
  function homeIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'; }
  function scanIcon()  { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>'; }
  function logIcon()   { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>'; }
  function settingsIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'; }

  /* ============================================================
     DOM event wiring (called once after DOMContentLoaded)
     ============================================================ */
  function wireEvents() {
    // Nav buttons
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.dataset.nav;
        if (v && state.profile) navigate(v);
        else if (v === 'scan' && !state.profile) showToast('Complete setup first');
      });
    });

    // Onboarding
    document.getElementById('ob-next').addEventListener('click', obNext);
    document.getElementById('ob-back').addEventListener('click', obBack);

    // Unit toggle
    document.querySelectorAll('.unit-toggle button').forEach(function (b) {
      b.addEventListener('click', function () { setObUnits(b.dataset.units); });
    });

    // Pill radios (all of them)
    bindPillRadios(document);

    // Camera input
    var camInput = document.getElementById('camera-input');
    if (camInput) {
      camInput.addEventListener('change', function () {
        if (camInput.files && camInput.files[0]) handleImageCapture(camInput.files[0]);
      });
    }

    // Scan CTA button
    var scanBtn = document.getElementById('take-photo-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', function () {
        document.getElementById('camera-input').click();
      });
    }

    // Manual search
    var searchInput = document.getElementById('scan-search-input');
    if (searchInput) {
      var searchTimer;
      searchInput.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { handleManualSearch(searchInput.value); }, 280);
      });
    }

    // Results: log button
    var logFoodBtn = document.getElementById('log-food-btn');
    if (logFoodBtn) logFoodBtn.addEventListener('click', logCurrentFood);

    // Results: back button
    var resultBack = document.getElementById('result-back-btn');
    if (resultBack) resultBack.addEventListener('click', function () { navigate('scan'); });

    // Settings: edit profile
    var editBtn = document.getElementById('edit-profile-btn');
    if (editBtn) editBtn.addEventListener('click', function () {
      document.getElementById('confirm-modal').classList.remove('hidden');
    });

    // Confirm modal
    document.getElementById('modal-cancel').addEventListener('click', function () {
      document.getElementById('confirm-modal').classList.add('hidden');
    });
    document.getElementById('modal-confirm').addEventListener('click', function () {
      document.getElementById('confirm-modal').classList.add('hidden');
      state.logs = [];
      saveLogs(state.logs);
      state.profile = null;
      saveProfile(null);
      showOnboarding();
    });

    // Home scan CTA
    var homeScanBtn = document.getElementById('home-scan-btn');
    if (homeScanBtn) homeScanBtn.addEventListener('click', function () { navigate('scan'); });
  }

  /* ============================================================
     Boot
     ============================================================ */
  document.addEventListener('DOMContentLoaded', function () {
    wireEvents();
    init();
  });

})();
