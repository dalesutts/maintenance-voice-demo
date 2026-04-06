const { classifyAndEvaluate } = require('../src/tools/classify-and-evaluate');

describe('Taxonomy Classification', () => {
  describe('Item matching', () => {
    const cases = [
      // [description, expected item]
      ['My kitchen faucet is dripping', 'faucet'],
      ['The AC stopped working', 'air conditioner'],
      ['My air conditioner isnt cooling', 'air conditioner'],
      ['The toilet wont flush', 'toilet'],
      ['Garbage disposal is jammed', 'garbage disposal'],
      ['Water heater is leaking', 'water heater'],
      ['The dishwasher wont drain', 'dishwasher'],
      ['My refrigerator stopped cooling', 'refrigerator'],
      ['The garage door wont open', 'garage door'],
      ['Washing machine is making loud noises', 'washing machine'],
      ['The dryer isnt heating', 'clothes dryer'],
      ['Smoke alarm keeps beeping', 'smoke alarm'],
      ['Front door lock is broken', 'lock and keys'],
      ['The thermostat isnt responding', 'thermostat'],
      ['Oven wont turn on', 'oven'],
      ['The window wont close', 'window'],
      ['Shower is leaking', 'tub or shower'],
      ['Kitchen sink is clogged', 'sink'],
      ['Ceiling fan is wobbling', 'ceiling fan'],
      ['The heater stopped working', 'heating system'],
    ];

    test.each(cases)('"%s" → item: %s', (description, expectedItem) => {
      const result = classifyAndEvaluate({ issue_description: description });
      expect(result.taxonomy.item).toBe(expectedItem);
    });
  });

  describe('Category matching', () => {
    const cases = [
      ['Kitchen faucet dripping', 'plumbing'],
      ['AC stopped working', 'heating and cooling'],
      ['The outlet is sparking', 'electrical and equipment'],
      ['Refrigerator not cooling', 'appliances'],
      ['Front door wont lock', 'doors and windows'],
      ['Ants in the kitchen', 'pests'],
      ['Carpet is stained', 'carpet and flooring'],
    ];

    test.each(cases)('"%s" → category: %s', (description, expectedCategory) => {
      const result = classifyAndEvaluate({ issue_description: description });
      expect(result.taxonomy.category).toBe(expectedCategory);
    });
  });

  describe('Symptom matching', () => {
    const cases = [
      ['Faucet is dripping', 'leaking'],
      ['Water dripping from the ceiling', 'leaking'],
      ['Toilet is clogged', 'clogged'],
      ['Drain backed up', 'clogged'],
      ['AC isnt cooling', 'not cooling'],
      ['Heater stopped heating', 'not heating'],
      ['Garbage disposal making grinding noise', 'sounds noisy'],
      ['Door wont open', 'not opening or closing'],
      ['Smoke detector wont turn on', 'not working'],
      ['I smell gas', 'smells'],
      ['Toilet keeps running', 'running'],
      ['Basement is flooding', 'flooding'],
      ['Outlet is sparking', 'sparking'],
    ];

    test.each(cases)('"%s" → symptom: %s', (description, expectedSymptom) => {
      const result = classifyAndEvaluate({ issue_description: description });
      expect(result.taxonomy.symptom).toBe(expectedSymptom);
    });
  });

  describe('Location matching', () => {
    const cases = [
      ['Kitchen faucet leaking', 'kitchen'],
      ['Bathroom toilet clogged', 'bathroom'],
      ['Master bathroom shower leaking', 'master bathroom'],
      ['AC not cooling the whole house', 'whole home'],
      ['The entire home has no heat', 'whole home'],
      ['Garage door wont open', 'garage'],
      ['Basement is flooding', 'basement'],
      ['Backyard fence is broken', 'backyard'],
      ['Upstairs bathroom sink leaking', 'upstairs'],
    ];

    test.each(cases)('"%s" → location: %s', (description, expectedLocation) => {
      const result = classifyAndEvaluate({ issue_description: description });
      expect(result.taxonomy.location).toBe(expectedLocation);
    });
  });
});

describe('Property Signals', () => {
  test('passes through ambient conditions from property context', () => {
    const result = classifyAndEvaluate({
      issue_description: 'AC not working',
      property_context: {
        ambient_conditions: { current_outdoor_temp_f: 98 },
        property: { state: 'AZ' },
        unit: { full_bathrooms: 2 },
      }
    });
    expect(result.property_signals.outdoor_temp_f).toBe(98);
    expect(result.property_signals.state).toBe('AZ');
    expect(result.property_signals.bathrooms).toBe(2);
  });

  test('handles missing property context gracefully', () => {
    const result = classifyAndEvaluate({ issue_description: 'AC not working' });
    expect(result.property_signals.outdoor_temp_f).toBeNull();
    expect(result.property_signals.state).toBeNull();
  });
});
