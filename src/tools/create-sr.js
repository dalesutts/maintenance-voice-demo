/**
 * Create a Service Request with all collected intake data.
 * In production, this calls the Otto SR creation API.
 * For PoC, returns a mock SR with realistic structure.
 */
function createServiceRequest({
  resident_id,
  property_id,
  category,
  item,
  symptom,
  location,
  component,
  description,
  priority,
  is_emergency,
  scheduled_date,
  time_window,
  media_requested,
  troubleshooting_notes
}) {
  // Generate a realistic SR ID
  const srNumber = Math.floor(Math.random() * 90000) + 10000;
  const srId = `SR-2026-${srNumber}`;

  // Map priority to Mynd numeric format (0=Emergency, 1-2=Urgent, 3-4=Standard)
  const priorityMap = { 'Emergency': 0, 'Urgent': 2, 'Standard': 4, 'Low': 4 };
  const numericPriority = priorityMap[priority] ?? 4;

  // Build availability in Mynd's JSON format
  const availabilityWindows = buildAvailabilityWindows(scheduled_date, time_window);

  const sr = {
    // Matches actual Mynd SERVICE_REQUESTS table structure
    service_request_id: `mock_${Date.now()}`,
    external_id: srNumber.toString(),
    description: description,
    status: 1, // Open
    priority: numericPriority,
    type: 1, // Standard maintenance
    origin: 4, // Voice (proposed for PoC)
    taxonomy_v2: true,
    category_id: category,
    item_id: item,
    symptom_id: symptom,
    location: location,
    component: component || null,
    resident_availability: JSON.stringify(availabilityWindows),
    resident_available_any_time: time_window?.includes('Any time') || false,
    permission_to_enter: true,
    created_at: new Date().toISOString(),
    // Audit fields
    created_by_entity_type: 'voice_bot',
    special_instructions: troubleshooting_notes || null,
    // PoC tracking
    _poc_metadata: {
      sr_display_id: srId,
      channel: 'voice',
      conversation_id: `CALL-${Date.now()}`,
      is_emergency: is_emergency || false,
      media_requested: media_requested || true,
      original_priority_label: priority
    }
  };

  console.log('[SR CREATED]', JSON.stringify(sr, null, 2));

  return {
    success: true,
    sr_id: srId,
    message: `Service request ${srId} created successfully`,
    next_steps: 'A maintenance coordinator will review and confirm the technician visit.',
    sr_details: sr
  };
}

const createServiceRequestTool = {
  name: 'create_service_request',
  description: 'Create a maintenance service request with all collected data. Call this after collecting the issue description, classification, availability, and requesting photos. Do NOT ask the resident for permission — just create the SR and confirm with the reference number.',
  input_schema: {
    type: 'object',
    properties: {
      resident_id: { type: 'string', description: 'Resident ID from property lookup' },
      property_id: { type: 'string', description: 'Property ID from property lookup' },
      category: { type: 'string', description: 'Taxonomy category (e.g., Plumbing, HVAC)' },
      item: { type: 'string', description: 'Taxonomy item (e.g., Faucet, Air Conditioning)' },
      symptom: { type: 'string', description: 'Taxonomy symptom (e.g., Leaking, Not Cooling)' },
      location: { type: 'string', description: 'Location in the property (e.g., Kitchen, Master Bathroom)' },
      component: { type: 'string', description: 'Specific component if identified (e.g., Cartridge, Filter)' },
      description: { type: 'string', description: 'Full issue description in the resident\'s words' },
      priority: { type: 'string', enum: ['Emergency', 'Urgent', 'Standard', 'Low'] },
      is_emergency: { type: 'boolean' },
      scheduled_date: { type: 'string', description: 'Scheduled visit date' },
      time_window: { type: 'string', description: 'Scheduled time window' },
      media_requested: { type: 'boolean', description: 'Whether photos were requested via SMS' },
      troubleshooting_notes: { type: 'string', description: 'Any troubleshooting attempted during the call' }
    },
    required: ['category', 'item', 'symptom', 'description', 'priority']
  }
};

/**
 * Build availability windows in Mynd's JSON format:
 * [{"date":"2026-04-07","timeFrom":8,"timeTo":12}, ...]
 */
function buildAvailabilityWindows(scheduledDate, timeWindow) {
  const today = new Date();
  // Default to 2 days out if no date specified
  const baseDate = scheduledDate ? new Date(scheduledDate) : new Date(today.setDate(today.getDate() + 2));

  const dateStr = baseDate.toISOString().split('T')[0];

  if (!timeWindow || timeWindow.includes('Any time') || timeWindow.includes('ASAP')) {
    return [{ date: dateStr, timeFrom: 8, timeTo: 17 }];
  }
  if (timeWindow.includes('Morning') || timeWindow.includes('morning')) {
    return [{ date: dateStr, timeFrom: 8, timeTo: 12 }];
  }
  if (timeWindow.includes('Afternoon') || timeWindow.includes('afternoon')) {
    return [{ date: dateStr, timeFrom: 13, timeTo: 17 }];
  }
  return [{ date: dateStr, timeFrom: 8, timeTo: 17 }];
}

module.exports = { createServiceRequest, createServiceRequestTool };
