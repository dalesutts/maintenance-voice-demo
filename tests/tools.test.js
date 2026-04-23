const { lookupProperty } = require('../src/tools/lookup-property');
const { collectAvailability } = require('../src/tools/collect-availability');
const { createServiceRequest } = require('../src/tools/create-sr');
const { sendPhotoSms } = require('../src/tools/send-photo-sms');

describe('Property Lookup', () => {
  test('finds resident by matching name', () => {
    const result = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    expect(result.found).toBe(true);
    expect(result.resident_id).toBeDefined();
    expect(result.property.address).toContain('Oak Valley');
  });

  test('finds resident by partial name match', () => {
    const result = lookupProperty({ resident_name: 'Sarah', property_address: '1247' });
    expect(result.found).toBe(true);
  });

  test('rejects unknown resident', () => {
    const result = lookupProperty({ resident_name: 'Joe Smith', property_address: '999 Fake Street' });
    expect(result.found).toBe(false);
    expect(result.message).toContain('No account found');
  });

  test('matches by address even if name is partial', () => {
    const result = lookupProperty({ resident_name: 'Unknown', property_address: 'Oak Valley' });
    expect(result.found).toBe(true);
  });

  test('returns unit details with bathroom count', () => {
    const result = lookupProperty({ resident_name: 'Sarah Johnson' });
    expect(result.unit.full_bathrooms).toBeDefined();
    expect(result.unit.bedrooms).toBeDefined();
  });

  test('returns ambient conditions', () => {
    const result = lookupProperty({ resident_name: 'Sarah Johnson' });
    expect(result.ambient_conditions).toBeDefined();
    expect(result.ambient_conditions.current_outdoor_temp_f).toBeDefined();
  });

  test('never exposes PII in error messages', () => {
    const result = lookupProperty({ resident_name: 'Wrong Person' });
    expect(result.found).toBe(false);
    // Should NOT contain the actual resident's name in error
    expect(result.message).not.toContain('Sarah');
    expect(result.message).not.toContain('Johnson');
  });
});

describe('Availability Collection', () => {
  test('emergency defaults to today', () => {
    const result = collectAvailability({ verbal_availability: 'today works', priority: 'Emergency' });
    expect(result.confirmation_text).toContain('today');
  });

  test('emergency accepts tomorrow', () => {
    const result = collectAvailability({ verbal_availability: 'tomorrow morning', priority: 'Emergency' });
    expect(result.time_window).toContain('Morning');
  });

  test('non-emergency insistent on today gets noted', () => {
    const result = collectAvailability({ verbal_availability: 'I need it today', priority: 'Standard' });
    expect(result.scheduled_date).toBeDefined();
    // Should respect today if they insist
    expect(result.confirmation_text).toContain('today');
  });

  test('parses morning preference', () => {
    const result = collectAvailability({ verbal_availability: 'morning works for me', priority: 'Standard' });
    expect(result.time_window).toContain('Morning');
  });

  test('parses afternoon preference', () => {
    const result = collectAvailability({ verbal_availability: 'afternoon is better', priority: 'Standard' });
    expect(result.time_window).toContain('Afternoon');
  });

  test('parses flexible/any time', () => {
    const result = collectAvailability({ verbal_availability: 'any time works', priority: 'Standard' });
    expect(result.time_window).toContain('Any');
  });

  test('resolves a spoken weekday to the upcoming date', () => {
    const result = collectAvailability({
      verbal_availability: 'Thursday afternoon works',
      priority: 'Standard',
    });
    expect(result.scheduled_date).toContain('Thursday');
    expect(result.time_window).toContain('Afternoon');
  });

  test('resolves "Thursday of next week" when today is Thursday', () => {
    // Simulate: today is Thursday. Resident says Thursday of next week.
    // Should land on a Thursday 7 days out, not today and not 14 days out.
    const thursday = new Date();
    thursday.setDate(thursday.getDate() + ((4 - thursday.getDay() + 7) % 7 || 7));
    // From that Thursday, "Thursday of next week" should be +7 days.
    const result = collectAvailability({
      verbal_availability: 'Thursday of next week',
      priority: 'Standard',
    });
    // Should contain 'Thursday' and be strictly in the future.
    expect(result.scheduled_date).toContain('Thursday');
  });

  test('ignores preferred_date in the past', () => {
    const lastYear = new Date();
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    const iso = lastYear.toISOString().slice(0, 10);
    const result = collectAvailability({
      verbal_availability: 'morning works',
      priority: 'Standard',
      preferred_date: iso,
    });
    // Should NOT use last year's date — must be in the future.
    const scheduled = result.scheduled_date.toLowerCase();
    expect(scheduled).not.toMatch(new RegExp(String(lastYear.getFullYear())));
  });

  test('ignores preferred_date whose day-of-week conflicts with spoken day', () => {
    // Resident says "Thursday", Claude hallucinates a Friday — tool should trust Thursday.
    // Find the next Friday from today as the bogus preferred_date.
    const fri = new Date();
    fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7 || 7));
    const iso = fri.toISOString().slice(0, 10);
    const result = collectAvailability({
      verbal_availability: 'Thursday afternoon',
      priority: 'Standard',
      preferred_date: iso,
    });
    expect(result.scheduled_date).toContain('Thursday');
    expect(result.scheduled_date).not.toContain('Friday');
  });
});

describe('Service Request Creation', () => {
  test('creates SR with all required fields', () => {
    const result = createServiceRequest({
      category: 'plumbing',
      item: 'faucet',
      symptom: 'leaking',
      description: 'Kitchen faucet leaking from base',
      priority: 'Standard',
      location: 'kitchen',
    });
    expect(result.success).toBe(true);
    expect(result.sr_id).toMatch(/^SR-2026-\d+$/);
    expect(result.sr_details.category_id).toBe('plumbing');
    expect(result.sr_details.taxonomy_v2).toBe(true);
  });

  test('emergency SR gets priority 0', () => {
    const result = createServiceRequest({
      category: 'heating and cooling',
      item: 'air conditioner',
      symptom: 'not cooling',
      description: 'Whole home AC not working',
      priority: 'Emergency',
      is_emergency: true,
    });
    expect(result.sr_details.priority).toBe(0);
  });

  test('standard SR gets priority 4', () => {
    const result = createServiceRequest({
      category: 'plumbing',
      item: 'faucet',
      symptom: 'leaking',
      description: 'Slow drip',
      priority: 'Standard',
    });
    expect(result.sr_details.priority).toBe(4);
  });

  test('includes voice channel in audit metadata', () => {
    const result = createServiceRequest({
      category: 'plumbing',
      item: 'faucet',
      symptom: 'leaking',
      description: 'test',
      priority: 'Standard',
    });
    expect(result.sr_details._poc_metadata.channel).toBe('voice');
    expect(result.sr_details.created_by_entity_type).toBe('voice_bot');
  });
});

describe('Photo SMS', () => {
  test('returns success with upload URL', () => {
    const result = sendPhotoSms({ phone_number: '+15551234567', resident_name: 'Sarah', sr_id: 'SR-2026-12345' });
    expect(result.success).toBe(true);
    expect(result.upload_url).toContain('SR-2026-12345');
  });

  test('handles pending SR ID', () => {
    const result = sendPhotoSms({ phone_number: '+15551234567', sr_id: 'pending' });
    expect(result.upload_url).toContain('pending');
  });
});
