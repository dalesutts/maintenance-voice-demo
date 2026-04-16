/**
 * Route the caller to another department/operator and end the call.
 *
 * Used for:
 *  - status_update      → Caller wants an update on an existing SR. We don't
 *                         support that here; we can route them to an operator.
 *  - other_department   → Non-maintenance property-management inquiry
 *                         (rent, lease, renewal, move-out, etc.).
 *  - out_of_scope       → Not a property-management call at all. We can't help;
 *                         end the call politely.
 *
 * This tool returns a signal (`end_call: true`) that the WebSocket layer uses
 * to tell Retell to hang up after Claude's spoken message is delivered.
 */
function routeAndEnd({ reason, department, caller_intent }) {
  const validReasons = ['status_update', 'other_department', 'out_of_scope'];
  if (!validReasons.includes(reason)) {
    return { error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` };
  }

  const departmentMap = {
    status_update: 'Maintenance Operator',
    other_department: department || 'the appropriate team',
    out_of_scope: null,
  };

  return {
    routed: reason !== 'out_of_scope',
    reason,
    department: departmentMap[reason],
    caller_intent: caller_intent || null,
    end_call: true,
    note: reason === 'out_of_scope'
      ? 'Politely decline and end the call. We do not transfer non-property-management calls.'
      : 'Tell the caller you are transferring them now, then end the call.',
  };
}

const routeAndEndTool = {
  name: 'route_and_end_call',
  description: `Route the caller to another team and end this call. Use ONLY after the caller has confirmed they want to be transferred (or, for out_of_scope, after you explain we can't help). Use for:
- status_update: caller wants an update on an existing maintenance request
- other_department: non-maintenance property-management question (rent, lease, renewal, move-in/out, payments, HOA, policies)
- out_of_scope: not a property-management call at all (wrong number, sales, unrelated inquiry)

Never call this for a legitimate maintenance issue — handle those yourself through the full intake flow.`,
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['status_update', 'other_department', 'out_of_scope'],
        description: 'Why the call is being routed/ended.'
      },
      department: {
        type: 'string',
        description: 'For other_department: the team name (e.g., "Leasing", "Resident Services", "Accounting"). Omit for status_update or out_of_scope.'
      },
      caller_intent: {
        type: 'string',
        description: 'Brief description of what the caller actually wanted, for the transfer note.'
      }
    },
    required: ['reason']
  }
};

module.exports = { routeAndEnd, routeAndEndTool };
