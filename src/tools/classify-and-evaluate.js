const taxonomy = require('../mocks/taxonomy.json');

/**
 * Classify a resident's spoken issue description into Mynd's taxonomy.
 *
 * Output shape: { category, category_id, item, item_id, symptom, symptom_id, location }
 * Emergency priority is intentionally NOT set here — Claude decides using the
 * criteria in the system prompt, informed by property_signals returned below.
 *
 * ---
 * ORDERING INVARIANTS — read before editing the synonym lists:
 *
 * 1. itemSynonyms is an ORDERED array. Matching stops at the first hit, so
 *    more-specific phrases MUST come before less-specific ones that would
 *    otherwise swallow them. Examples:
 *      - "water heater" must appear before "heater" (heating system).
 *      - "garbage disposal" must appear before "disposal".
 *      - "cabinet door" / "light switch" must appear in the multi-word item's
 *        synonym list so they win over the generic "door" / "light".
 *
 * 2. symptomSynonymsList is also ORDERED — SEVERITY FIRST. "severe leaking"
 *    (pouring, gushing) must match before "leaking" (drip, seeping) because
 *    the severity band drives emergency classification downstream. Same rule
 *    for "flooding" vs "leaking", "no water" vs "bad water pressure", etc.
 *
 * 3. Avoid greedy substrings. "bath" matches inside "bathroom"; "nest" matches
 *    inside "nesting"; "smoke" matches inside "smoke alarm chirping". Prefer
 *    longer, disambiguated phrases ("bathtub", "nest thermostat",
 *    "smoke coming from").
 *
 * 4. Category keyword fallback at the bottom is last-resort — only fires if
 *    no item synonym matched. Keep its keywords broad but not overlapping
 *    with item synonyms that already handle the term more precisely.
 *
 * Regression coverage for these rules lives in tests/classify-varied.test.js.
 */
function classifyAndEvaluate({ issue_description, property_context }) {
  const classification = classifyIssue(issue_description);

  // Provide context signals for Claude to make the emergency determination
  const contextSignals = {
    outdoor_temp_f: property_context?.ambient_conditions?.current_outdoor_temp_f || null,
    state: property_context?.property?.state || null,
    bathrooms: property_context?.unit?.full_bathrooms || null,
    rainfall_forecast_24h: property_context?.ambient_conditions?.rainfall_forecast_24h || false,
  };

  return {
    taxonomy: classification,
    property_signals: contextSignals,
    note: 'Use the emergency criteria in your instructions to determine priority. Do NOT assume any leak is an emergency — assess severity from the resident description.'
  };
}

