/* Tally — main app
 * AI scan: OpenRouter (free vision models, fallback chain)
 * Food DB: Open Food Facts (4M+ products)
 */
(function () {
  'use strict';

  var SK_PROFILE = 'tally_profile_v1';
  var SK_LOGS    = 'tally_logs_v1';
  var SK_APIKEY  = 'tally_openrouter_key_v1';

  function loadProfile() { try { return JSON.parse(localStorage.getItem(SK_PROFILE)) || null; } catch (_) { return null; } }
  function saveProfile(p) { localStorage.setItem(SK_PROFILE, JSON.stringify(p)); }
  function loadLogs()    { try { return JSON.parse(localStorage.getItem(SK_LOGS)) || []; } catch (_) { return []; } }
  function saveLogs(l)   { localStorage.setItem(SK_LOGS, JSON.stringify(l)); }
  function loadApiKey()  { try { return localStorage.getItem(SK_APIKEY) || ''; } catch (_) { return ''; } }
  function saveApiKey(k) { localStorage.setItem(SK_APIKEY, k.trim()); }

  var S = { profile: null, logs: [], budgets: null, weekState: null, result: null, apiKey: '' };

  function recompute() {
    if (!S.profile) return;
    S.budgets   = TallyCalc.deriveBudgets(S.profile);
    S.weekState = TallyCalc.computeWeekState(S.logs, S.budgets);
  }

  function init() {
    S.profile = loadProfile();
    S.logs    = loadLogs();
    S.apiKey  = loadApiKey();
    recompute();
    if (!S.profile) { showOnboarding(); } else { hideOnboarding(); navigate('home'); }
    renderTopbar();
  }

  /* ── NAVIGATION ─────────────────────────────────────────── */
  function navigate(id) {
    document.querySelectorAll('.view').forEach(function(v){ v.classList.toggle('active', v.dataset.view === id); });
    document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.nav === id); });
    if (id === 'home')     renderHome();
    if (id === 'scan')     renderScan();
    if (id === 'log')      renderLog();
    if (id === 'settings') renderSettings();
    // Scroll to top on view change
    var main = document.querySelector('.app-main');
    if (main) main.scrollTop = 0;
  }

  /* ── TOPBAR ──────────────────────────────────────────────── */
  function renderTopbar() {
    var el = document.getElementById('topbar-meta');
    if (!el || !S.budgets) return;
    var rem = S.weekState ? S.weekState.totalRemaining : S.budgets.weeklyBudget;
    var sign = rem < 0 ? '-' : '';
    el.innerHTML = '<span class="week-label">This week</span>' + sign + Math.abs(Math.round(rem)).toLocaleString() + ' kcal left';
  }

  /* ── HOME ────────────────────────────────────────────────── */
  function renderHome() {
    if (!S.budgets || !S.weekState) return;
    var ws = S.weekState;
    var pct = Math.min(ws.totalUsed / (ws.weeklyBudget || 1), 1);
    var isOver = ws.totalUsed > ws.weeklyBudget;

    setText('ledger-remaining', fmt(ws.totalRemaining));
    setText('ledger-used', fmt(ws.totalUsed) + ' used');
    setText('ledger-budget', fmt(ws.weeklyBudget) + ' budget');

    var g = document.getElementById('ledger-gauge');
    g.style.width = Math.round(pct * 100) + '%';
    g.className = 'balance-fill' + (isOver ? ' over' : pct > 0.8 ? ' warn' : '');

    var flexPct = Math.min(ws.flexibleUsed / (ws.flexibleBudget || 1), 1);
    setText('flex-remaining', fmt(Math.max(0, ws.flexibleRemaining)));
    setText('flex-used', fmt(ws.flexibleUsed) + ' / ' + fmt(ws.flexibleBudget) + ' used');
    var fg = document.getElementById('flex-gauge');
    fg.style.width = Math.round(flexPct * 100) + '%';
    fg.className = 'balance-flex-fill' + (flexPct >= 1 ? ' over' : '');

    renderRecentScans();
    renderHabits();
    renderTopbar();
  }

  function renderRecentScans() {
    var el = document.getElementById('recent-scans');
    if (!el) return;
    var logs = S.logs.slice().sort(function(a,b){ return b.timestamp - a.timestamp; }).slice(0, 7);
    if (!logs.length) {
      el.innerHTML = '<div class="empty-state"><div class="e-icon"><svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg></div><div class="e-title">Nothing logged yet</div><div class="e-sub">Scan your first food item to start tracking.</div></div>';
      return;
    }
    el.innerHTML = logs.map(function(l) {
      var v = l.verdict || 'neutral';
      return '<div class="log-item"><div class="log-dot ' + v + '"></div><div class="log-item-name">' + esc(l.name) + '</div><div class="log-item-kcal ' + v + '">' + Math.round(l.kcal) + '</div></div>';
    }).join('');
  }

  function renderHabits() {
    var el = document.getElementById('habits-section');
    if (!el) return;
    var flags = TallyCalc.detectHabits(S.logs);
    if (!flags.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div style="padding:var(--s4) var(--s4) 0"><div class="section-header" style="padding:0;margin-bottom:var(--s3)">Pattern watch</div></div>' +
      flags.map(function(f) {
        return '<div class="habit-chip"><div class="habit-chip-row"><span class="habit-chip-name">' + esc(f.name) + '</span><span class="habit-chip-count">×' + f.count + ' this week</span></div>' +
          (f.swap ? '<div class="habit-chip-swap">💡 ' + esc(f.swap) + '</div>' : '') + '</div>';
      }).join('');
  }

  /* ── API KEY SCREEN ──────────────────────────────────────── */
  function showApiKeyScreen(onSuccess) {
    var el   = document.getElementById('apikey-screen');
    var inp  = document.getElementById('apikey-input');
    var err  = document.getElementById('apikey-error');
    var btn  = document.getElementById('apikey-save-btn');
    if (!el) return;
    el.className = 'apikey-screen visible';
    err.style.display = 'none';
    inp.value = S.apiKey || '';

    function trySave() {
      var key = inp.value.trim();
      if (!key || key.length < 20) {
        err.textContent = 'Doesn\'t look right — OpenRouter keys start with "sk-or-" and are longer than 20 characters.';
        err.style.display = 'block'; return;
      }
      saveApiKey(key); S.apiKey = key;
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

  /* ── SCAN VIEW ───────────────────────────────────────────── */
  var scanState = { dataUrl: null, scanning: false };
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
    var s = document.getElementById('scan-status');
    if (!s) return;
    var t = s.querySelector('.scan-status-text');
    if (t) t.textContent = msg;
    s.classList.remove('hidden');
  }

  function handleImageCapture(file) {
    if (!file) return;
    var img = new Image(), obj = URL.createObjectURL(file);
    img.onload = function() {
      URL.revokeObjectURL(obj);
      var MAX = 1024, w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      scanState.dataUrl = dataUrl;
      var vf = document.getElementById('vf-image'), ph = document.getElementById('vf-placeholder');
      if (vf) { vf.src = dataUrl; vf.classList.remove('hidden'); }
      if (ph) ph.classList.add('hidden');
      if (!S.apiKey) { showApiKeyScreen(function() { triggerAIScan(dataUrl, 0); }); }
      else { triggerAIScan(dataUrl, 0); }
    };
    img.onerror = function() { URL.revokeObjectURL(obj); showScanStatus('Could not load image — try again'); setTimeout(hideScanStatus, 3000); };
    img.src = obj;
  }

  var FREE_MODELS = ['nvidia/nemotron-nano-12b-v2-vl:free', 'moonshotai/kimi-vl-a3b-thinking:free'];

  function triggerAIScan(dataUrl, idx) {
    idx = idx || 0;
    if (idx >= FREE_MODELS.length) {
      scanState.scanning = false;
      showScanStatus('No free AI models available — use search below.');
      setTimeout(hideScanStatus, 6000); return;
    }
    if (scanState.scanning && idx === 0) return;
    scanState.scanning = true;
    showScanStatus('Identifying food… (' + (idx + 1) + '/' + FREE_MODELS.length + ')');

    var base64 = dataUrl.split(',')[1];
    var mime   = dataUrl.split(';')[0].split(':')[1] || 'image/jpeg';

    fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey, 'HTTP-Referer': window.location.origin, 'X-Title': 'Tally Food Scanner' },
      body: JSON.stringify({
        model: FREE_MODELS[idx], max_tokens: 600, temperature: 0.1,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } },
          { type: 'text', text: buildPrompt() }
        ]}]
      })
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(b) { throw new Error('CODE:' + r.status + ' ' + ((b.error && b.error.message) || '')); });
      return r.json();
    })
    .then(function(data) {
      scanState.scanning = false; hideScanStatus();
      var raw = '';
      try { raw = data.choices[0].message.content || ''; } catch(_) {}
      var clean = raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      var m = clean.match(/\{[\s\S]*\}/); if (m) clean = m[0];
      try {
        var r = JSON.parse(clean);
        if (r && r.name) { handleScanResult(r); }
        else { showScanStatus('Couldn\'t identify food — use search below'); setTimeout(hideScanStatus, 3000); }
      } catch(_) { showScanStatus('Couldn\'t parse result — use search below'); setTimeout(hideScanStatus, 3000); }
    })
    .catch(function(err) {
      var msg = String(err.message || err).toLowerCase();
      if (msg.includes('404') || msg.includes('not found') || msg.includes('unavailable') || msg.includes('paid') || msg.includes('not available for free')) {
        scanState.scanning = false; triggerAIScan(dataUrl, idx + 1); return;
      }
      scanState.scanning = false;
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many')) {
        showScanStatus('Rate limited — wait a moment then try again.'); setTimeout(hideScanStatus, 6000);
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('invalid api key')) {
        hideScanStatus(); showApiKeyScreen(function() { triggerAIScan(scanState.dataUrl, 0); });
      } else if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
        showScanStatus('No internet — use search below.'); setTimeout(hideScanStatus, 5000);
      } else {
        showScanStatus('Error: ' + String(err.message||err).slice(0,80)); setTimeout(hideScanStatus, 7000);
      }
    });
  }

  function buildPrompt() {
    var goal = S.profile ? (TallyData.GOALS[S.profile.goal]||{}).label || S.profile.goal : 'general health';
    return 'You are a nutrition expert. Identify the food in this image. User goal: ' + goal + '.\nReturn ONLY a JSON object, no markdown:\n{"name":"","brand":"","serving":"","kcal":0,"protein":0,"carbs":0,"fat":0,"satFat":0,"sugar":0,"fiber":0,"sodium":0,"processed":false,"category":"","swap":""}\ncategory: snack drink fastfood meal protein dairy fruit veg grain bakery dessert spread dip\nswap: one sentence healthier alternative, or empty if already healthy.\nUse label values if visible, else well-known standard values. Return ONLY the JSON.';
  }

  /* ── OPEN FOOD FACTS ─────────────────────────────────────── */
  function handleManualSearch(query) {
    query = (query||'').trim();
    var el = document.getElementById('scan-search-results');
    if (!el) return;
    clearTimeout(_offTimer);
    if (_offCtrl) { try { _offCtrl.abort(); } catch(_) {} }
    if (query.length < 2) { el.innerHTML = ''; return; }
    showLocalHits(query, el);
    _offTimer = setTimeout(function() { searchOFF(query, el); }, 400);
  }

  function showLocalHits(query, el) {
    var q = query.toLowerCase();
    var hits = TallyData.FOOD_DB.filter(function(f) {
      return f.name.toLowerCase().includes(q) || (f.brand&&f.brand.toLowerCase().includes(q));
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
    fetch('https://world.openfoodfacts.org/cgi/search.pl?search_terms=' + encodeURIComponent(query) + '&search_simple=1&action=process&json=1&page_size=9&fields=product_name,brands,serving_size,nutriments,nova_group,categories_tags', sig ? {signal:sig} : {})
      .then(function(r){ return r.json(); })
      .then(function(data) {
        var products = (data.products||[]).filter(function(p){ return p.product_name && ((p.nutriments||{})['energy-kcal_serving']||(p.nutriments||{})['energy-kcal']||0)>0; });
        var offEl = el.querySelector('#off-results') || el;
        if (!products.length) { offEl.innerHTML = '<p style="font-size:13px;color:var(--label-3);padding:var(--s3) 0">No results from Open Food Facts.</p>'; return; }
        var foods = products.slice(0,7).map(offToFood);
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
    var n = p.nutriments||{};
    function g(k){ return parseFloat(n[k+'_serving']||n[k]||0)||0; }
    var kcal = parseFloat(n['energy-kcal_serving']||n['energy-kcal']||0)||0;
    var sod  = g('sodium'); var salt = g('salt');
    var sodMg = sod>0 ? sod*1000 : salt>0 ? salt*390 : 0;
    var cats = (p.categories_tags||[]).join(' ').toLowerCase();
    var cat = 'meal';
    if (/snack|chip|biscuit|candy|chocolate|crisp/.test(cats)) cat='snack';
    else if (/beverage|drink|juice|soda|cola|water|tea|coffee/.test(cats)) cat='drink';
    else if (/dairy|milk|yogurt|cheese|cream/.test(cats)) cat='dairy';
    else if (/fruit/.test(cats)) cat='fruit';
    else if (/vegetable|veggie/.test(cats)) cat='veg';
    else if (/bread|cereal|grain|pasta|rice|oat/.test(cats)) cat='grain';
    else if (/meat|fish|seafood|protein|egg|poultry/.test(cats)) cat='protein';
    else if (/dessert|ice.cream|cake|sweet/.test(cats)) cat='dessert';
    else if (/fast.food|burger|pizza|sandwich/.test(cats)) cat='fastfood';
    else if (/bakery|pastry|croissant|muffin/.test(cats)) cat='bakery';
    return { id:null, name:(p.product_name||'Unknown').slice(0,60), brand:(p.brands||'').split(',')[0].trim().slice(0,30), serving:p.serving_size||'1 serving', kcal:kcal, protein:g('proteins'), carbs:g('carbohydrates'), fat:g('fat'), satFat:g('saturated-fat'), sugar:g('sugars'), fiber:g('fiber')||g('fibers'), sodium:sodMg, processed:p.nova_group==4, category:cat, swap:'' };
  }

  function renderFoodCards(foods) {
    return foods.map(function(f) {
      var safe = JSON.stringify(f).replace(/\\/g,'\\\\').replace(/'/g,'&#39;').replace(/"/g,'&quot;');
      return '<button class="sr-item" data-food=\'' + safe + '\'><div class="sr-item-info"><div class="sr-item-name">' + esc(f.name) + '</div><div class="sr-item-meta">' + esc(f.brand||'') + (f.serving?' · '+esc(f.serving):'') + '</div></div><div class="sr-item-kcal">' + Math.round(f.kcal||0) + ' kcal</div></button>';
    }).join('');
  }

  function bindCards(container) {
    container.querySelectorAll('.sr-item').forEach(function(btn) {
      if (btn._b) return; btn._b = true;
      btn.addEventListener('click', function() {
        try { var food = JSON.parse(btn.getAttribute('data-food').replace(/&quot;/g,'"')); if(food) handleScanResult(food); }
        catch(e) { console.error(e); }
      });
    });
  }

  /* ── COMPOUND ANALYSIS ────────────────────────────────────── */
  function getCompounds(food) {
    var compounds = [];
    var n = food;

    if (n.sugar > 0) {
      var sugarGrade = n.sugar >= 25 ? 'bad' : n.sugar >= 12 ? 'neutral' : 'good';
      var sugarEffect = n.sugar >= 25
        ? 'High added sugar spikes blood glucose, promotes insulin resistance, and contributes to fat storage. Linked to increased risk of type 2 diabetes and cardiovascular disease with frequent consumption.'
        : n.sugar >= 12
        ? 'Moderate sugar load. Causes a blood glucose rise — pairing with fibre or protein helps slow absorption and blunt the insulin response.'
        : 'Low sugar content. Minimal impact on blood glucose. Supports stable energy and reduces the insulin burden on your pancreas.';
      compounds.push({ name: 'Sugar', amount: r1(n.sugar) + 'g', grade: sugarGrade, effect: sugarEffect });
    }

    if (n.satFat > 0) {
      var sfGrade = n.satFat >= 8 ? 'bad' : n.satFat >= 4 ? 'neutral' : 'good';
      var sfEffect = n.satFat >= 8
        ? 'Saturated fat at this level raises LDL ("bad") cholesterol, which deposits on artery walls. Frequent intake above ~20g/day is associated with increased cardiovascular disease risk.'
        : n.satFat >= 4
        ? 'Moderate saturated fat. Current research is nuanced — short-chain saturated fats (from dairy) behave differently than long-chain (from red meat). Context and overall diet pattern matter more than single items.'
        : 'Low saturated fat. The type of fat here poses minimal cardiovascular concern at this amount.';
      compounds.push({ name: 'Saturated fat', amount: r1(n.satFat) + 'g', grade: sfGrade, effect: sfEffect });
    }

    if (n.sodium > 0) {
      var sodGrade = n.sodium >= 800 ? 'bad' : n.sodium >= 400 ? 'neutral' : 'good';
      var sodEffect = n.sodium >= 800
        ? 'Very high sodium. A single serving delivers over a third of the daily recommended 2300mg limit. Excess sodium causes water retention, raises blood pressure, and stresses the kidneys over time.'
        : n.sodium >= 400
        ? 'Moderate sodium. Worth accounting for — if the rest of your day is low-sodium you have headroom, but multiple high-sodium meals compound quickly.'
        : 'Low sodium content. No meaningful concern for blood pressure or fluid balance at this level.';
      compounds.push({ name: 'Sodium', amount: Math.round(n.sodium) + 'mg', grade: sodGrade, effect: sodEffect });
    }

    if (n.fiber > 0) {
      var fibGrade = n.fiber >= 5 ? 'good' : n.fiber >= 2 ? 'neutral' : 'bad';
      var fibEffect = n.fiber >= 5
        ? 'Excellent fibre content. Feeds beneficial gut bacteria, slows glucose absorption, reduces LDL cholesterol, and keeps you full longer. Consistently high fibre intake is one of the strongest predictors of long-term health.'
        : n.fiber >= 2
        ? 'Some fibre present. A contribution toward the 25–30g daily target, but not a primary source. Look for opportunities to pair with higher-fibre foods.'
        : 'Minimal fibre. No significant prebiotic or satiety benefit. The lack of fibre means faster digestion and a quicker return of hunger.';
      compounds.push({ name: 'Dietary fibre', amount: r1(n.fiber) + 'g', grade: fibGrade, effect: fibEffect });
    }

    if (n.protein > 0) {
      var goal = S.profile ? S.profile.goal : 'maintain';
      var proGrade = n.protein >= 20 ? 'good' : n.protein >= 8 ? 'neutral' : 'bad';
      var proEffect = n.protein >= 20
        ? 'High-quality protein hit. Essential for muscle protein synthesis, immune function, and enzyme production. ' + (goal === 'gain' ? 'Critical for muscle growth — hits a meaningful fraction of the ~1.6–2.2g/kg daily target for muscle building.' : goal === 'lose' ? 'Protein is the most satiating macronutrient — this will help you feel full and preserve muscle while in a deficit.' : 'Supports maintenance of muscle mass and metabolic rate.')
        : n.protein >= 8
        ? 'Moderate protein. A partial contribution toward your daily needs. Not a primary protein source on its own.'
        : 'Low protein. Minimal contribution to muscle maintenance or satiety. Calories here are not doing double duty.';
      compounds.push({ name: 'Protein', amount: r1(n.protein) + 'g', grade: proGrade, effect: proEffect });
    }

    if (n.processed) {
      compounds.push({ name: 'Ultra-processing', amount: 'NOVA 4', grade: 'bad', effect: 'Ultra-processed foods contain additives, emulsifiers, and flavour enhancers not found in home cooking. Research links frequent NOVA 4 consumption to increased all-cause mortality, gut microbiome disruption, and higher rates of depression and metabolic syndrome — independent of the macronutrient content.' });
    }

    return compounds;
  }

  /* ── DIET PLAN GENERATION ─────────────────────────────────── */
  function generateDietPlan(food) {
    if (!S.profile || !S.budgets) return null;
    var daily = S.budgets.dailyTarget;
    var goal  = S.profile.goal;
    var diet  = S.profile.diet;
    var name  = food.name;
    var kcal  = food.kcal || 0;
    var isProcessed = food.processed;

    var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Meal templates based on goal
    var breakfasts = goal === 'gain'
      ? ['Oatmeal + 2 eggs + banana', 'Greek yogurt bowl + granola + berries', 'Wholegrain toast + peanut butter + protein shake', 'Egg scramble + avocado + toast', 'Overnight oats + mixed nuts + fruit', 'Smoothie bowl + chia seeds + honey', 'Pancakes + eggs + orange juice']
      : goal === 'lose'
      ? ['2 eggs + spinach + black coffee', 'Greek yogurt + berries + black coffee', 'Oatmeal + cinnamon + green tea', 'Cottage cheese + sliced apple', 'Egg whites + mushrooms + coffee', '2 boiled eggs + cucumber', 'Smoked salmon + cream cheese + cucumber']
      : ['Wholegrain toast + eggs + fruit', 'Oatmeal + banana + coffee', 'Yogurt + granola + berries', 'Egg muffins + orange juice', 'Avocado toast + poached egg', 'Smoothie + wholegrain toast', 'Scrambled eggs + wholegrain toast'];

    var lunches = goal === 'gain'
      ? ['Chicken rice bowl + broccoli', 'Tuna sandwich on wholegrain + salad', 'Beef stir-fry + noodles', 'Salmon + sweet potato + greens', 'Turkey wrap + avocado', 'Pasta + chicken + tomato sauce', 'Quinoa + chickpeas + roasted veg']
      : goal === 'lose'
      ? ['Grilled chicken salad + olive oil dressing', 'Tuna + mixed greens + lemon', 'Turkey lettuce wraps + cucumber', 'Salmon + steamed broccoli', 'Chickpea salad + feta', 'Chicken soup + side salad', 'Prawn + courgette noodles']
      : ['Grilled chicken + rice + salad', 'Salmon + quinoa + greens', 'Turkey sandwich on rye + fruit', 'Veggie soup + wholegrain bread', 'Tuna wrap + side salad', 'Chicken stir-fry + brown rice', 'Lentil soup + seeded roll'];

    var dinners = goal === 'gain'
      ? ['Beef burger + sweet potato fries', 'Pasta + ground beef bolognese', 'Grilled salmon + rice + veg', 'Chicken thighs + roasted potatoes', 'Steak + mashed potato + salad', 'Pizza night — 2–3 slices', 'Pork chops + apple sauce + veg']
      : goal === 'lose'
      ? ['Baked cod + steamed asparagus', 'Grilled chicken + roasted peppers', 'Prawn stir-fry + courgette', 'Salmon + spinach + lemon', 'Turkey mince + lettuce cups', 'Egg white omelette + tomatoes', 'Chicken broth + vegetables']
      : ['Grilled salmon + roasted veg', 'Chicken + brown rice + salad', 'Beef + sweet potato + greens', 'Veggie curry + brown rice', 'Grilled fish + new potatoes', 'Turkey + pasta + tomato sauce', 'Steak + salad + sourdough'];

    var snacks = isProcessed
      ? ['Skip — you\'ve got ' + name + ' in the budget today', 'Apple + almond butter', 'Handful of mixed nuts', 'Greek yogurt + honey', 'Rice cakes + avocado', 'Carrots + hummus', 'Protein shake']
      : ['Apple + almond butter', 'Greek yogurt', 'Handful of nuts', 'Rice cakes + hummus', name + ' ← this works here', 'Banana + peanut butter', 'Boiled egg'];

    return DAYS.map(function(day, i) {
      var dayKcal = daily;
      var includeFood = (i === 0 || i === 3); // Show scanned food on day 1 and 4
      var snack = includeFood && kcal > 0 ? name + ' (' + Math.round(kcal) + ' kcal)' : snacks[i % snacks.length];
      var snackKcal = includeFood ? kcal : Math.round(daily * 0.08);
      return {
        day: day,
        kcal: Math.round(dayKcal),
        meals: [
          { label: 'Breakfast', text: breakfasts[i] },
          { label: 'Lunch',     text: lunches[i] },
          { label: 'Snack',     text: snack },
          { label: 'Dinner',    text: dinners[i] }
        ]
      };
    });
  }

  /* ── HANDLE SCAN RESULT ───────────────────────────────────── */
  function handleScanResult(food) {
    ['kcal','protein','carbs','fat','satFat','sugar','fiber','sodium'].forEach(function(k){ food[k]=parseFloat(food[k])||0; });
    food.processed = !!food.processed;
    food.name    = (food.name||'Unknown food').slice(0,60);
    food.serving = food.serving||'1 serving';
    food.swap    = food.swap||'';

    var eval_  = TallyCalc.evaluateFood(food, S.profile);
    var copy   = TallyCalc.verdictCopy(eval_.verdict, S.profile);
    var burn   = TallyCalc.calcBurnOff(food.kcal, S.profile ? S.profile.weightKg : 70);
    var allow  = TallyCalc.calcWeeklyAllowance(food, eval_.verdict, S.weekState);
    var compounds = getCompounds(food);
    var dietPlan  = generateDietPlan(food);

    S.result = { food:food, eval:eval_, copy:copy, burn:burn, allow:allow, compounds:compounds, dietPlan:dietPlan };
    renderResults(S.result);
    navigate('results');
  }

  /* ── RENDER RESULTS ───────────────────────────────────────── */
  function renderResults(r) {
    if (!r) return;
    var food=r.food, ev=r.eval, copy=r.copy, burn=r.burn, allow=r.allow;

    setText('result-food-name', food.name);
    setText('result-food-meta', [food.brand, food.serving].filter(Boolean).join(' · '));

    // Verdict pill
    var vp = document.getElementById('result-verdict-pill');
    if (vp) vp.innerHTML = '<div class="verdict-pill ' + ev.verdict + '"><div class="verdict-pill-dot"></div>' + esc(copy.stamp) + '</div>';
    setText('result-headline', copy.headline);
    setText('result-summary',  copy.summary);

    // Nutrition
    setText('result-kcal',    Math.round(food.kcal)||0);
    setText('result-protein', r1(food.protein)||0);
    setText('result-carbs',   r1(food.carbs)||0);
    setText('result-fat',     r1(food.fat)||0);
    setText('result-sugar',   r1(food.sugar)||0);
    setText('result-fiber',   r1(food.fiber)||0);

    // Compounds
    var compEl = document.getElementById('result-compounds');
    if (compEl) {
      if (r.compounds.length === 0) {
        compEl.innerHTML = '<div style="padding:var(--s4);color:var(--label-2);font-size:15px">No significant compounds to flag.</div>';
      } else {
        compEl.innerHTML = r.compounds.map(function(c) {
          return '<div class="compound-item"><div class="compound-row"><span class="compound-name">' + esc(c.name) + '</span><span class="compound-badge ' + c.grade + '">' + (c.grade === 'good' ? 'Beneficial' : c.grade === 'bad' ? 'Concern' : 'Neutral') + '</span></div>' +
            '<div class="compound-amount">' + esc(c.amount) + ' per serving</div>' +
            '<div class="compound-effect">' + esc(c.effect) + '</div></div>';
        }).join('');
      }
    }

    // Effects
    var posEl = document.getElementById('result-positives');
    var negEl = document.getElementById('result-negatives');
    if (posEl) posEl.innerHTML = ev.positives.length
      ? ev.positives.map(function(p){ return '<div class="effect-item pos"><p>' + esc(p) + '</p></div>'; }).join('')
      : '<div style="padding:var(--s3) 0;font-size:14px;color:var(--label-2)">No positive effects flagged.</div>';
    if (negEl) negEl.innerHTML = ev.negatives.length
      ? ev.negatives.map(function(n){ return '<div class="effect-item neg"><p>' + esc(n) + '</p></div>'; }).join('')
      : '<div style="padding:var(--s3) 0;font-size:14px;color:var(--label-2)">No downsides flagged.</div>';

    // Ticket
    var tFig=document.getElementById('ticket-figure'), tLbl=document.getElementById('ticket-figure-label'), tMsg=document.getElementById('ticket-message');
    if (allow.type==='free') { if(tFig) tFig.textContent='∞'; if(tLbl) tLbl.textContent='no limit'; }
    else if (allow.servings!==null) { if(tFig) tFig.textContent=allow.servings; if(tLbl) tLbl.textContent=allow.servings===1?'serving left this week':'servings left this week'; }
    else { if(tFig) tFig.textContent='0'; if(tLbl) tLbl.textContent='servings left this week'; }
    if (tMsg) tMsg.textContent = allow.message;

    // Burn
    var burnEl = document.getElementById('result-burn');
    if (burnEl) {
      if (!burn || !burn.length) { burnEl.innerHTML='<div style="padding:var(--s4);font-size:15px;color:var(--label-2)">Zero calories — nothing to burn!</div>'; }
      else {
        var bicons = { walk:'<path d="M13 4a1 1 0 100-2 1 1 0 000 2z"/><path d="M7 21l2-5 3 2 2-8 3 3h2"/>', cycle:'<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h12M9 7h5l2 5H7z"/>', jog:'<circle cx="12" cy="4" r="1"/><path d="M6 21l3-7 3 2 3-8 3 4h2"/>', swim:'<path d="M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 11l3-3 3 2 3-4 3 2"/>', hiit:'<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>' };
        burnEl.innerHTML = burn.map(function(b) {
          return '<div class="burn-item"><div class="burn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (bicons[b.id]||bicons.walk) + '</svg></div><div class="burn-name">' + esc(b.label) + '</div><div class="burn-mins">' + b.minutes + '<span> min</span></div></div>';
        }).join('');
      }
    }

    // Diet plan
    var dpEl = document.getElementById('result-diet-plan');
    if (dpEl) {
      if (!r.dietPlan) { dpEl.innerHTML = '<div style="padding:var(--s4);color:var(--label-2);font-size:15px">Complete setup to get a personalised plan.</div>'; }
      else {
        dpEl.innerHTML = r.dietPlan.map(function(d) {
          return '<div class="diet-plan-day"><div class="diet-plan-day-header"><span class="diet-plan-day-name">' + d.day + '</span><span class="diet-plan-day-kcal">~' + d.kcal.toLocaleString() + ' kcal</span></div>' +
            '<div class="diet-plan-meals">' + d.meals.map(function(m){ return '<div class="diet-plan-meal"><strong>' + m.label + '</strong> — ' + esc(m.text) + '</div>'; }).join('') + '</div></div>';
        }).join('');
      }
    }

    // Swap
    var swapEl = document.getElementById('result-swap');
    if (swapEl) swapEl.innerHTML = food.swap
      ? '<div class="swap-card"><div class="swap-card-label">Healthier swap</div><p>' + esc(food.swap) + '</p></div>'
      : '';
  }

  /* ── LOG FROM RESULTS ────────────────────────────────────── */
  function logCurrentFood() {
    if (!S.result) return;
    var food=S.result.food, ev=S.result.eval;
    S.logs.unshift({ id: Date.now()+'-'+Math.random().toString(36).slice(2,7), timestamp:Date.now(), foodId:food.id||null, name:food.name, brand:food.brand||'', serving:food.serving||'', kcal:food.kcal||0, verdict:ev.verdict, swap:food.swap||'' });
    saveLogs(S.logs); recompute();
    showToast(food.name + ' logged');
    navigate('home');
  }

  /* ── LOG VIEW ────────────────────────────────────────────── */
  function renderLog() {
    recompute();
    var chartEl = document.getElementById('week-chart');
    var contentEl = document.getElementById('log-content');
    if (!contentEl) return;

    var days = getWeekDays();
    var daily = S.budgets ? S.budgets.dailyTarget : 2000;
    var maxVal = Math.max(daily * 1.2, 500);

    // Chart
    if (chartEl) {
      chartEl.innerHTML = days.map(function(d) {
        var tot = d.logs.reduce(function(s,l){ return s+l.kcal; }, 0);
        var pct = Math.min(tot / maxVal, 1);
        var isOver = tot > daily;
        var cls = d.isToday ? 'today' : isOver ? 'over' : '';
        return '<div class="wc-bar' + (d.isToday?' is-today':'') + '"><div class="wc-track"><div class="wc-fill ' + cls + '" style="height:' + Math.round(pct*100) + '%"></div></div><div class="wc-label">' + d.short + '</div></div>';
      }).join('');
    }

    if (!S.logs.length) {
      contentEl.innerHTML = '<div class="empty-state"><div class="e-icon"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></svg></div><div class="e-title">Nothing logged yet</div><div class="e-sub">Scan a food item to begin tracking your week.</div></div>';
      return;
    }

    var grouped = groupByDay(S.logs);
    contentEl.innerHTML = grouped.map(function(grp) {
      var tot = grp.logs.reduce(function(s,l){ return s+l.kcal; }, 0);
      return '<div class="day-group-header"><span>' + grp.label + '</span><span class="day-group-total">' + Math.round(tot).toLocaleString() + ' kcal</span></div>' +
        '<div class="card" style="margin:0 var(--s4) var(--s3);border-radius:var(--r-lg);overflow:hidden">' +
        grp.logs.map(function(l) {
          return '<div class="log-entry"><div class="log-entry-dot ' + (l.verdict||'neutral') + '"></div><div class="log-entry-info"><div class="log-entry-name">' + esc(l.name) + '</div><div class="log-entry-meta">' + esc(l.serving||'') + (l.brand?' · '+esc(l.brand):'') + '</div></div><div class="log-entry-kcal">' + Math.round(l.kcal) + '</div><button class="log-entry-del" data-id="' + l.id + '" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg></button></div>';
        }).join('') + '</div>';
    }).join('');

    contentEl.querySelectorAll('.log-entry-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        S.logs = S.logs.filter(function(l){ return l.id !== btn.dataset.id; });
        saveLogs(S.logs); recompute(); renderLog(); renderTopbar();
      });
    });
  }

  function getWeekDays() {
    var now = new Date(), ws = TallyCalc.getWeekStart(now);
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(function(short,i) {
      var d = new Date(ws.getTime() + i*86400000), ds = d.getTime(), de = ds+86400000;
      return { short:short, date:d, logs:S.logs.filter(function(l){ return l.timestamp>=ds&&l.timestamp<de; }), isToday:d.toDateString()===now.toDateString() };
    });
  }

  function groupByDay(logs) {
    var map={}, order=[];
    logs.forEach(function(l){ var k=new Date(l.timestamp).toDateString(); if(!map[k]){map[k]={label:fmtDay(new Date(l.timestamp)),ts:l.timestamp,logs:[]};order.push(k);} map[k].logs.push(l); });
    var seen={};
    var unique=order.filter(function(k){if(seen[k])return false;seen[k]=true;return true;});
    unique.sort(function(a,b){ return map[b].ts-map[a].ts; });
    return unique.map(function(k){ return map[k]; });
  }

  function fmtDay(date) {
    var now=new Date();
    if(date.toDateString()===now.toDateString()) return 'Today';
    var y=new Date(now); y.setDate(now.getDate()-1);
    if(date.toDateString()===y.toDateString()) return 'Yesterday';
    return date.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  }

  /* ── SETTINGS ────────────────────────────────────────────── */
  function renderSettings() {
    if (!S.profile || !S.budgets) return;
    var p=S.profile, b=S.budgets;
    setText('settings-name', p.name||'Profile');
    var goalObj=TallyData.GOALS[p.goal]||{}, dietObj=TallyData.DIET_PHILOSOPHIES[p.diet]||{}, actObj=TallyData.ACTIVITY_LEVELS[p.activity]||{};
    setText('settings-goal-sub', (goalObj.label||p.goal) + ' · ' + (dietObj.label||p.diet));
    setText('stat-daily',  fmtK(b.dailyTarget));
    setText('stat-weekly', fmtK(b.weeklyBudget));
    setText('stat-flex',   fmtK(b.flexibleBudget));
    setText('stat-bmr',    fmtK(b.bmr));
    setText('settings-goal-label', goalObj.label||p.goal);
    setText('settings-diet-label', dietObj.label||p.diet);
    setText('settings-act-label',  actObj.label||p.activity);
    setText('settings-pace-label', (((goalObj.paces||{})[p.pace])||{}).desc||p.pace);

    // Avatar initial
    var av = document.getElementById('profile-avatar');
    if (av) av.textContent = (p.name||'?').charAt(0).toUpperCase();

    // Key status
    var ks=document.getElementById('apikey-status'), kd=document.getElementById('key-dot');
    if (ks) ks.textContent = S.apiKey ? S.apiKey.slice(0,8)+'…'+S.apiKey.slice(-4)+' (tap Edit to change)' : 'Not set — tap Scan to add your free key';
    if (kd) kd.className = 'key-dot' + (S.apiKey ? '' : ' unset');
  }

  /* ── ONBOARDING ──────────────────────────────────────────── */
  var ob = { step:0, data:{ name:'',sex:'female',weightKg:null,heightCm:null,age:null,units:'metric',activity:'moderate',goal:'lose',pace:'standard',diet:'balanced' } };
  var OB_STEPS = ['basics','body','activity','goal','diet'];

  function showOnboarding() { document.getElementById('onboarding').classList.remove('hidden'); ob.step=0; renderObStep(); }
  function hideOnboarding() { document.getElementById('onboarding').classList.add('hidden'); }

  function renderObStep() {
    OB_STEPS.forEach(function(s,i) {
      var el=document.getElementById('ob-'+s);
      if (el) el.className = 'ob-step' + (i===ob.step?' active':'');
    });
    var dots=document.querySelectorAll('.ob-progress-dot');
    dots.forEach(function(d,i){ d.className='ob-progress-dot'+(i<ob.step?' done':i===ob.step?' active':''); });
    var bb=document.getElementById('ob-back'); if(bb) bb.classList.toggle('hidden', ob.step===0);
    var nb=document.getElementById('ob-next'); if(nb) nb.textContent=ob.step===OB_STEPS.length-1?'Get started':'Continue';
    clearObError();
  }

  function obNext() { if(!validateObStep()) return; if(ob.step===OB_STEPS.length-1){finishOnboarding();return;} ob.step++; renderObStep(); }
  function obBack() { if(ob.step>0){ob.step--;renderObStep();} }

  function validateObStep() {
    var s=OB_STEPS[ob.step]; clearObError();
    if (s==='basics') {
      var name=document.getElementById('ob-name').value.trim(), age=parseInt(document.getElementById('ob-age').value,10);
      if(!name){showObError('Please enter your name.');return false;}
      if(!age||age<10||age>120){showObError('Please enter a valid age (10–120).');return false;}
      ob.data.name=name; ob.data.age=age;
      var sp=document.querySelector('#ob-basics .option-item.selected input'); if(sp) ob.data.sex=sp.value;
    }
    if (s==='body') {
      if(ob.data.units==='metric') {
        var wkg=parseFloat(document.getElementById('ob-weight-kg').value), hcm=parseFloat(document.getElementById('ob-height-cm').value);
        if(!wkg||wkg<30||wkg>300){showObError('Enter weight in kg (30–300).');return false;}
        if(!hcm||hcm<100||hcm>250){showObError('Enter height in cm (100–250).');return false;}
        ob.data.weightKg=wkg; ob.data.heightCm=hcm;
      } else {
        var wlb=parseFloat(document.getElementById('ob-weight-lb').value), hft=parseInt(document.getElementById('ob-height-ft').value,10), hin=parseInt(document.getElementById('ob-height-in').value,10)||0;
        if(!wlb||wlb<66||wlb>660){showObError('Enter weight in lbs (66–660).');return false;}
        if(!hft||hft<3||hft>8){showObError('Enter height in feet (3–8).');return false;}
        ob.data.weightKg=TallyCalc.lbsToKg(wlb); ob.data.heightCm=TallyCalc.ftInToCm(hft,hin);
      }
    }
    if (s==='activity') { var ap=document.querySelector('#ob-activity .option-item.selected input'); if(!ap){showObError('Please select activity level.');return false;} ob.data.activity=ap.value; }
    if (s==='goal') {
      var gp=document.querySelector('#ob-goal .goal-group .option-item.selected input'); if(!gp){showObError('Please select a goal.');return false;}
      ob.data.goal=gp.value;
      var pp=document.querySelector('#ob-goal .pace-group .option-item.selected input');
      ob.data.pace=pp?pp.value:((TallyData.GOALS[ob.data.goal]||{}).defaultPace||'standard');
    }
    if (s==='diet') { var dp=document.querySelector('#ob-diet .option-item.selected input'); if(!dp){showObError('Please choose a diet style.');return false;} ob.data.diet=dp.value; }
    return true;
  }

  function finishOnboarding() {
    S.profile={ name:ob.data.name, sex:ob.data.sex, age:ob.data.age, weightKg:ob.data.weightKg, heightCm:ob.data.heightCm, activity:ob.data.activity, goal:ob.data.goal, pace:ob.data.pace, diet:ob.data.diet, units:ob.data.units };
    saveProfile(S.profile); recompute(); hideOnboarding(); navigate('home'); renderTopbar();
  }

  function showObError(msg) { var el=document.getElementById('ob-error'); if(el){el.textContent=msg;el.className='ob-error visible';} }
  function clearObError()   { var el=document.getElementById('ob-error'); if(el){el.textContent='';el.className='ob-error';} }

  function setObUnits(units) {
    ob.data.units=units;
    document.querySelectorAll('#unit-seg button').forEach(function(b){ b.classList.toggle('active',b.dataset.units===units); });
    document.getElementById('metric-fields').classList.toggle('hidden',units!=='metric');
    document.getElementById('imperial-fields').classList.toggle('hidden',units!=='imperial');
  }

  function updatePacePills() {
    var goalVal=(document.querySelector('#ob-goal .goal-group .option-item.selected input')||{}).value;
    var ps=document.getElementById('ob-pace-section'); if(!ps) return;
    if(!goalVal||goalVal==='maintain'){ps.style.display='none';return;}
    ps.style.display='block';
    var pg=ps.querySelector('.pace-group'), goalObj=TallyData.GOALS[goalVal]||{}, paces=goalObj.paces||{};
    pg.innerHTML = Object.keys(paces).map(function(pk) {
      var pace=paces[pk], isD=pk===goalObj.defaultPace;
      return '<label class="option-item'+(isD?' selected':'')+'"><input type="radio" name="ob_pace" value="'+pk+'"'+(isD?' checked':'')+'><div class="option-radio"></div><div class="option-body"><div class="option-title">'+pace.label+'</div><div class="option-desc">'+pace.desc+'</div></div></label>';
    }).join('');
    bindOptions(pg);
  }

  /* ── OPTION ITEMS ────────────────────────────────────────── */
  function bindOptions(container) {
    (container||document).querySelectorAll('.option-item input[type="radio"]').forEach(function(input) {
      input.addEventListener('change', function() {
        var name=input.getAttribute('name');
        document.querySelectorAll('.option-item input[name="'+name+'"]').forEach(function(o){
          o.closest('.option-item').classList.toggle('selected', o===input);
        });
        if (name==='ob_goal') updatePacePills();
      });
    });
  }

  /* ── TOAST ───────────────────────────────────────────────── */
  var _tt=null;
  function showToast(msg) {
    var t=document.getElementById('toast'); if(!t) return;
    t.textContent=msg; t.classList.add('show');
    clearTimeout(_tt); _tt=setTimeout(function(){t.classList.remove('show');},2200);
  }

  /* ── HELPERS ─────────────────────────────────────────────── */
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function setText(id,val) { var el=document.getElementById(id); if(el) el.textContent=val; }
  function fmt(n) { n=Math.round(n||0); return (n<0?'-':'')+Math.abs(n).toLocaleString()+' kcal'; }
  function fmtK(n) { n=Math.round(n||0); return Math.abs(n).toLocaleString(); }
  function r1(n)  { return Math.round((n||0)*10)/10; }

  /* ── WIRE EVENTS ─────────────────────────────────────────── */
  function wire() {
    // Nav
    document.querySelectorAll('.nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var v=btn.dataset.nav;
        if(v && S.profile) navigate(v);
        else if(!S.profile) showToast('Complete setup first');
      });
    });

    // Onboarding
    document.getElementById('ob-next').addEventListener('click', obNext);
    document.getElementById('ob-back').addEventListener('click', obBack);

    // Unit seg
    document.querySelectorAll('#unit-seg button').forEach(function(b){ b.addEventListener('click', function(){ setObUnits(b.dataset.units); }); });

    // Option radios
    bindOptions(document);

    // Camera
    var cam=document.getElementById('camera-input');
    if(cam) cam.addEventListener('change', function(){ if(cam.files&&cam.files[0]){ handleImageCapture(cam.files[0]); cam.value=''; } });
    var scanBtn=document.getElementById('take-photo-btn');
    if(scanBtn) scanBtn.addEventListener('click', function(){ document.getElementById('camera-input').click(); });

    // Search
    var si=document.getElementById('scan-search-input');
    if(si) si.addEventListener('input', function(){ handleManualSearch(si.value); });

    // Results
    var logBtn=document.getElementById('log-food-btn'); if(logBtn) logBtn.addEventListener('click', logCurrentFood);
    var backBtn=document.getElementById('result-back-btn'); if(backBtn) backBtn.addEventListener('click', function(){ navigate('scan'); });

    // API key
    var ckBtn=document.getElementById('change-apikey-btn');
    if(ckBtn) ckBtn.addEventListener('click', function(){ showApiKeyScreen(function(){ renderSettings(); showToast('Key saved'); }); });
    var cancelKey=document.getElementById('apikey-cancel-btn');
    if(cancelKey) cancelKey.addEventListener('click', hideApiKeyScreen);

    // Reset
    var editBtn=document.getElementById('edit-profile-btn');
    if(editBtn) editBtn.addEventListener('click', function(){ document.getElementById('confirm-modal').classList.add('visible'); });
    document.getElementById('modal-cancel').addEventListener('click', function(){ document.getElementById('confirm-modal').classList.remove('visible'); });
    document.getElementById('modal-confirm').addEventListener('click', function(){
      document.getElementById('confirm-modal').classList.remove('visible');
      S.logs=[]; saveLogs(S.logs); S.profile=null; saveProfile(null); showOnboarding();
    });

    // Home scan
    var hScan=document.getElementById('home-scan-btn');
    if(hScan) hScan.addEventListener('click', function(){ navigate('scan'); });

    // Close modal on backdrop tap
    document.getElementById('confirm-modal').addEventListener('click', function(e){
      if(e.target===this) this.classList.remove('visible');
    });
  }

  document.addEventListener('DOMContentLoaded', function(){ wire(); init(); });
})();
