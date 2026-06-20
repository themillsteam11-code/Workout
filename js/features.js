/* Tally — Premium Features Module
 * Water tracking, streaks, GPS run tracker, themes, micronutrients, mood/energy
 * All features are self-contained and hook into the global S (state) object.
 */
(function(root) {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     THEME SYSTEM
     5 themes: System (default), Dark, Forest, Sunset, Ocean
     ═══════════════════════════════════════════════════════════════ */
  var THEMES = {
    system: {
      id: 'system', name: 'Default', emoji: '☀️',
      vars: {}  // uses CSS defaults
    },
    dark: {
      id: 'dark', name: 'Midnight', emoji: '🌙',
      vars: {
        '--bg':           '#000000',
        '--bg-elevated':  '#1C1C1E',
        '--bg-grouped':   '#000000',
        '--separator':    'rgba(255,255,255,0.10)',
        '--separator-opaque': '#38383A',
        '--label':        '#FFFFFF',
        '--label-2':      'rgba(235,235,245,0.60)',
        '--label-3':      'rgba(235,235,245,0.30)',
        '--label-4':      'rgba(235,235,245,0.15)',
        '--accent':       '#0A84FF',
        '--positive':     '#30D158',
        '--positive-bg':  'rgba(48,209,88,0.15)',
        '--negative':     '#FF453A',
        '--negative-bg':  'rgba(255,69,58,0.15)',
        '--warning':      '#FF9F0A',
        '--warning-bg':   'rgba(255,159,10,0.15)',
        '--neutral-bg':   '#2C2C2E',
        '--neutral':      '#636366',
      }
    },
    forest: {
      id: 'forest', name: 'Forest', emoji: '🌲',
      vars: {
        '--bg':           '#F0F4F0',
        '--bg-elevated':  '#FFFFFF',
        '--accent':       '#2D6A4F',
        '--accent-light': 'rgba(45,106,79,0.12)',
        '--positive':     '#2D6A4F',
        '--positive-bg':  '#D8F3DC',
        '--negative':     '#B5251A',
        '--negative-bg':  '#FFE5E3',
        '--warning':      '#D4A017',
        '--warning-bg':   '#FFF3C4',
        '--neutral':      '#74796D',
        '--neutral-bg':   '#EAEDEA',
        '--separator':    'rgba(45,74,45,0.10)',
        '--separator-opaque': '#C8D4C8',
      }
    },
    sunset: {
      id: 'sunset', name: 'Sunset', emoji: '🌅',
      vars: {
        '--bg':           '#FFF8F3',
        '--bg-elevated':  '#FFFFFF',
        '--accent':       '#E8671A',
        '--accent-light': 'rgba(232,103,26,0.10)',
        '--positive':     '#2D9E5A',
        '--positive-bg':  '#E0F5EA',
        '--negative':     '#CC2936',
        '--negative-bg':  '#FEEAEB',
        '--warning':      '#E8671A',
        '--warning-bg':   '#FEF0E6',
        '--neutral':      '#8A7060',
        '--neutral-bg':   '#F5EDE5',
        '--separator':    'rgba(100,50,10,0.10)',
        '--separator-opaque': '#DDD0C4',
      }
    },
    ocean: {
      id: 'ocean', name: 'Ocean', emoji: '🌊',
      vars: {
        '--bg':           '#F0F7FF',
        '--bg-elevated':  '#FFFFFF',
        '--accent':       '#0066CC',
        '--accent-light': 'rgba(0,102,204,0.10)',
        '--positive':     '#007755',
        '--positive-bg':  '#D9F2EB',
        '--negative':     '#CC2000',
        '--negative-bg':  '#FFE8E3',
        '--warning':      '#CC7700',
        '--warning-bg':   '#FFF3D6',
        '--neutral':      '#5577AA',
        '--neutral-bg':   '#E5EEF9',
        '--separator':    'rgba(0,60,130,0.10)',
        '--separator-opaque': '#C4D8F0',
      }
    }
  };

  var SK_THEME = 'tally_theme_v1';

  function loadTheme() { try { return localStorage.getItem(SK_THEME) || 'system'; } catch(_){ return 'system'; } }
  function saveTheme(id) { try { localStorage.setItem(SK_THEME, id); } catch(_) { /* Private Browsing — theme won't persist this session, but still applies visually */ } }

  function applyTheme(id) {
    var theme = THEMES[id] || THEMES.system;
    var root  = document.documentElement;
    // Remove all theme vars first
    Object.values(THEMES).forEach(function(t) {
      Object.keys(t.vars).forEach(function(k) { root.style.removeProperty(k); });
    });
    // Apply new theme vars
    Object.keys(theme.vars).forEach(function(k) {
      root.style.setProperty(k, theme.vars[k]);
    });
    // Dark mode class — toggle on BOTH html and body. The pre-paint script
    // in index.html's <head> sets it on <html> before body exists (to avoid
    // a flash-of-wrong-theme on cold boot); this call must clean that up too
    // or switching away from dark would leave a stale class stuck on <html>.
    document.documentElement.classList.toggle('theme-dark', id === 'dark');
    if (document.body) document.body.classList.toggle('theme-dark', id === 'dark');
    saveTheme(id);
  }

  function initTheme() {
    applyTheme(loadTheme());
  }

  /* ═══════════════════════════════════════════════════════════════
     WATER TRACKER
     Daily goal in ml, logged in 250ml glasses, resets at midnight
     ═══════════════════════════════════════════════════════════════ */
  var SK_WATER = 'tally_water_v1';
  var WATER_GOAL_ML = 2500;
  var GLASS_ML      = 250;

  function loadWaterData() {
    try {
      var raw = JSON.parse(localStorage.getItem(SK_WATER)) || {};
      var today = getTodayKey();
      return { date: raw.date || today, ml: raw.date === today ? (raw.ml || 0) : 0 };
    } catch(_) { return { date: getTodayKey(), ml: 0 }; }
  }

  function saveWaterData(ml) {
    try { localStorage.setItem(SK_WATER, JSON.stringify({ date: getTodayKey(), ml: ml })); }
    catch(_) { /* Private Browsing — in-memory only for this session */ }
  }

  function getTodayKey() {
    return new Date().toDateString();
  }

  function addWater(ml) {
    var data = loadWaterData();
    data.ml = Math.min(data.ml + ml, WATER_GOAL_ML * 1.5); // cap at 150%
    saveWaterData(data.ml);
    return data.ml;
  }

  function removeWater(ml) {
    var data = loadWaterData();
    data.ml = Math.max(0, data.ml - ml);
    saveWaterData(data.ml);
    return data.ml;
  }

  function getWaterMl() { return loadWaterData().ml; }

  /* ═══════════════════════════════════════════════════════════════
     STREAKS & GAMIFICATION
     Track consecutive days of logging at least one food item
     ═══════════════════════════════════════════════════════════════ */
  var SK_STREAK = 'tally_streak_v1';

  function loadStreakData() {
    try { return JSON.parse(localStorage.getItem(SK_STREAK)) || { current: 0, best: 0, lastLogDate: null }; }
    catch(_) { return { current: 0, best: 0, lastLogDate: null }; }
  }

  function saveStreakData(d) { try { localStorage.setItem(SK_STREAK, JSON.stringify(d)); } catch(_) {} }

  // Call this whenever a food is logged
  function updateStreak() {
    var data    = loadStreakData();
    var today   = getTodayKey();
    var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    var yKey    = yesterday.toDateString();

    if (data.lastLogDate === today) {
      // Already logged today — streak unchanged
      return data;
    } else if (data.lastLogDate === yKey) {
      // Consecutive day
      data.current += 1;
    } else {
      // Streak broken (or first log ever)
      data.current = 1;
    }
    data.best        = Math.max(data.best, data.current);
    data.lastLogDate = today;
    saveStreakData(data);
    return data;
  }

  function getStreakData() { return loadStreakData(); }

  // Badges earned based on streak
  function getBadges(streakData, logs) {
    var badges = [];
    var streak = streakData.current;
    var best   = streakData.best;
    var totalLogs = logs ? logs.length : 0;

    if (streak >= 3)  badges.push({ emoji: '🔥', name: '3-day streak',    desc: 'Logged for 3 days in a row' });
    if (streak >= 7)  badges.push({ emoji: '⚡', name: 'Week warrior',    desc: '7 consecutive days logged' });
    if (streak >= 30) badges.push({ emoji: '💎', name: 'Monthly legend',  desc: '30 days straight — elite consistency' });
    if (best >= 7)    badges.push({ emoji: '🏆', name: 'Personal best',   desc: 'Your longest streak: ' + best + ' days' });
    if (totalLogs >= 10)  badges.push({ emoji: '🌱', name: 'Getting started', desc: '10 items scanned and logged' });
    if (totalLogs >= 50)  badges.push({ emoji: '🥗', name: 'Food explorer',   desc: '50 items logged — you know your food' });
    if (totalLogs >= 100) badges.push({ emoji: '🎯', name: 'Tracker pro',     desc: '100 logs — serious about your health' });

    return badges;
  }

  /* ═══════════════════════════════════════════════════════════════
     MOOD / ENERGY CHECK-IN
     Daily 5-second check-in: energy 1-5, mood emoji
     ═══════════════════════════════════════════════════════════════ */
  var SK_MOOD = 'tally_mood_v1';

  function loadMoodLog() {
    try { return JSON.parse(localStorage.getItem(SK_MOOD)) || []; }
    catch(_) { return []; }
  }

  function saveMoodLog(log) { try { localStorage.setItem(SK_MOOD, JSON.stringify(log)); } catch(_) {} }

  function logMood(energy, emoji) {
    var log = loadMoodLog();
    // Remove today's existing entry if any
    var today = getTodayKey();
    log = log.filter(function(e) { return new Date(e.timestamp).toDateString() !== today; });
    log.unshift({ timestamp: Date.now(), energy: energy, emoji: emoji });
    // Keep 90 days
    log = log.slice(0, 90);
    saveMoodLog(log);
    return log;
  }

  function getTodayMood() {
    var log   = loadMoodLog();
    var today = getTodayKey();
    return log.find(function(e) { return new Date(e.timestamp).toDateString() === today; }) || null;
  }

  function getMoodTrend(days) {
    var log    = loadMoodLog();
    var cutoff = Date.now() - days * 86400000;
    return log.filter(function(e) { return e.timestamp >= cutoff; });
  }

  /* ═══════════════════════════════════════════════════════════════
     MICRONUTRIENTS
     Estimate vitamins & minerals from food category + macros
     (Real lab values would need a full USDA API — this uses
      category-based estimates that are directionally accurate)
     ═══════════════════════════════════════════════════════════════ */
  function estimateMicronutrients(food) {
    var cat  = food.category || 'meal';
    var kcal = food.kcal || 0;
    var factor = kcal / 100; // scale by 100 kcal

    // Base estimates per 100 kcal by category — directional, not precise
    var bases = {
      fruit:    { vitC: 18, vitA: 4,  vitD: 0,   calcium: 12, iron: 0.3, potassium: 180, vitE: 0.4, folate: 8 },
      veg:      { vitC: 22, vitA: 35, vitD: 0,   calcium: 30, iron: 0.8, potassium: 220, vitE: 0.8, folate: 30 },
      protein:  { vitC: 0,  vitA: 2,  vitD: 0.3, calcium: 8,  iron: 1.2, potassium: 160, vitE: 0.3, folate: 4 },
      dairy:    { vitC: 0,  vitA: 10, vitD: 1.0, calcium: 120,iron: 0.1, potassium: 140, vitE: 0.1, folate: 5 },
      grain:    { vitC: 0,  vitA: 0,  vitD: 0,   calcium: 10, iron: 1.0, potassium: 60,  vitE: 0.5, folate: 18 },
      snack:    { vitC: 0,  vitA: 0,  vitD: 0,   calcium: 5,  iron: 0.3, potassium: 40,  vitE: 0.2, folate: 2 },
      fastfood: { vitC: 1,  vitA: 2,  vitD: 0.1, calcium: 12, iron: 0.6, potassium: 80,  vitE: 0.2, folate: 4 },
      meal:     { vitC: 3,  vitA: 5,  vitD: 0.1, calcium: 15, iron: 0.8, potassium: 100, vitE: 0.3, folate: 8 },
      bakery:   { vitC: 0,  vitA: 1,  vitD: 0,   calcium: 8,  iron: 0.5, potassium: 30,  vitE: 0.3, folate: 6 },
      dessert:  { vitC: 0,  vitA: 2,  vitD: 0.1, calcium: 20, iron: 0.2, potassium: 40,  vitE: 0.1, folate: 2 },
      drink:    { vitC: 5,  vitA: 0,  vitD: 0,   calcium: 5,  iron: 0.1, potassium: 50,  vitE: 0,   folate: 1 },
      spread:   { vitC: 0,  vitA: 4,  vitD: 0,   calcium: 8,  iron: 0.3, potassium: 50,  vitE: 1.2, folate: 2 },
      dip:      { vitC: 1,  vitA: 2,  vitD: 0,   calcium: 15, iron: 0.4, potassium: 70,  vitE: 0.3, folate: 5 },
    };

    var base = bases[cat] || bases.meal;

    return {
      vitC:      Math.round(base.vitC      * factor),
      vitA:      Math.round(base.vitA      * factor),
      vitD:      Math.round(base.vitD      * factor * 10) / 10,
      vitE:      Math.round(base.vitE      * factor * 10) / 10,
      calcium:   Math.round(base.calcium   * factor),
      iron:      Math.round(base.iron      * factor * 10) / 10,
      potassium: Math.round(base.potassium * factor),
      folate:    Math.round(base.folate    * factor),
    };
  }

  // Daily recommended values (adult average)
  var MICRO_RDV = {
    vitC:      90,   // mg
    vitA:      900,  // mcg RAE
    vitD:      15,   // mcg
    vitE:      15,   // mg
    calcium:   1000, // mg
    iron:      8,    // mg (men) / 18 (women) — using men's lower for conservative
    potassium: 3500, // mg
    folate:    400,  // mcg
  };

  var MICRO_LABELS = {
    vitC:      { name: 'Vitamin C', unit: 'mg' },
    vitA:      { name: 'Vitamin A', unit: 'mcg' },
    vitD:      { name: 'Vitamin D', unit: 'mcg' },
    vitE:      { name: 'Vitamin E', unit: 'mg' },
    calcium:   { name: 'Calcium',   unit: 'mg' },
    iron:      { name: 'Iron',      unit: 'mg' },
    potassium: { name: 'Potassium', unit: 'mg' },
    folate:    { name: 'Folate',    unit: 'mcg' },
  };

  /* ═══════════════════════════════════════════════════════════════
     GPS RUN TRACKER
     Uses Geolocation API — works offline once started
     Tracks: distance (km), pace (min/km), duration, calories burned
     Background: uses Page Visibility API to keep tracking when screen off
     ═══════════════════════════════════════════════════════════════ */
  var runState = {
    active:      false,
    paused:      false,
    startTime:   null,
    pausedMs:    0,
    pauseStart:  null,
    positions:   [],     // [{lat, lng, ts, accuracy}]
    distanceKm:  0,
    watchId:     null,
    timerInterval: null,
    calories:    0,
    gpsStatus:   'idle',  // idle | acquiring | active | denied | unavailable | weak-signal
    wakeLock:    null,
    _weightKg:   70,
  };

  var SK_RUN_RECOVERY = 'tally_run_recovery_v1';

  // MET for running ~8 km/h
  var RUN_MET = 8.0;

  // Persist run state every position update so an accidental tab-close
  // (swiping the app away, accidental back-gesture) doesn't silently lose
  // an in-progress run. On next app load we can detect and recover it.
  function persistRunRecovery() {
    try {
      localStorage.setItem(SK_RUN_RECOVERY, JSON.stringify({
        startTime:  runState.startTime,
        pausedMs:   runState.pausedMs,
        positions:  runState.positions,
        distanceKm: runState.distanceKm,
        weightKg:   runState._weightKg,
        savedAt:    Date.now()
      }));
    } catch (_) { /* private browsing — recovery unavailable, run still works this session */ }
  }

  function clearRunRecovery() {
    try { localStorage.removeItem(SK_RUN_RECOVERY); } catch (_) {}
  }

  function getRunRecovery() {
    try {
      var raw = localStorage.getItem(SK_RUN_RECOVERY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      // Only offer recovery if saved within the last 3 hours — older than that
      // is almost certainly a stale/abandoned run, not a real crash.
      if (Date.now() - data.savedAt > 3 * 60 * 60 * 1000) { clearRunRecovery(); return null; }
      return data;
    } catch (_) { return null; }
  }

  // Request the Screen Wake Lock so the screen doesn't sleep mid-run and kill
  // GPS updates. Confirmed via testing: iOS Safari 16.4+ supports this for
  // installed PWAs as of iOS 18.4 (earlier versions had a WebKit bug). Always
  // wrapped in try/catch — low battery or user settings can reject silently.
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return Promise.resolve(null);
    return navigator.wakeLock.request('screen').then(function(lock) {
      runState.wakeLock = lock;
      lock.addEventListener('release', function() { runState.wakeLock = null; });
      return lock;
    }).catch(function() {
      runState.wakeLock = null;
      return null;
    });
  }

  function releaseWakeLock() {
    if (runState.wakeLock) {
      try { runState.wakeLock.release(); } catch (_) {}
      runState.wakeLock = null;
    }
  }

  // Re-acquire wake lock when tab becomes visible again (iOS releases it
  // automatically when the app is backgrounded — this restores it the moment
  // the user comes back, matching documented Wake Lock API behavior).
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible' && runState.active && !runState.paused) {
        requestWakeLock();
      }
    });
  }

  function startRun(weightKg, callbacks) {
    if (runState.active) return;
    callbacks = callbacks || {};

    if (!navigator.geolocation) {
      runState.gpsStatus = 'unavailable';
      if (callbacks.onError) callbacks.onError('unavailable');
      return;
    }

    runState.gpsStatus  = 'acquiring';
    runState.active     = true;
    runState.paused     = false;
    runState.startTime  = Date.now();
    runState.pausedMs   = 0;
    runState.pauseStart = null;
    runState.positions  = [];
    runState.distanceKm = 0;
    runState.calories   = 0;
    runState._weightKg  = weightKg || 70;

    requestWakeLock();

    runState.watchId = navigator.geolocation.watchPosition(
      function(pos) {
        if (runState.paused) return;
        var acc = pos.coords.accuracy;
        var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: pos.timestamp, acc: acc };

        // First good fix — flip status from "acquiring" to "active"
        if (runState.gpsStatus === 'acquiring') runState.gpsStatus = 'active';

        // iOS reports 3000-9000m accuracy when Precise Location is OFF for
        // this app — flag it so the UI can tell the user to enable it,
        // rather than silently producing a flat, useless route.
        if (acc > 500) {
          runState.gpsStatus = 'weak-signal';
        } else if (runState.gpsStatus === 'weak-signal' && acc <= 100) {
          runState.gpsStatus = 'active';
        }

        // Reject genuinely unusable fixes outright (don't add to distance/route)
        if (acc > 1000) {
          if (typeof onRunUpdate === 'function') onRunUpdate();
          return;
        }

        var last = runState.positions[runState.positions.length - 1];
        if (last) {
          var d  = haversineKm(last.lat, last.lng, p.lat, p.lng);
          var dt = (p.ts - last.ts) / 1000;
          // Filter GPS noise: ignore implied speeds over ~50 km/h (faster than
          // any run — almost certainly a GPS jump, not real movement)
          if (dt > 0 && d / dt < 0.014) {
            runState.distanceKm += d;
          }
        }
        runState.positions.push(p);
        persistRunRecovery();
        if (typeof onRunUpdate === 'function') onRunUpdate();
      },
      function(err) {
        // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
        if (err.code === 1) {
          runState.gpsStatus = 'denied';
          runState.active = false;
          clearInterval(runState.timerInterval);
          releaseWakeLock();
          if (callbacks.onError) callbacks.onError('denied');
        } else {
          // Transient errors (timeout, temporarily unavailable) — keep the
          // run going, GPS often recovers on the next fix.
          runState.gpsStatus = 'weak-signal';
        }
        if (typeof onRunUpdate === 'function') onRunUpdate();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );

    runState.timerInterval = setInterval(function() {
      if (!runState.paused) {
        runState.calories = calcRunCalories(runState._weightKg, getRunDurationMs() / 60000);
        if (typeof onRunUpdate === 'function') onRunUpdate();
      }
    }, 1000);
  }

  function pauseRun() {
    if (!runState.active || runState.paused) return;
    runState.paused     = true;
    runState.pauseStart = Date.now();
    releaseWakeLock();
  }

  function resumeRun() {
    if (!runState.active || !runState.paused) return;
    if (runState.pauseStart) runState.pausedMs += Date.now() - runState.pauseStart;
    runState.paused     = false;
    runState.pauseStart = null;
    requestWakeLock();
  }

  function stopRun() {
    if (!runState.active) return null;
    clearInterval(runState.timerInterval);
    if (runState.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(runState.watchId);
    }
    releaseWakeLock();
    clearRunRecovery();
    var summary = {
      distanceKm: Math.round(runState.distanceKm * 100) / 100,
      durationMs: getRunDurationMs(),
      calories:   Math.round(runState.calories),
      paceMinKm:  getPace(),
      positions:  runState.positions.slice(),
    };
    runState.active   = false;
    runState.watchId  = null;
    runState.gpsStatus = 'idle';
    return summary;
  }

  // Discard a recovered run without logging it (user choice on the recovery prompt)
  function discardRunRecovery() {
    clearRunRecovery();
  }

  function getRunDurationMs() {
    if (!runState.startTime) return 0;
    var elapsed = Date.now() - runState.startTime - runState.pausedMs;
    if (runState.paused && runState.pauseStart) elapsed -= (Date.now() - runState.pauseStart);
    return Math.max(0, elapsed);
  }

  function getPace() {
    var mins = getRunDurationMs() / 60000;
    if (runState.distanceKm < 0.01 || mins < 0.1) return null;
    return mins / runState.distanceKm; // min/km
  }

  function calcRunCalories(weightKg, durationMins) {
    return (RUN_MET * 3.5 * weightKg / 200) * durationMins;
  }

  function haversineKm(lat1, lng1, lat2, lng2) {
    var R  = 6371;
    var dL = (lat2 - lat1) * Math.PI / 180;
    var dl = (lng2 - lng1) * Math.PI / 180;
    var a  = Math.sin(dL/2) * Math.sin(dL/2) +
             Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
             Math.sin(dl/2) * Math.sin(dl/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function formatDuration(ms) {
    var s   = Math.floor(ms / 1000);
    var m   = Math.floor(s / 60);
    var h   = Math.floor(m / 60);
    s = s % 60; m = m % 60;
    if (h > 0) return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  function formatPace(minKm) {
    if (!minKm) return '--:--';
    var m = Math.floor(minKm);
    var s = Math.round((minKm - m) * 60);
    return pad2(m) + ':' + pad2(s) + ' /km';
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // onRunUpdate callback — set by the UI layer
  var onRunUpdate = null;

  function setRunUpdateCallback(fn) { onRunUpdate = fn; }

  /* ═══════════════════════════════════════════════════════════════
     EXPORT
     ═══════════════════════════════════════════════════════════════ */
  root.TallyFeatures = {
    // Themes
    THEMES:      THEMES,
    loadTheme:   loadTheme,
    applyTheme:  applyTheme,
    initTheme:   initTheme,

    // Water
    WATER_GOAL_ML: WATER_GOAL_ML,
    GLASS_ML:      GLASS_ML,
    getWaterMl:    getWaterMl,
    addWater:      addWater,
    removeWater:   removeWater,

    // Streaks
    updateStreak:  updateStreak,
    getStreakData: getStreakData,
    getBadges:     getBadges,

    // Mood
    logMood:       logMood,
    getTodayMood:  getTodayMood,
    getMoodTrend:  getMoodTrend,

    // Micronutrients
    estimateMicronutrients: estimateMicronutrients,
    MICRO_RDV:   MICRO_RDV,
    MICRO_LABELS: MICRO_LABELS,

    // Run
    runState:      runState,
    startRun:      startRun,
    pauseRun:      pauseRun,
    resumeRun:     resumeRun,
    stopRun:       stopRun,
    getRunDurationMs: getRunDurationMs,
    getPace:       getPace,
    formatDuration: formatDuration,
    formatPace:    formatPace,
    setRunUpdateCallback: setRunUpdateCallback,
    haversineKm:   haversineKm,
    getRunRecovery:    getRunRecovery,
    discardRunRecovery: discardRunRecovery,
    requestWakeLock:   requestWakeLock,
    releaseWakeLock:   releaseWakeLock,
  };

})(window);
