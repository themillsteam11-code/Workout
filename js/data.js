/* Tally — static reference data
 * No DOM access. Safe to load first and to require() in tests.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Diet philosophies
  // flexiblePct = share of the weekly calorie budget treated as "flexible"
  // spend — the part that absorbs treats, takeout, and slip-ups.
  // ---------------------------------------------------------------------
  var DIET_PHILOSOPHIES = {
    lazy: {
      id: 'lazy',
      label: 'Low effort',
      tagline: 'Small swaps. No meal prep. Just stop digging the hole deeper.',
      flexiblePct: 0.30
    },
    balanced: {
      id: 'balanced',
      label: 'Balanced',
      tagline: 'Real meals most days, treats still on the menu.',
      flexiblePct: 0.15
    },
    strict: {
      id: 'strict',
      label: 'High performance',
      tagline: 'Every item has to earn its place this week.',
      flexiblePct: 0.05
    }
  };

  // ---------------------------------------------------------------------
  // Activity levels — Mifflin-St Jeor multipliers
  // ---------------------------------------------------------------------
  var ACTIVITY_LEVELS = {
    sedentary: { id: 'sedentary', multiplier: 1.20, label: 'Sedentary', desc: 'Desk job, little to no exercise' },
    light:     { id: 'light',     multiplier: 1.375, label: 'Lightly active', desc: 'Exercise 1–3 days a week' },
    moderate:  { id: 'moderate',  multiplier: 1.55, label: 'Moderately active', desc: 'Exercise 3–5 days a week' },
    active:    { id: 'active',    multiplier: 1.725, label: 'Very active', desc: 'Exercise 6–7 days a week' },
    athlete:   { id: 'athlete',   multiplier: 1.90, label: 'Athlete', desc: 'Hard daily training or physical job' }
  };

  // ---------------------------------------------------------------------
  // Goals + pacing adjustments (kcal/day vs. maintenance)
  // ---------------------------------------------------------------------
  var GOALS = {
    lose: {
      id: 'lose',
      label: 'Lose weight',
      paces: {
        gentle:     { id: 'gentle', label: 'Gentle', adjust: -250, desc: '~0.25kg / 0.5lb per week' },
        standard:   { id: 'standard', label: 'Standard', adjust: -500, desc: '~0.5kg / 1lb per week' },
        aggressive: { id: 'aggressive', label: 'Aggressive', adjust: -750, desc: '~0.75kg / 1.5lb per week' }
      },
      defaultPace: 'standard'
    },
    maintain: {
      id: 'maintain',
      label: 'Maintain weight',
      paces: {
        standard: { id: 'standard', label: 'Standard', adjust: 0, desc: 'Hold steady' }
      },
      defaultPace: 'standard'
    },
    gain: {
      id: 'gain',
      label: 'Build muscle / gain weight',
      paces: {
        gentle:     { id: 'gentle', label: 'Gentle', adjust: 250, desc: '~0.25kg / 0.5lb per week' },
        standard:   { id: 'standard', label: 'Standard', adjust: 400, desc: '~0.4kg / 0.9lb per week' },
        aggressive: { id: 'aggressive', label: 'Aggressive', adjust: 600, desc: '~0.6kg / 1.3lb per week' }
      },
      defaultPace: 'standard'
    }
  };

  // ---------------------------------------------------------------------
  // Burn-off activities — MET values (Compendium of Physical Activities)
  // calories/min = MET * 3.5 * weightKg / 200
  // ---------------------------------------------------------------------
  var BURN_ACTIVITIES = [
    { id: 'walk',  label: 'Brisk walk',     met: 3.8 },
    { id: 'cycle', label: 'Cycling',        met: 7.5 },
    { id: 'jog',   label: 'Jog',            met: 7.0 },
    { id: 'swim',  label: 'Swimming laps',  met: 6.0 },
    { id: 'hiit',  label: 'HIIT circuit',   met: 8.0 }
  ];

  // ---------------------------------------------------------------------
  // Local food reference — used for manual search and as an offline
  // fallback when the photo-scanning API isn't connected.
  // Values are typical/representative per the stated serving and are
  // approximations for planning purposes, not lab measurements.
  // ---------------------------------------------------------------------
  var FOOD_DB = [
    { id: 'snickers', name: 'Snickers Bar', brand: 'Mars', category: 'snack', serving: '1 bar (50g)', kcal: 250, protein: 4, carbs: 33, fat: 12, satFat: 4.5, sugar: 27, fiber: 1, sodium: 120, processed: true, swap: 'A small handful of almonds + a square of dark chocolate hits the craving with a fraction of the sugar.' },
    { id: 'coke', name: 'Coca-Cola', brand: 'Coca-Cola', category: 'drink', serving: '1 can (330ml)', kcal: 139, protein: 0, carbs: 35, fat: 0, satFat: 0, sugar: 35, fiber: 0, sodium: 15, processed: true, swap: 'Sparkling water with a squeeze of lime gives you the fizz without the sugar hit.' },
    { id: 'doritos', name: 'Doritos Nacho Cheese', brand: 'Frito-Lay', category: 'snack', serving: '1oz bag (28g)', kcal: 150, protein: 2, carbs: 18, fat: 8, satFat: 1, sugar: 1, fiber: 1, sodium: 210, processed: true, swap: 'Air-popped popcorn with a pinch of chilli powder and nutritional yeast scratches the same itch.' },
    { id: 'oreo', name: 'Oreo Cookies', brand: 'Nabisco', category: 'snack', serving: '3 cookies (34g)', kcal: 160, protein: 1, carbs: 25, fat: 7, satFat: 2, sugar: 14, fiber: 1, sodium: 135, processed: true, swap: 'Greek yogurt with a drizzle of honey and cocoa powder covers the sweet-and-creamy craving.' },
    { id: 'bigmac', name: 'Big Mac', brand: "McDonald's", category: 'fastfood', serving: '1 burger (219g)', kcal: 563, protein: 26, carbs: 45, fat: 33, satFat: 11, sugar: 9, fiber: 3, sodium: 1010, processed: true, swap: 'A homemade burger on a lettuce wrap with one bun half cuts calories and sodium hard while keeping the protein.' },
    { id: 'fries', name: 'French Fries (medium)', brand: "McDonald's", category: 'fastfood', serving: '1 medium (111g)', kcal: 340, protein: 4, carbs: 44, fat: 16, satFat: 2.5, sugar: 0, fiber: 4, sodium: 230, processed: true, swap: 'Split a small fries with someone, or swap for a side salad to free up budget for the main.' },
    { id: 'kfc', name: 'Fried Chicken Breast', brand: 'KFC', category: 'fastfood', serving: '1 piece (161g)', kcal: 390, protein: 39, carbs: 11, fat: 21, satFat: 4, sugar: 0, fiber: 0, sodium: 1190, processed: true, swap: 'Grilled or rotisserie chicken gets you the same protein for roughly half the fat and sodium.' },
    { id: 'chicken_breast', name: 'Grilled Chicken Breast', brand: '', category: 'protein', serving: '1 breast (120g)', kcal: 198, protein: 37, carbs: 0, fat: 4, satFat: 1, sugar: 0, fiber: 0, sodium: 74, processed: false, swap: '' },
    { id: 'salmon', name: 'Grilled Salmon Fillet', brand: '', category: 'protein', serving: '1 fillet (150g)', kcal: 280, protein: 39, carbs: 0, fat: 13, satFat: 3, sugar: 0, fiber: 0, sodium: 75, processed: false, swap: '' },
    { id: 'greek_yogurt', name: 'Greek Yogurt, plain', brand: '', category: 'dairy', serving: '1 cup (245g)', kcal: 146, protein: 24, carbs: 9, fat: 0.5, satFat: 0.3, sugar: 9, fiber: 0, sodium: 80, processed: false, swap: '' },
    { id: 'banana', name: 'Banana', brand: '', category: 'fruit', serving: '1 medium (118g)', kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, satFat: 0.1, sugar: 14, fiber: 3, sodium: 1, processed: false, swap: '' },
    { id: 'apple', name: 'Apple', brand: '', category: 'fruit', serving: '1 medium (182g)', kcal: 95, protein: 0.5, carbs: 25, fat: 0.3, satFat: 0.1, sugar: 19, fiber: 4, sodium: 2, processed: false, swap: '' },
    { id: 'almonds', name: 'Almonds', brand: '', category: 'snack', serving: '1oz / 23 nuts (28g)', kcal: 164, protein: 6, carbs: 6, fat: 14, satFat: 1, sugar: 1, fiber: 4, sodium: 0, processed: false, swap: '' },
    { id: 'oatmeal', name: 'Oatmeal, cooked', brand: '', category: 'grain', serving: '1 cup (234g)', kcal: 158, protein: 6, carbs: 27, fat: 3, satFat: 0.5, sugar: 1, fiber: 4, sodium: 9, processed: false, swap: '' },
    { id: 'white_rice', name: 'White Rice, cooked', brand: '', category: 'grain', serving: '1 cup (158g)', kcal: 205, protein: 4, carbs: 45, fat: 0.4, satFat: 0.1, sugar: 0, fiber: 0.6, sodium: 2, processed: false, swap: '' },
    { id: 'broccoli', name: 'Broccoli, steamed', brand: '', category: 'veg', serving: '1 cup (156g)', kcal: 55, protein: 4, carbs: 11, fat: 0.6, satFat: 0.1, sugar: 2, fiber: 5, sodium: 32, processed: false, swap: '' },
    { id: 'avocado', name: 'Avocado', brand: '', category: 'fruit', serving: '1/2 fruit (100g)', kcal: 160, protein: 2, carbs: 9, fat: 15, satFat: 2, sugar: 0.7, fiber: 7, sodium: 7, processed: false, swap: '' },
    { id: 'whole_milk', name: 'Whole Milk', brand: '', category: 'dairy', serving: '1 cup (244g)', kcal: 149, protein: 8, carbs: 12, fat: 8, satFat: 4.6, sugar: 12, fiber: 0, sodium: 105, processed: false, swap: '' },
    { id: 'energy_drink', name: 'Energy Drink', brand: 'Red Bull', category: 'drink', serving: '1 can (250ml)', kcal: 110, protein: 1, carbs: 28, fat: 0, satFat: 0, sugar: 27, fiber: 0, sodium: 105, processed: true, swap: 'Black coffee or green tea gives a similar lift with no sugar crash later.' },
    { id: 'sparkling_water', name: 'Sparkling Water', brand: '', category: 'drink', serving: '1 can (355ml)', kcal: 0, protein: 0, carbs: 0, fat: 0, satFat: 0, sugar: 0, fiber: 0, sodium: 0, processed: false, swap: '' },
    { id: 'pizza', name: 'Pepperoni Pizza Slice', brand: '', category: 'fastfood', serving: '1 slice (107g)', kcal: 298, protein: 12, carbs: 34, fat: 12, satFat: 5, sugar: 4, fiber: 2, sodium: 640, processed: true, swap: 'A thin-crust veggie slice with half the cheese keeps the flavour and drops the saturated fat.' },
    { id: 'protein_bar', name: 'Protein Bar', brand: 'Quest', category: 'snack', serving: '1 bar (60g)', kcal: 200, protein: 21, carbs: 22, fat: 8, satFat: 3.5, sugar: 1, fiber: 14, sodium: 250, processed: true, swap: '' },
    { id: 'croissant', name: 'Croissant', brand: '', category: 'bakery', serving: '1 medium (57g)', kcal: 231, protein: 5, carbs: 26, fat: 12, satFat: 7, sugar: 6, fiber: 1.5, sodium: 256, processed: true, swap: 'A wholegrain English muffin with butter gets you the warm-pastry comfort with much less saturated fat.' },
    { id: 'hummus', name: 'Hummus', brand: '', category: 'dip', serving: '2 tbsp (30g)', kcal: 70, protein: 2, carbs: 6, fat: 5, satFat: 0.7, sugar: 0, fiber: 2, sodium: 130, processed: false, swap: '' },
    { id: 'chips', name: 'Potato Chips', brand: "Lay's", category: 'snack', serving: '1oz bag (28g)', kcal: 160, protein: 2, carbs: 15, fat: 10, satFat: 3, sugar: 0.2, fiber: 1, sodium: 170, processed: true, swap: 'Roasted chickpeas or air-popped popcorn give you crunch and salt for far fewer calories.' },
    { id: 'ice_cream', name: 'Vanilla Ice Cream', brand: '', category: 'dessert', serving: '1/2 cup (66g)', kcal: 137, protein: 2.3, carbs: 16, fat: 7, satFat: 4.5, sugar: 14, fiber: 0.5, sodium: 53, processed: true, swap: 'Frozen banana blended until creamy gives a similar texture with natural sugars only.' },
    { id: 'black_coffee', name: 'Black Coffee', brand: '', category: 'drink', serving: '1 cup (240ml)', kcal: 2, protein: 0.3, carbs: 0, fat: 0, satFat: 0, sugar: 0, fiber: 0, sodium: 5, processed: false, swap: '' },
    { id: 'sushi', name: 'California Roll', brand: '', category: 'meal', serving: '8 pieces (256g)', kcal: 255, protein: 9, carbs: 38, fat: 7, satFat: 1, sugar: 9, fiber: 3, sodium: 428, processed: false, swap: '' },
    { id: 'burger_home', name: 'Homemade Burger', brand: '', category: 'meal', serving: '1 burger (170g)', kcal: 350, protein: 20, carbs: 30, fat: 16, satFat: 6, sugar: 5, fiber: 2, sodium: 480, processed: false, swap: '' },
    { id: 'granola_bar', name: 'Granola Bar', brand: 'Nature Valley', category: 'snack', serving: '1 bar (42g)', kcal: 190, protein: 3, carbs: 29, fat: 7, satFat: 0.5, sugar: 11, fiber: 2, sodium: 105, processed: true, swap: 'Plain oats with a spoon of peanut butter and a few raisins gives a similar bar-like snack with less added sugar.' },
    { id: 'chicken_salad', name: 'Mixed Salad with Chicken', brand: '', category: 'meal', serving: '1 bowl (300g)', kcal: 320, protein: 28, carbs: 14, fat: 17, satFat: 4, sugar: 5, fiber: 5, sodium: 540, processed: false, swap: '' },
    { id: 'donut', name: 'Glazed Donut', brand: '', category: 'bakery', serving: '1 donut (52g)', kcal: 240, protein: 3, carbs: 27, fat: 14, satFat: 6, sugar: 12, fiber: 1, sodium: 205, processed: true, swap: 'A toasted bagel with a thin spread of jam gives you sweetness and chew without the fried dough.' },
    { id: 'protein_shake', name: 'Whey Protein Shake', brand: '', category: 'drink', serving: '1 scoop + water (33g)', kcal: 130, protein: 25, carbs: 4, fat: 1.5, satFat: 0.5, sugar: 2, fiber: 1, sodium: 130, processed: true, swap: '' },
    { id: 'peanut_butter', name: 'Peanut Butter', brand: '', category: 'spread', serving: '2 tbsp (32g)', kcal: 190, protein: 7, carbs: 7, fat: 16, satFat: 3, sugar: 3, fiber: 2, sodium: 150, processed: false, swap: '' },
    { id: 'ramen', name: 'Instant Ramen', brand: 'Nissin', category: 'meal', serving: '1 pack, cooked (430g)', kcal: 380, protein: 8, carbs: 51, fat: 14, satFat: 7, sugar: 2, fiber: 2, sodium: 1820, processed: true, swap: 'Use half the seasoning packet and add an egg plus frozen veg — same comfort, far less sodium.' },
    { id: 'strawberries', name: 'Strawberries', brand: '', category: 'fruit', serving: '1 cup (152g)', kcal: 49, protein: 1, carbs: 12, fat: 0.5, satFat: 0, sugar: 7, fiber: 3, sodium: 1, processed: false, swap: '' }
  ];

  var data = {
    DIET_PHILOSOPHIES: DIET_PHILOSOPHIES,
    ACTIVITY_LEVELS: ACTIVITY_LEVELS,
    GOALS: GOALS,
    BURN_ACTIVITIES: BURN_ACTIVITIES,
    FOOD_DB: FOOD_DB
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = data;
  } else {
    root.TallyData = data;
  }
})(typeof window !== 'undefined' ? window : globalThis);
