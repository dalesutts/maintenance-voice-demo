const { classifyAndEvaluate } = require('../src/tools/classify-and-evaluate');

/**
 * Coverage across the full Mynd taxonomy (not just the core test scenarios).
 * Guards against regressions as synonym lists evolve.
 */
describe('Varied issue classification across Mynd taxonomy', () => {
  describe('Plumbing beyond faucets', () => {
    const cases = [
      ['my toilet wont flush',                       'plumbing', 'toilet',        'not flushing'],
      ['sewer smell in the bathroom',                'plumbing', 'sewer',         'smells'],
      ['sump pump stopped working',                  'plumbing', 'sump pump',     'not working'],
      ['septic tank is backing up',                  'plumbing', 'septic system', 'clogged'],
      ['no hot water anywhere in the house',         'plumbing', null,            'no hot water'],
      ['water pressure is really low',               'plumbing', null,            'bad water pressure'],
      ['water heater is leaking in the garage',      'plumbing', 'water heater',  'leaking'],
      ['burst pipe in the wall',                     'plumbing', 'pipe',          null],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('HVAC beyond AC', () => {
    const cases = [
      ['vents not blowing any air',           'heating and cooling', 'vents or ducts', 'no air'],
      ['thermostat screen is blank',          'heating and cooling', 'thermostat',     null],
      ['furnace is blowing cold air',         'heating and cooling', 'heating system', 'not heating'],
      ['fireplace wont light',                'heating and cooling', 'fireplace',      null],
      ['swamp cooler is broken',              'heating and cooling', 'swamp cooler',   null],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Electrical beyond outlets', () => {
    const cases = [
      ['breaker keeps tripping',             'electrical and equipment', 'power',       'tripped breaker'],
      ['no power in the kitchen',            'electrical and equipment', 'power',       null],
      ['wifi router isnt working',           'electrical and equipment', 'internet',    'not working'],
      ['exhaust fan in the bathroom wont turn on', 'electrical and equipment', 'ventilation fan', null],
      ['light switch is loose',              'electrical and equipment', 'switch',      'loose'],
      ['exposed wires in the garage',        'electrical and equipment', null,          'exposed wiring'],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Appliances beyond fridge/dishwasher', () => {
    const cases = [
      ['ring doorbell stopped working',      'appliances', 'doorbell',      'not working'],
      ['alarm system keeps going off',       'appliances', 'alarm system',  null],
      ['ice maker is broken',                'appliances', 'refrigerator',  'not working'],
      ['dryer wont spin',                    'appliances', 'clothes dryer', 'not spinning'],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Doors, windows, interior surfaces', () => {
    const cases = [
      ['blinds fell off in the bedroom',     'doors and windows', 'blinds and shades', 'detached'],
      ['mailbox is damaged',                 'doors and windows', 'mailbox',           'damaged'],
      ['countertop is chipped',              'interior',          'countertop',        'damaged'],
      ['handrail on the stairs is loose',    'interior',          'stair handrail',    'loose'],
      ['cabinet door fell off',              'interior',          'cabinet',           'detached'],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Exterior and grounds', () => {
    const cases = [
      ['gutter detached from the house',       'exterior', 'gutter',       'detached'],
      ['roof is leaking',                      'exterior', 'roof',         'leaking'],
      ['sprinkler system wont turn on',        'grounds',  'irrigation',   'not turning on or off'],
      ['fence is broken in the backyard',      'exterior', 'fence',        null],
      ['gate wont latch',                      'grounds',  'gate',         null],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Pests', () => {
    const cases = [
      ['ants all over the kitchen',    'pests', 'insects',          'infestation'],
      ['mice in the attic',            'pests', 'rodents or birds', null],
      ['termite damage in the garage', 'pests', 'termites',         null],
      ['bees nesting in the backyard', 'pests', 'insects',          null],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Mitigation and pool', () => {
    const cases = [
      ['mold in the master bathroom',  'mitigation', null,   'mold or mildew'],
      ['water damage on the ceiling',  'interior',   'ceiling', 'water damage'],
      ['pool pump stopped working',    'pool',       'pool', 'not working'],
    ];
    test.each(cases)('"%s" -> %s / %s / %s', (desc, cat, item, sym) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.category).toBe(cat);
      if (item) expect(r.item).toBe(item);
      if (sym) expect(r.symptom).toBe(sym);
    });
  });

  describe('Severity-aware symptom matching', () => {
    const cases = [
      ['water is pouring out of the ceiling',  'severe leaking'],
      ['water is gushing from the pipe',       'severe leaking'],
      ['faucet has a steady drip',             'leaking'],
      ['flooded basement',                     'flooding'],
      ['burning smell from the dryer',         'burning'],
      ['no water at all in the house',         'no water'],
      ['breaker popped again',                 'tripped breaker'],
    ];
    test.each(cases)('"%s" -> symptom: %s', (desc, expected) => {
      const r = classifyAndEvaluate({ issue_description: desc }).taxonomy;
      expect(r.symptom).toBe(expected);
    });
  });
});
