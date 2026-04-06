const taxonomy = require('../mocks/taxonomy.json');

/**
 * Classify the maintenance issue into Mynd's taxonomy.
 * Emergency determination is left to Claude using the criteria in the system prompt.
 * This tool only provides taxonomy classification and contextual signals.
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
    ['water heater', ['water heater', 'hot water heater', 'hot water tank']],
    ['garbage disposal', ['garbage disposal', 'disposal', 'garbage disposer', 'disposer']],
    ['air conditioner', ['air conditioner', 'air conditioning', 'a/c', 'a.c.', ' ac ', 'ac ', ' ac', 'the ac', 'my ac', 'central air']],
    ['heating system', ['heater', 'heating system', 'furnace', 'heat pump']],
    ['thermostat', ['thermostat']],
    ['dishwasher', ['dishwasher', 'dish washer']],
    ['washing machine', ['washing machine', 'washer', 'clothes washer']],
    ['clothes dryer', ['clothes dryer', 'dryer']],
    ['refrigerator', ['refrigerator', 'fridge', 'freezer']],
    ['garage door', ['garage door']],
    ['smoke alarm', ['smoke alarm', 'smoke detector', 'fire alarm', 'fire detector']],
    ['co detector', ['co detector', 'carbon monoxide', 'co alarm']],
    ['ceiling fan', ['ceiling fan']],
    ['tub or shower', ['tub', 'shower', 'bathtub', 'bath']],
    ['toilet', ['toilet']],
    ['sink', ['sink']],
    ['faucet', ['faucet', 'tap', 'spigot']],
    ['cooktop', ['cooktop', 'cook top', 'stovetop']],
    ['stove', ['stove', 'range', 'burner']],
    ['oven', ['oven']],
    ['microwave', ['microwave']],
    ['lock and keys', ['lock', 'deadbolt', 'lockout', 'locked out', 'key']],
    ['garage door', ['garage']],
    ['door', ['door']],
    ['window', ['window']],
    ['roof', ['roof', 'roofing']],
    ['fence', ['fence', 'fencing']],
    ['gate', ['gate']],
    ['outlet', ['outlet', 'receptacle', 'electrical outlet']],
    ['lighting', ['light', 'lights', 'light fixture', 'lamp']],
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
      'plumbing': ['leak', 'water', 'drip', 'pipe', 'drain', 'flush', 'sewage', 'clog', 'faucet', 'hot water'],
      'heating and cooling': ['heat', 'cool', 'cooling', 'ac ', 'a/c', 'a.c.', 'air condition', 'air condition', 'furnace', 'hvac', 'thermostat', 'vent', 'cold air', 'warm air', 'temperature'],
      'electrical and equipment': ['electric', 'outlet', 'light', 'power', 'breaker', 'switch', 'wire', 'spark', 'fan'],
      'appliances': ['refrigerator', 'fridge', 'dishwasher', 'oven', 'stove', 'washer', 'dryer', 'microwave', 'disposal', 'range'],
      'doors and windows': ['door', 'window', 'lock', 'key', 'garage', 'blind', 'screen', 'deadbolt', 'gate'],
      'interior': ['wall', 'ceiling', 'cabinet', 'counter', 'floor', 'baseboard', 'shelf', 'closet', 'mold'],
      'exterior': ['roof', 'gutter', 'siding', 'porch', 'patio', 'deck', 'stair'],
      'grounds': ['landscape', 'tree', 'lawn', 'irrigation', 'sprinkler', 'fence', 'yard'],
      'pests': ['ant', 'roach', 'cockroach', 'mouse', 'rat', 'pest', 'bug', 'termite', 'spider', 'bee', 'wasp', 'rodent', 'flea'],
      'carpet and flooring': ['carpet', 'floor', 'tile', 'hardwood', 'laminate', 'vinyl']
    };

    for (const [catName, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(kw => desc.includes(kw))) {
        matchedCategory = { name: catName, id: taxonomy.categories[catName]?.id };
        break;
      }
    }
  }

  // Match symptom — includes synonym expansion for common voice descriptions
  const symptomSynonyms = {
    'leaking': ['leak', 'leaking', 'drip', 'dripping', 'drips', 'water coming out', 'water coming from', 'seeping'],
    'clogged': ['clog', 'clogged', 'backed up', 'backing up', 'won\'t drain', 'slow drain', 'plugged'],
    'not working': ['not working', 'doesn\'t work', 'won\'t work', 'wont work', 'stopped working', 'dead', 'won\'t turn on', 'wont turn on', 'isn\'t working', 'isnt working'],
    'broken': ['broken', 'broke', 'snapped', 'cracked', 'shattered'],
    'not cooling': ['not cooling', 'won\'t cool', 'isn\'t cooling', 'isnt cooling', 'stopped cooling', 'no cool air', 'warm air', 'hot air coming out', 'no cold air', 'blowing hot', 'blowing warm'],
    'not heating': ['not heating', 'won\'t heat', 'isn\'t heating', 'isnt heating', 'stopped heating', 'no heat', 'cold air', 'no warm air', 'heater not working', 'furnace not working', 'blowing cold'],
    'sounds noisy': ['noisy', 'loud', 'grinding', 'banging', 'rattling', 'humming', 'buzzing', 'squealing', 'squeaking'],
    'smells': ['smell', 'smells', 'odor', 'stink', 'stinks', 'rotten egg'],
    'running': ['running', 'keeps running', 'won\'t stop', 'runs constantly'],
    'flooding': ['flood', 'flooding', 'flooded', 'water everywhere', 'overflowing'],
    'not flushing': ['won\'t flush', 'not flushing', 'doesn\'t flush'],
    'sparking': ['spark', 'sparking', 'sparks', 'arcing'],
    'not opening or closing': ['won\'t open', 'wont open', 'won\'t close', 'wont close', 'stuck', 'jammed'],
  };

  let matchedSymptom = null;
  for (const [symptomName, synonyms] of Object.entries(symptomSynonyms)) {
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
