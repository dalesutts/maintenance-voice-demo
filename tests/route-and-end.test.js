const { routeAndEnd } = require('../src/tools/route-and-end');

describe('route_and_end_call tool', () => {
  test('status_update routes to Maintenance Operator and flags end_call', () => {
    const r = routeAndEnd({ reason: 'status_update', caller_intent: 'wants update on SR-12345' });
    expect(r.routed).toBe(true);
    expect(r.department).toBe('Maintenance Operator');
    expect(r.end_call).toBe(true);
    expect(r.reason).toBe('status_update');
  });

  test('other_department uses the department name provided', () => {
    const r = routeAndEnd({ reason: 'other_department', department: 'Leasing', caller_intent: 'lease renewal' });
    expect(r.routed).toBe(true);
    expect(r.department).toBe('Leasing');
    expect(r.end_call).toBe(true);
  });

  test('other_department falls back to generic label when no department given', () => {
    const r = routeAndEnd({ reason: 'other_department' });
    expect(r.department).toBe('the appropriate team');
    expect(r.end_call).toBe(true);
  });

  test('out_of_scope does not route but still ends the call', () => {
    const r = routeAndEnd({ reason: 'out_of_scope', caller_intent: 'sales pitch' });
    expect(r.routed).toBe(false);
    expect(r.department).toBe(null);
    expect(r.end_call).toBe(true);
  });

  test('rejects unknown reason values', () => {
    const r = routeAndEnd({ reason: 'frobnicate' });
    expect(r.error).toMatch(/Invalid reason/);
    expect(r.end_call).toBeUndefined();
  });

  test('includes a note guiding Claude on what to say before ending', () => {
    expect(routeAndEnd({ reason: 'status_update' }).note).toMatch(/transferring/i);
    expect(routeAndEnd({ reason: 'other_department' }).note).toMatch(/transferring/i);
    expect(routeAndEnd({ reason: 'out_of_scope' }).note).toMatch(/decline/i);
  });
});
