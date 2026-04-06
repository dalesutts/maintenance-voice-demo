/**
 * Structure resident's verbal availability into standard scheduling windows.
 * Applies emergency-aware scheduling rules:
 *   - Emergency: same-day or next-day
 *   - Urgent: next-day or day after
 *   - Standard: 2+ days out
 *   - Low: 3+ days out, flexible
 */
function collectAvailability({ verbal_availability, priority, preferred_date }) {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat

  let scheduledDate;
  let window;

  // Check if resident explicitly said "today"
  const wantsToday = verbal_availability?.toLowerCase().includes('today');
  const wantsTomorrow = verbal_availability?.toLowerCase().includes('tomorrow');

  // Determine date based on priority + resident preference
  switch (priority) {
    case 'Emergency':
      scheduledDate = wantsTomorrow ? getNextBusinessDay(today, 1) : today;
      window = wantsToday ? 'Today (ASAP)' : (parseWindow(verbal_availability) || 'ASAP');
      break;

    case 'Urgent':
      if (wantsToday) {
        scheduledDate = today;
        window = 'Today (ASAP)';
      } else {
        scheduledDate = wantsTomorrow ? getNextBusinessDay(today, 1) : getNextBusinessDay(today, 1);
        window = parseWindow(verbal_availability) || 'Morning (8:00 AM - 12:00 PM)';
      }
      break;

    case 'Standard':
    default:
      if (wantsToday) {
        scheduledDate = today;
        window = 'Today (requested)';
      } else if (wantsTomorrow) {
        scheduledDate = getNextBusinessDay(today, 1);
        window = parseWindow(verbal_availability) || 'Any time';
      } else if (preferred_date) {
        scheduledDate = new Date(preferred_date);
        window = parseWindow(verbal_availability) || 'Morning (8:00 AM - 12:00 PM)';
      } else {
        scheduledDate = getNextBusinessDay(today, 2);
        window = parseWindow(verbal_availability) || 'Morning (8:00 AM - 12:00 PM)';
      }
      break;

    case 'Low':
      scheduledDate = getNextBusinessDay(today, 3);
      window = parseWindow(verbal_availability) || 'Afternoon (1:00 PM - 5:00 PM)';
      break;
  }

  const formattedDate = formatDate(scheduledDate);

  return {
    scheduled_date: formattedDate,
    time_window: window,
    priority: priority,
    raw_input: verbal_availability,
    confirmation_text: wantsToday
      ? `We'll try to get that scheduled for today. The vendor will reach out to confirm.`
      : priority === 'Emergency'
        ? `We'll work on getting someone out as soon as possible. The vendor will reach out to schedule.`
        : `We'll get that scheduled for ${formattedDate}, ${window.toLowerCase()}. The vendor will reach out to confirm.`
  };
}

function parseWindow(verbal) {
  if (!verbal) return null;
  const v = verbal.toLowerCase();

  if (v.includes('morning') || v.includes('8') || v.includes('am')) {
    return 'Morning (8:00 AM - 12:00 PM)';
  }
  if (v.includes('afternoon') || v.includes('1') || v.includes('pm')) {
    return 'Afternoon (1:00 PM - 5:00 PM)';
  }
  if (v.includes('any') || v.includes('either') || v.includes('flexible') || v.includes('don\'t care')) {
    return 'Any time (8:00 AM - 5:00 PM)';
  }

  return null;
}

function getNextBusinessDay(fromDate, daysAhead) {
  const date = new Date(fromDate);
  let added = 0;
  while (added < daysAhead) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) { // Skip weekends
      added++;
    }
  }
  return date;
}

function formatDate(date) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

const collectAvailabilityTool = {
  name: 'collect_availability',
  description: 'Structure the resident\'s verbal availability into a scheduled appointment window. Applies priority-based scheduling: emergencies get same-day/next-day, standard issues get 2+ days out. Returns the scheduled date, time window, and a confirmation message to read to the resident.',
  input_schema: {
    type: 'object',
    properties: {
      verbal_availability: {
        type: 'string',
        description: 'What the resident said about their availability (e.g., "morning works", "anytime Tuesday", "I\'m flexible")'
      },
      priority: {
        type: 'string',
        enum: ['Emergency', 'Urgent', 'Standard', 'Low'],
        description: 'Priority level from the classify_and_evaluate result'
      },
      preferred_date: {
        type: 'string',
        description: 'Specific date the resident mentioned, if any (YYYY-MM-DD format)'
      }
    },
    required: ['verbal_availability', 'priority']
  }
};

module.exports = { collectAvailability, collectAvailabilityTool };
