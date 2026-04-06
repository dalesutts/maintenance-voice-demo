const properties = require('../mocks/properties.json');

/**
 * Look up property and resident context by name/address.
 * In production, this would call the Otto/Mynd API.
 * For PoC, returns mock data.
 */
function lookupProperty({ resident_name, property_address }) {
  // For the PoC, check if the name/address roughly matches our mock resident
  const resident = properties.residents.default;
  const nameMatch = resident_name?.toLowerCase().includes('sarah') ||
                    resident_name?.toLowerCase().includes('johnson');
  const addressMatch = property_address?.toLowerCase().includes('oak valley') ||
                       property_address?.toLowerCase().includes('1247');

  if (!nameMatch && !addressMatch) {
    return {
      found: false,
      message: `No account found for "${resident_name}" at "${property_address || 'unknown address'}". Please verify the name and address on the lease.`
    };
  }

  return {
    found: true,
    resident_id: resident.resident_id,
    resident_name: resident.name,
    property: {
      property_id: resident.property.property_id,
      address: resident.property.address,
      city: resident.property.city,
      state: resident.property.state,
      zip: resident.property.zip,
      type: resident.property.property_type,
      year_built: resident.property.year_built,
      has_hoa: resident.property.has_hoa,
      building_access: resident.property.building_access
    },
    unit: {
      bedrooms: resident.unit.bedrooms,
      full_bathrooms: resident.unit.full_bathrooms,
      half_bathrooms: resident.unit.half_bathrooms,
      square_footage: resident.unit.square_footage
    },
    lease: resident.lease,
    ambient_conditions: resident.ambient_conditions,
    open_service_requests: resident.open_service_requests || [],
    recent_service_requests: resident.recent_service_requests || []
  };
}

// Tool definition for Claude
const lookupPropertyTool = {
  name: 'lookup_property',
  description: 'Look up resident and property information by name or address. Returns property details, appliance inventory, ambient conditions, and service request history. Call this at the start of every conversation to get context.',
  input_schema: {
    type: 'object',
    properties: {
      resident_name: {
        type: 'string',
        description: 'The resident\'s name as they provided it'
      },
      property_address: {
        type: 'string',
        description: 'The property address as the resident described it'
      }
    },
    required: ['resident_name']
  }
};

module.exports = { lookupProperty, lookupPropertyTool };