function classifyIssue(description) {
  const desc = description.toLowerCase();

  // Item synonyms — ORDERED most-specific first to avoid false matches
  // e.g. "water heater" must match before "heater", "dishwasher" before "washer"
  const itemSynonyms = [
    // Plumbing (multi-word / specific first)
    ['water heater', ['water heater', 'hot water heater', 'hot water tank']],
    ['garbage disposal', ['garbage disposal', 'disposal', 'garbage disposer', 'disposer']],
    ['water purifier', ['water purifier', 'water filter', 'water softener', 'reverse osmosis', 'ro system']],
    ['septic system', ['septic', 'septic tank', 'septic system', 'leach field']],
    ['sump pump', ['sump pump', 'sump']],
    ['backflow', ['backflow', 'back flow', 'backflow preventer']],
    ['sewer', ['sewer', 'sewage', 'sewer line', 'main line', 'sewer smell']],
    ['water system', ['water system', 'main water', 'water main', 'water shutoff', 'water shut off', 'whole house water', 'no water anywhere']],
    ['pipe', ['pipe', 'piping', 'plumbing pipe', 'burst pipe', 'frozen pipe']],
    ['tub or shower', ['tub', 'shower', 'bathtub', 'shower head', 'showerhead']],
    ['toilet', ['toilet', 'commode']],
    ['sink', ['sink', 'basin']],
    ['faucet', ['faucet', 'tap', 'spigot', 'hose bib']],

    // Heating and cooling
    ['air conditioner', ['air conditioner', 'air conditioning', 'a/c', 'a.c.', ' ac ', 'ac ', ' ac', 'the ac', 'my ac', 'central air', 'mini split', 'window unit']],
    ['heating system', ['heater', 'heating system', 'furnace', 'heat pump', 'boiler', 'radiator']],
    ['thermostat', ['thermostat', 'nest thermostat', 'ecobee']],
    ['vents or ducts', ['vent', 'vents', 'duct', 'ducts', 'ductwork', 'air duct', 'register', 'air vent']],
    ['fireplace', ['fireplace', 'chimney', 'hearth', 'gas log']],
    ['swamp cooler', ['swamp cooler', 'evaporative cooler']],

    // Electrical and equipment
    ['smoke alarm', ['smoke alarm', 'smoke detector', 'fire alarm', 'fire detector', 'smoke alarm chirping', 'smoke detector beeping']],
    ['co detector', ['co detector', 'carbon monoxide', 'co alarm']],
    ['ceiling fan', ['ceiling fan']],
    ['ventilation fan', ['exhaust fan', 'bathroom fan', 'vent fan', 'ventilation fan', 'range hood', 'hood fan']],
    ['outlet', ['outlet', 'receptacle', 'electrical outlet', 'plug', 'power outlet', 'gfci']],
    ['switch', ['light switch', 'dimmer switch', 'dimmer', 'switch']],
    ['lighting', ['light fixture', 'recessed light', 'can light', 'light bulb', 'light', 'lights', 'lamp', 'bulb', 'chandelier']],
    ['power', ['power out', 'no power', 'lost power', 'power outage', 'breaker', 'circuit breaker', 'electrical panel', 'fuse', 'fuse box', 'electricity']],
    ['internet', ['internet', 'wifi', 'wi-fi', 'router', 'modem', 'cable', 'network']],

    // Appliances (multi-word first)
    ['dishwasher', ['dishwasher', 'dish washer']],
    ['washing machine', ['washing machine', 'washer', 'clothes washer']],
    ['clothes dryer', ['clothes dryer', 'dryer']],
    ['refrigerator', ['refrigerator', 'fridge', 'icebox', 'ice maker']],
    ['freezer', ['freezer', 'deep freeze']],
    ['cooktop', ['cooktop', 'cook top', 'stovetop', 'stove top']],
    ['stove', ['stove', 'range', 'burner']],
    ['oven', ['oven']],
    ['microwave', ['microwave']],
    ['doorbell', ['doorbell', 'door bell', 'ring doorbell']],
    ['alarm system', ['alarm system', 'security system', 'security alarm', 'house alarm', 'burglar alarm']],

    // Interior (multi-word furniture items first so they win over generic 'door')
    ['cabinet', ['cabinet door', 'cabinet drawer', 'cabinet', 'cabinets', 'cupboard', 'drawer']],

    // Doors and windows
    ['garage door', ['garage door', 'garage opener', 'garage door opener']],
    ['lock and keys', ['lock', 'deadbolt', 'lockout', 'locked out', 'key', 'keys', 'keypad', 'smart lock']],
    ['blinds and shades', ['blind', 'blinds', 'shade', 'shades', 'curtain rod', 'window covering']],
    ['mailbox', ['mailbox', 'mail box']],
    ['door', ['door', 'sliding door', 'screen door', 'front door', 'back door']],
    ['window', ['window', 'windowpane', 'window pane', 'window screen']],

    // Interior (remaining)
    ['countertop', ['countertop', 'counter top', 'counter', 'quartz counter', 'granite counter']],
    ['closet or pantry', ['closet', 'pantry', 'wardrobe']],
    ['baseboard', ['baseboard', 'base board', 'trim', 'molding']],
    ['stair handrail', ['handrail', 'hand rail', 'banister', 'railing']],
    ['shelving', ['shelf', 'shelves', 'shelving']],
    ['ceiling', ['ceiling', 'ceiling damage', 'ceiling stain']],
    ['walls', ['wall', 'walls', 'drywall', 'sheetrock', 'plaster']],

    // Exterior
    ['roof', ['roof', 'roofing', 'shingle', 'shingles']],
    ['gutter', ['gutter', 'gutters', 'downspout']],
    ['porch', ['porch', 'front porch', 'back porch']],
    ['patio', ['patio']],
    ['stairs', ['stairs', 'staircase', 'steps']],
    ['building exterior', ['siding', 'stucco', 'exterior paint', 'exterior wall']],

    // Grounds
    ['irrigation', ['irrigation', 'sprinkler', 'sprinklers', 'sprinkler system']],
    ['landscaping', ['landscape', 'landscaping', 'lawn', 'grass', 'tree', 'trees', 'bush', 'shrub', 'yard work']],
    ['gate', ['gate']],
    ['fence', ['fence', 'fencing']],

    // Carpet and flooring
    ['carpet', ['carpet', 'rug', 'carpeting']],
    ['floor', ['floor', 'flooring', 'hardwood', 'laminate', 'vinyl floor', 'tile floor', 'subfloor']],

    // Pests
    ['termites', ['termite', 'termites', 'wood damage from bugs']],
    ['rodents or birds', ['mouse', 'mice', 'rat', 'rats', 'rodent', 'squirrel', 'bird', 'birds', 'raccoon', 'possum']],
    ['insects', ['ant', 'ants', 'roach', 'roaches', 'cockroach', 'cockroaches', 'spider', 'spiders', 'bee', 'bees', 'wasp', 'wasps', 'hornet', 'flea', 'fleas', 'bug', 'bugs', 'insect', 'insects', 'silverfish', 'centipede']],
    ['pest control', ['pest control', 'exterminator', 'infestation']],

    // Pool
    ['pool', ['pool', 'swimming pool', 'hot tub', 'spa', 'jacuzzi']],
  ];

  // Match item using synonyms first (ordered most-specific to least)
  let matchedItem = null;
  let matchedCategory = null;

  for (const [itemName, synonyms] of itemSynonyms) {
    if (synonyms.some(syn => desc.includes(syn))) {
      const itemData = taxonomy.items[itemName];
      if (itemData) {
        matchedItem = { name: itemName, id: itemData.id };
        matchedCategory = { name: itemData.category, id: taxonomy.categories[itemData.category]?.id };
        break;
      }
    }
  }

  // Fallback: exact taxonomy item name match
  if (!matchedItem) {
    for (const [itemName, itemData] of Object.entries(taxonomy.items)) {
      if (desc.includes(itemName.toLowerCase())) {
        matchedItem = { name: itemName, id: itemData.id };
        matchedCategory = { name: itemData.category, id: taxonomy.categories[itemData.category]?.id };
        break;
      }
    }
  }

  // Broader keyword matching if no exact item match
  if (!matchedItem) {
    const categoryKeywords = {
      'plumbing': ['leak', 'water', 'drip', 'pipe', 'drain', 'flush', 'sewage', 'sewer', 'clog', 'faucet', 'hot water', 'septic', 'sump', 'backflow', 'plumbing'],
      'heating and cooling': ['heat', 'cool', 'cooling', 'ac ', 'a/c', 'a.c.', 'air condition', 'furnace', 'hvac', 'thermostat', 'vent', 'duct', 'cold air', 'warm air', 'temperature', 'fireplace', 'chimney', 'swamp cooler'],
      'electrical and equipment': ['electric', 'outlet', 'light', 'power', 'breaker', 'switch', 'wire', 'spark', 'fan', 'smoke alarm', 'carbon monoxide', 'wifi', 'internet', 'modem', 'router', 'gfci', 'fuse'],
      'appliances': ['refrigerator', 'fridge', 'freezer', 'dishwasher', 'oven', 'stove', 'washer', 'dryer', 'microwave', 'disposal', 'range', 'doorbell', 'alarm system', 'ice maker'],
      'doors and windows': ['door', 'window', 'lock', 'key', 'garage', 'blind', 'shade', 'screen', 'deadbolt', 'mailbox'],
      'interior': ['wall', 'ceiling', 'cabinet', 'counter', 'baseboard', 'shelf', 'closet', 'pantry', 'trim', 'handrail', 'banister', 'drywall'],
      'exterior': ['roof', 'shingle', 'gutter', 'downspout', 'siding', 'stucco', 'porch', 'patio', 'deck', 'stair', 'exterior'],
      'grounds': ['landscape', 'tree', 'lawn', 'grass', 'irrigation', 'sprinkler', 'fence', 'yard', 'gate', 'overgrown'],
      'pests': ['ant', 'roach', 'cockroach', 'mouse', 'mice', 'rat', 'pest', 'bug', 'termite', 'spider', 'bee', 'wasp', 'rodent', 'flea', 'infestation', 'exterminator'],
      'carpet and flooring': ['carpet', 'rug', 'floor', 'tile', 'hardwood', 'laminate', 'vinyl', 'subfloor'],
      'pool': ['pool', 'hot tub', 'spa', 'jacuzzi'],
      'common area': ['common area', 'hallway', 'lobby', 'shared space'],
      'mitigation': ['mold', 'mildew', 'asbestos', 'lead paint', 'water damage'],
      'management': ['neighbor', 'noise complaint', 'speak to management', 'policy question']
    };

    for (const [catName, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(kw => desc.includes(kw))) {
        matchedCategory = { name: catName, id: taxonomy.categories[catName]?.id };
        break;
      }
    }
  }

  // Match symptom — includes synonym expansion for common voice descriptions
  // ORDERED most-severe/specific first so e.g. "severe leaking" matches before "leaking"
  const symptomSynonymsList = [
    ['severe leaking', ['severe leak', 'major leak', 'huge leak', 'pouring out', 'gushing', 'spraying water', 'water pouring']],
    ['moderate leaking', ['moderate leak', 'steady leak', 'constant drip']],
    ['flooding', ['flood', 'flooding', 'flooded', 'water everywhere', 'overflowing', 'standing water', 'inches of water']],
    ['water damage', ['water damage', 'water stain', 'water spot', 'water mark', 'ceiling stain', 'bubbling paint', 'warped']],
    ['mold or mildew', ['mold', 'mildew', 'black spots', 'fungus']],
    ['leaking', ['leak', 'leaking', 'drip', 'dripping', 'drips', 'water coming out', 'water coming from', 'seeping']],
    ['clogged', ['clog', 'clogged', 'backed up', 'backing up', "won't drain", 'slow drain', 'plugged', 'drain slow']],
    ['no hot water', ['no hot water', "don't have hot water", 'cold water only', 'only cold water', 'hot water not working', 'water is cold']],
    ['no water', ['no water at all', 'water is out', 'water shut off', "water won't come on", 'no water anywhere', 'no running water']],
    ['bad water pressure', ['low water pressure', 'bad water pressure', 'no water pressure', 'weak water pressure', 'water pressure is low', 'water pressure is really low', 'water pressure is bad', 'water pressure is weak', 'pressure is low', 'pressure is weak', 'pressure is bad', 'pressure is really low', 'trickle', 'barely coming out', 'low pressure']],
    ['not flushing', ["won't flush", 'wont flush', 'not flushing', "doesn't flush", 'flush not working']],
    ['running', ['running', 'keeps running', "won't stop", 'runs constantly', 'toilet running', 'water running constantly']],
    ['not cooling', ['not cooling', "won't cool", "isn't cooling", 'isnt cooling', 'stopped cooling', 'no cool air', 'warm air', 'hot air coming out', 'no cold air', 'blowing hot', 'blowing warm', 'house is hot']],
    ['not heating', ['not heating', "won't heat", "isn't heating", 'isnt heating', 'stopped heating', 'no heat', 'cold air', 'no warm air', 'heater not working', 'furnace not working', 'blowing cold', 'house is cold']],
    ['no air', ['no air', 'no airflow', 'nothing coming out of vents', 'vents not blowing', 'no air flow']],
    ['not maintaining temperature', ["can't keep temperature", 'temperature fluctuating', "won't reach set temperature", 'not holding temp']],
    ['no power', ['no power', 'lost power', 'power is out', 'power outage', 'nothing works', 'electricity out']],
    ['tripped breaker', ['tripped breaker', 'breaker tripped', 'breaker keeps tripping', 'breaker flipped', 'breaker popped']],
    ['exposed wiring', ['exposed wire', 'exposed wires', 'exposed wiring', 'wires showing', 'bare wire']],
    ['sparking', ['spark', 'sparking', 'sparks', 'arcing', 'arc']],
    ['burning', ['burning smell', 'smells like burning', 'burnt smell', 'smoke coming from', 'smoking', 'on fire']],
    ['not turning on or off', ["won't turn on", 'wont turn on', "won't turn off", 'wont turn off', "won't shut off", "won't shut down", "won't power on", "won't power off"]],
    ['not spinning', ['not spinning', "won't spin", 'wont spin', 'drum not moving', 'not agitating', 'fan not spinning']],
    ['not locking', ['not locking', "won't lock", 'wont lock', "doesn't lock", "won't latch"]],
    ['not opening or closing', ["won't open", 'wont open', "won't close", 'wont close', 'stuck', 'jammed', "doesn't open", "doesn't close"]],
    ['not working', ['not working', "doesn't work", "won't work", 'wont work', 'stopped working', 'dead', "isn't working", 'isnt working', 'broken', 'not functioning']],
    ['broken', ['broke', 'snapped', 'cracked', 'shattered', 'busted', 'broken off']],
    ['damaged', ['damaged', 'dented', 'torn', 'ripped', 'chipped', 'scratched']],
    ['detached', ['detached', 'fell off', 'came off', 'came loose and fell', 'hanging off']],
    ['loose', ['loose', 'wobbly', 'wiggles', 'shaky', 'moves around']],
    ['missing', ['missing', 'gone', "isn't there", 'not there', 'removed']],
    ['sounds noisy', ['noisy', 'loud', 'grinding', 'banging', 'rattling', 'humming', 'buzzing', 'squealing', 'squeaking', 'clanking', 'ticking', 'popping', 'strange noise', 'weird noise', 'making noise']],
    ['smells', ['smell', 'smells', 'odor', 'stink', 'stinks', 'rotten egg', 'gas smell', 'sewer smell', 'musty']],
    ['infestation', ['infestation', 'infested', 'everywhere', 'lots of them', 'all over', 'many of them']],
    ['dirty', ['dirty', 'filthy', 'needs cleaning', 'grimy', 'stained']],
    ['upkeep', ['needs maintenance', 'upkeep', 'overgrown', 'needs trimming', 'needs mowing']],
    ['need management', ['need to speak to', 'want to talk to management', 'complaint about', 'neighbor', 'noise complaint']],
  ];

  // Back-compat: also expose as object for any other consumers
  const symptomSynonyms = Object.fromEntries(symptomSynonymsList);

  let matchedSymptom = null;
  for (const [symptomName, synonyms] of symptomSynonymsList) {
    if (synonyms.some(syn => desc.includes(syn))) {
      const symptomData = taxonomy.symptoms[symptomName];
      if (symptomData) {
        matchedSymptom = { name: symptomName, id: symptomData.id };
        break;
      }
    }
  }
  // Fallback: direct match against taxonomy symptom names
  if (!matchedSymptom) {
    for (const [symptomName, symptomData] of Object.entries(taxonomy.symptoms)) {
      if (desc.includes(symptomName.toLowerCase())) {
        matchedSymptom = { name: symptomName, id: symptomData.id };
        break;
      }
    }
  }

  // Match location — ORDERED most-specific first
  const locationSynonyms = [
    ['whole home', ['whole home', 'whole house', 'entire home', 'entire house', 'the whole', 'everywhere', 'all rooms', 'every room']],
    ['master bathroom', ['master bathroom', 'master bath', 'main bathroom', 'en suite']],
    ['laundry room', ['laundry room', 'laundry', 'utility room']],
    ['living room', ['living room', 'family room', 'den', 'great room']],
    ['front yard', ['front yard']],
    ['backyard', ['backyard', 'back yard']],
    ['upstairs', ['upstairs', 'second floor', 'upper level']],
    ['downstairs', ['downstairs', 'first floor', 'ground floor', 'main floor']],
    ['kitchen', ['kitchen']],
    ['bathroom', ['bathroom', 'restroom', 'bath room']],
    ['bedroom', ['bedroom', 'bed room']],
    ['garage', ['garage']],
    ['basement', ['basement']],
    ['attic', ['attic']],
    ['outside', ['outside', 'exterior', 'outdoor']],
  ];

  let matchedLocation = null;
  for (const [locName, synonyms] of locationSynonyms) {
    if (synonyms.some(syn => desc.includes(syn))) {
      matchedLocation = locName;
      break;
    }
  }
  // Fallback to taxonomy common locations
  if (!matchedLocation) {
    for (const loc of taxonomy.locations_common) {
      if (desc.includes(loc.toLowerCase())) {
        matchedLocation = loc;
        break;
      }
    }
  }

  return {
    category: matchedCategory?.name || 'other',
    category_id: matchedCategory?.id || taxonomy.categories.other?.id,
    item: matchedItem?.name || 'other',
    item_id: matchedItem?.id || null,
    symptom: matchedSymptom?.name || 'other',
    symptom_id: matchedSymptom?.id || null,
    location: matchedLocation || null,
    component: null,
    raw_description: description
  };
}

const classifyAndEvaluateTool = {
  name: 'classify_and_evaluate',
  description: `Classify the maintenance issue into Mynd's taxonomy (category, item, symptom, location). Also returns property context signals (outdoor temp, state, bathroom count) so you can evaluate emergency status using the criteria in your instructions. YOU determine the priority — this tool does not make emergency decisions.`,
  input_schema: {
    type: 'object',
    properties: {
      issue_description: {
        type: 'string',
        description: 'The resident\'s description of their maintenance issue'
      },
      property_context: {
        type: 'object',
        description: 'Property context from lookup_property (pass the full result for temp/state/bathroom data)'
      }
    },
    required: ['issue_description']
  }
};

module.exports = { classifyAndEvaluate, classifyAndEvaluateTool };
