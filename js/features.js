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
  function saveTheme(id) { localStorage.setItem(SK_THEME, id); }

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
    // Dark mode body class
    document.body.classList.toggle('theme-dark', id === 'dark');
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
    localStorage.setItem(SK_WATER, JSON.stringify({ date: getTodayKey(), ml: ml }));
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

  function saveStreakData(d) { localStorage.setItem(SK_STREAK, JSON.stringify(d)); }

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

  function saveMoodLog(log) { localStorage.setItem(SK_MOOD, JSON.stringify(log)); }

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
    active:     false,
    paused:     false,
    startTime:  null,
    pausedMs:   0,
    pauseStart: null,
    positions:  [],     // [{lat, lng, ts, accuracy}]
    distanceKm: 0,
    watchId:    null,
    timerInterval: null,
    calories:   0,
  };

  // MET for running ~8 km/h
  var RUN_MET = 8.0;

  function startRun(weightKg) {
    if (runState.active) return;
    runState.active     = true;
    runState.paused     = false;
    runState.startTime  = Date.now();
    runState.pausedMs   = 0;
    runState.pauseStart = null;
    runState.positions  = [];
    runState.distanceKm = 0;
    runState.calories   = 0;
    runState._weightKg  = weightKg || 70;

    // Start GPS watch
    if (navigator.geolocation) {
      runState.watchId = navigator.geolocation.watchPosition(
        function(pos) {
          if (runState.paused) return;
          var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: pos.timestamp, acc: pos.coords.accuracy };
          // Only accept positions with accuracy < 50m
          if (p.acc > 50) return;
          var last = runState.positions[runState.positions.length - 1];
          if (last) {
            var d = haversineKm(last.lat, last.lng, p.lat, p.lng);
            // Filter GPS noise: ignore jumps > 0.05km in < 2 seconds
            var dt = (p.ts - last.ts) / 1000;
            if (dt > 0 && d / dt < 0.014) { // ~50 km/h max
              runState.distanceKm += d;
            }
          }
          runState.positions.push(p);
          if (typeof onRunUpdate === 'function') onRunUpdate();
        },
        function(err) { console.warn('GPS error:', err.message); },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
      );
    }

    // Update timer every second
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
  }

  function resumeRun() {
    if (!runState.active || !runState.paused) return;
    if (runState.pauseStart) runState.pausedMs += Date.now() - runState.pauseStart;
    runState.paused     = false;
    runState.pauseStart = null;
  }

  function stopRun() {
    if (!runState.active) return null;
    clearInterval(runState.timerInterval);
    if (runState.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(runState.watchId);
    }
    var summary = {
      distanceKm: Math.round(runState.distanceKm * 100) / 100,
      durationMs: getRunDurationMs(),
      calories:   Math.round(runState.calories),
      paceMinKm:  getPace(),
      positions:  runState.positions.slice(),
    };
    runState.active = false;
    return summary;
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
  };

})(window);
