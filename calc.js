/* Tally — calculation engine
 * Pure functions only. No DOM, no storage. Testable via `node test/test-calc.js`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./data.js'));
  } else {
    root.TallyCalc = factory(root.TallyData);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (TallyData) {
  'use strict';

  // ----------------------------- helpers -----------------------------
  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // ----------------------------- units -----------------------------
  var LB_PER_KG = 2.2046226218;
  var CM_PER_IN = 2.54;

  function lbsToKg(lbs) { return lbs / LB_PER_KG; }
  function kgToLbs(kg) { return kg * LB_PER_KG; }
  function inToCm(inches) { return inches * CM_PER_IN; }
  function cmToIn(cm) { return cm / CM_PER_IN; }
  function ftInToCm(feet, inches) { return ((feet * 12) + inches) * CM_PER_IN; }
  function cmToFtIn(cm) {
    var totalIn = cm / CM_PER_IN;
    var feet = Math.floor(totalIn / 12);
    var inches = Math.round(totalIn - feet * 12);
    if (inches === 12) { feet += 1; inches = 0; }
    return { feet: feet, inches: inches };
  }

  // ----------------------------- energy budgets -----------------------------

  // Mifflin-St Jeor. sex: 'male' | 'female' | 'other'
  function calcBMR(sex, weightKg, heightCm, age) {
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    if (sex === 'male') return base + 5;
    if (sex === 'female') return base - 161;
    return base - 78; // midpoint of the male/female offsets
  }

  function calcTDEE(bmr, activityKey) {
    var level = TallyData.ACTIVITY_LEVELS[activityKey] || TallyData.ACTIVITY_LEVELS.sedentary;
    return bmr * level.multiplier;
  }

  // Returns kcal/day. Floors at 1200 kcal as a safety minimum.
  function calcDailyTarget(tdee, goalKey, paceKey) {
    var goal = TallyData.GOALS[goalKey] || TallyData.GOALS.maintain;
    var pace = goal.paces[paceKey] || goal.paces[goal.defaultPace];
    var target = tdee + pace.adjust;
    return Math.max(Math.round(target), 1200);
  }

  function calcWeeklyBudget(dailyTarget) {
    return Math.round(dailyTarget * 7);
  }

  function calcFlexibleBudget(weeklyBudget, dietKey) {
    var diet = TallyData.DIET_PHILOSOPHIES[dietKey] || TallyData.DIET_PHILOSOPHIES.balanced;
    return Math.round(weeklyBudget * diet.flexiblePct);
  }

  // Convenience: derive every budget figure from a profile object.
  // profile: { sex, weightKg, heightCm, age, activity, goal, pace, diet }
  function deriveBudgets(profile) {
    var bmr = calcBMR(profile.sex, profile.weightKg, profile.heightCm, profile.age);
    var tdee = calcTDEE(bmr, profile.activity);
    var dailyTarget = calcDailyTarget(tdee, profile.goal, profile.pace);
    var weeklyBudget = calcWeeklyBudget(dailyTarget);
    var flexibleBudget = calcFlexibleBudget(weeklyBudget, profile.diet);
    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      dailyTarget: dailyTarget,
      weeklyBudget: weeklyBudget,
      flexibleBudget: flexibleBudget,
      regularBudget: weeklyBudget - flexibleBudget
    };
  }

  // ----------------------------- weeks -----------------------------

  // Week starts Monday 00:00 local time.
  function getWeekStart(date) {
    date = date || new Date();
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay(); // 0 = Sun ... 6 = Sat
    var diff = (day === 0) ? -6 : (1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function isSameWeek(timestamp, now) {
    now = now || new Date();
    var start = getWeekStart(now).getTime();
    var end = start + 7 * 24 * 60 * 60 * 1000;
    return timestamp >= start && timestamp < end;
  }

  function filterThisWeek(logs, now) {
    now = now || new Date();
    return (logs || []).filter(function (l) { return isSameWeek(l.timestamp, now); });
  }

  // logs: [{ timestamp, kcal, verdict, ... }]
  // budgets: { weeklyBudget, flexibleBudget }
  function computeWeekState(logs, budgets, now) {
    var weekLogs = filterThisWeek(logs, now);
    var totalUsed = 0;
    var flexibleUsed = 0;

    weekLogs.forEach(function (l) {
      totalUsed += l.kcal;
      if (l.verdict === 'negative' || l.verdict === 'mixed') {
        flexibleUsed += l.kcal;
      }
    });

    var regularBudget = budgets.weeklyBudget - budgets.flexibleBudget;
    var regularUsed = totalUsed - flexibleUsed;

    return {
      weeklyBudget: budgets.weeklyBudget,
      flexibleBudget: budgets.flexibleBudget,
      regularBudget: regularBudget,
      totalUsed: totalUsed,
      flexibleUsed: flexibleUsed,
      regularUsed: regularUsed,
      totalRemaining: budgets.weeklyBudget - totalUsed,
      flexibleRemaining: budgets.flexibleBudget - flexibleUsed,
      regularRemaining: regularBudget - regularUsed,
      weekLogs: weekLogs
    };
  }

  // ----------------------------- food evaluation -----------------------------

  // food: { kcal, protein, carbs, fat, satFat, sugar, fiber, sodium, processed, category }
  // profile: { goal }
  // Returns { positives: [...], negatives: [...], verdict, healthScore }
  function evaluateFood(food, profile) {
    profile = profile || {};
    var goal = profile.goal || 'maintain';

    var kcal = food.kcal || 0;
    var sugar = food.sugar || 0;
    var satFat = food.satFat || 0;
    var sodium = food.sodium || 0;
    var fiber = food.fiber || 0;
    var protein = food.protein || 0;
    var fat = food.fat || 0;
    var isProduce = food.category === 'fruit' || food.category === 'veg';

    var positives = [];
    var negatives = [];

    // Sodium
    if (sodium >= 600) {
      negatives.push('Sodium is high at ' + Math.round(sodium) + 'mg \u2014 roughly a quarter of a full day\u2019s recommended limit in one serving.');
    }

    // Sugar (produce gets a higher threshold since the sugar comes with fibre and water)
    var sugarThreshold = isProduce ? 22 : 15;
    if (sugar >= sugarThreshold) {
      negatives.push('Sugar content is high at ' + round1(sugar) + 'g \u2014 mostly quick energy with little staying power.');
    }

    // Saturated fat
    if (satFat >= 5) {
      negatives.push('Saturated fat is ' + round1(satFat) + 'g \u2014 close to a quarter of a typical daily limit in this one item.');
    }

    // Fibre
    if (fiber >= 3) {
      positives.push('Good fibre content at ' + round1(fiber) + 'g \u2014 supports digestion and helps you feel full.');
    }

    // Protein, with goal-specific framing
    if (protein >= 15) {
      var tail = ' \u2014 supports steady energy and muscle maintenance.';
      if (goal === 'gain') tail = ' \u2014 useful building material for muscle growth.';
      if (goal === 'lose') tail = ' \u2014 helps you stay full on fewer calories.';
      positives.push('Solid protein content at ' + round1(protein) + 'g' + tail);
    }

    // "Empty calories" check: ultra-processed, fat-heavy, low fibre and protein
    if (food.processed && fiber < 2 && protein < 5 && fat >= 6) {
      negatives.push('Mostly refined carbs and fat with little fibre or protein (' + round1(fiber) + 'g fibre, ' + round1(protein) + 'g protein) \u2014 easy to eat past the serving size without feeling satisfied.');
    }

    // Goal: lose weight \u2014 calorie density cuts both ways
    if (goal === 'lose') {
      if (kcal >= 400) {
        negatives.push('At ' + Math.round(kcal) + ' kcal, this takes a big bite out of a single day\u2019s calorie budget.');
      } else if (kcal > 0 && kcal <= 150 && negatives.length === 0) {
        positives.push('Light at ' + Math.round(kcal) + ' kcal \u2014 easy to fit into a lower-calorie day.');
      }
    }

    // Goal: build muscle \u2014 calories should come with protein
    if (goal === 'gain' && kcal >= 200 && protein < 5) {
      negatives.push('Calorie-dense but only ' + round1(protein) + 'g protein \u2014 most of these calories won\u2019t go toward building muscle.');
    }

    // Processed reinforcement \u2014 only pile on if there's already a real downside
    if (food.processed && negatives.length > 0) {
      negatives.push('Highly processed, with little whole-food nutrition beyond what\u2019s listed above.');
    }

    // Verdict
    var verdict;
    if (positives.length === 0 && negatives.length === 0) {
      verdict = 'neutral';
    } else if (negatives.length === 0) {
      verdict = 'positive';
    } else if (positives.length === 0) {
      verdict = 'negative';
    } else {
      verdict = 'mixed';
    }

    var healthScore = clamp(5 + positives.length - negatives.length, 0, 10);

    return { positives: positives, negatives: negatives, verdict: verdict, healthScore: healthScore };
  }

  // Short copy for the verdict "stamp" + headline, used on the results screen.
  function verdictCopy(verdict, profile) {
    profile = profile || {};
    var goal = TallyData.GOALS[profile.goal] || TallyData.GOALS.maintain;
    var goalLabel = goal.label.toLowerCase();

    switch (verdict) {
      case 'positive':
        return {
          stamp: 'WORTH IT',
          headline: 'This one\u2019s working for you',
          summary: 'No downsides flagged for your goal of ' + goalLabel + ' \u2014 a clean win.'
        };
      case 'negative':
        return {
          stamp: 'OVER BUDGET',
          headline: 'Nothing here is on your side',
          summary: 'Every signal points the wrong way for your goal of ' + goalLabel + ' \u2014 this is pure trade-off.'
        };
      case 'mixed':
        return {
          stamp: 'MIXED BAG',
          headline: 'Some wins, some costs',
          summary: 'A genuine mixed bag for your goal of ' + goalLabel + ' \u2014 worth weighing before you commit.'
        };
      default:
        return {
          stamp: 'NO IMPACT',
          headline: 'Barely moves the needle',
          summary: 'Minimal nutritional impact either way \u2014 basically a free pass.'
        };
    }
  }

  // ----------------------------- burn-off -----------------------------

  // Returns [{ id, label, minutes }] for each configured activity.
  function calcBurnOff(kcal, weightKg) {
    if (!kcal || kcal <= 0) return [];
    var w = (weightKg && weightKg > 0) ? weightKg : 70;
    return TallyData.BURN_ACTIVITIES.map(function (a) {
      var kcalPerMin = (a.met * 3.5 * w) / 200;
      var minutes = Math.round(kcal / kcalPerMin);
      return { id: a.id, label: a.label, minutes: Math.max(1, minutes) };
    });
  }

  // ----------------------------- weekly allowance -----------------------------

  // weekState: from computeWeekState(). verdict: from evaluateFood().
  // Returns { type, servings (optional), message }
  function calcWeeklyAllowance(food, verdict, weekState) {
    var kcal = food.kcal || 0;

    if (kcal <= 0) {
      return { type: 'free', servings: null, message: 'Zero calorie impact \u2014 have it whenever you like.' };
    }

    if (verdict === 'positive' || verdict === 'neutral') {
      // regularRemaining + flexibleRemaining === totalRemaining by construction,
      // so use totalRemaining directly rather than clamping each half separately
      // (clamping each half independently would double-count headroom once one
      // half has gone negative).
      var pool = Math.max(0, weekState.totalRemaining);
      var servings = Math.floor(pool / kcal);

      if (servings <= 0) {
        return { type: 'tight', servings: 0, message: 'Your weekly budget is tight right now \u2014 but this is a good choice whenever you do have room.' };
      }
      if (servings >= 14) {
        return { type: 'plenty', servings: servings, message: 'Plenty of room \u2014 this fits easily into your week, even daily.' };
      }
      return { type: 'fits', servings: servings, message: 'You\u2019ve got room for about ' + servings + (servings === 1 ? ' serving' : ' servings') + ' like this and still stay on plan.' };
    }

    // negative or mixed \u2014 draws from the flexible budget only
    var flexRemaining = Math.max(0, weekState.flexibleRemaining);

    if (kcal > weekState.flexibleBudget) {
      return { type: 'blowout', servings: 0, message: 'A single serving (' + Math.round(kcal) + ' kcal) would use up more than your entire week\u2019s flexible budget on its own.' };
    }

    var servingsLeft = Math.floor(flexRemaining / kcal);

    if (servingsLeft <= 0) {
      return { type: 'over', servings: 0, message: 'You\u2019re out of flexible budget for the week \u2014 best to skip this one, or swap for something lighter.' };
    }
    if (servingsLeft === 1) {
      return { type: 'limit', servings: 1, message: 'You\u2019ve got room for exactly one of these this week before it starts eating into your core nutrition budget.' };
    }
    return { type: 'limit', servings: servingsLeft, message: 'About ' + servingsLeft + ' of these fit your week\u2019s flexible budget \u2014 beyond that, you\u2019re borrowing from tomorrow.' };
  }

  // ----------------------------- habit detection -----------------------------

  // Flags items logged 3+ times in the current week.
  function detectHabits(logs, now) {
    var weekLogs = filterThisWeek(logs, now);
    var counts = {};
    var samples = {};

    weekLogs.forEach(function (l) {
      var key = l.foodId || l.name;
      counts[key] = (counts[key] || 0) + 1;
      if (!samples[key]) samples[key] = l;
    });

    var flags = [];
    Object.keys(counts).forEach(function (key) {
      if (counts[key] >= 3) {
        flags.push({
          key: key,
          name: samples[key].name,
          count: counts[key],
          swap: samples[key].swap || ''
        });
      }
    });

    // Most frequent first
    flags.sort(function (a, b) { return b.count - a.count; });
    return flags;
  }

  return {
    round1: round1,
    clamp: clamp,
    lbsToKg: lbsToKg,
    kgToLbs: kgToLbs,
    inToCm: inToCm,
    cmToIn: cmToIn,
    ftInToCm: ftInToCm,
    cmToFtIn: cmToFtIn,
    calcBMR: calcBMR,
    calcTDEE: calcTDEE,
    calcDailyTarget: calcDailyTarget,
    calcWeeklyBudget: calcWeeklyBudget,
    calcFlexibleBudget: calcFlexibleBudget,
    deriveBudgets: deriveBudgets,
    getWeekStart: getWeekStart,
    isSameWeek: isSameWeek,
    filterThisWeek: filterThisWeek,
    computeWeekState: computeWeekState,
    evaluateFood: evaluateFood,
    verdictCopy: verdictCopy,
    calcBurnOff: calcBurnOff,
    calcWeeklyAllowance: calcWeeklyAllowance,
    detectHabits: detectHabits
  };
});
