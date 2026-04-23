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
  today.setHours(0, 0, 0, 0); // normalize for date comparisons

  let scheduledDate;
  let window;

  // Check if resident explicitly said "today"
  const wantsToday = verbal_availability?.toLowerCase().includes('today');
  const wantsTomorrow = verbal_availability?.toLowerCase().includes('tomorrow');

  // Resolve a spoken day name ("Thursday", "next Monday") to an actual date.
  // This is our source of truth when the resident names a weekday — we do NOT
  // trust a preferred_date that conflicts with what they said.
  const spokenDay = resolveSpokenDay(verbal_availability, today);

  // Resolved preferred date as a Date object (local time, no TZ round-trip).
  let resolvedPreferredDate = null;

  // Guard: ignore preferred_date if it's in the past or earlier than today.
  // Claude has been known to hallucinate past dates when computing "next week".
  if (preferred_date) {
    // Parse YYYY-MM-DD as local time, not UTC, to avoid day shifts.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(preferred_date));
    const pd = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(preferred_date);
    if (isNaN(pd.getTime()) || pd < today) {
      resolvedPreferredDate = null;
    } else if (spokenDay && pd.getDay() !== spokenDay.getDay()) {
      // Resident said a day name that doesn't match the passed date — trust the spoken day.
      resolvedPreferredDate = null;
    } else {
      resolvedPreferredDate = pd;
    }
  }

  // If the resident named a weekday, that takes precedence for Standard/Low.
  if (spokenDay && !wantsToday && !wantsTomorrow && !resolvedPreferredDate) {
    resolvedPreferredDate = spokenDay;
  }

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
      } else if (resolvedPreferredDate) {
        scheduledDate = resolvedPreferredDate;
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

/**
 * Resolve a verbal weekday reference ("Thursday", "next Monday", "this Friday")
 * into a concrete Date >= today. Returns null if no weekday is mentioned.
 *
 * Rules:
 *   - "Thursday" alone → the NEXT Thursday that is strictly in the future (today if
 *     it's already Thursday is skipped — residents saying a day name without "today"
 *     always mean the upcoming one).
 *   - "next Thursday" → one week further out from the base resolution.
 *   - If the base day is today and "next" is absent, still push to next week since
 *     residents typically mean the upcoming occurrence.
 */
function resolveSpokenDay(verbal, today) {
  if (!verbal) return null;
  const v = verbal.toLowerCase();
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let dayIdx = -1;
  for (let i = 0; i < dayNames.length; i++) {
    if (new RegExp('\\b' + dayNames[i] + '\\b').test(v)) {
      dayIdx = i;
      break;
    }
  }
  if (dayIdx === -1) return null;

  const target = new Date(today);
  const currentDay = today.getDay();
  const saidNext = /\bnext\b/.test(v);
  let diff = dayIdx - currentDay;
  if (diff < 0) {
    diff += 7; // e.g. today Fri, said Tue → next Tue is 4 days out
  } else if (diff === 0) {
    diff = 7; // today IS the named day → resident means next week's occurrence
  } else if (saidNext) {
    // Same week has the day but resident said "next" — push another week
    diff += 7;
  }
  target.setDate(today.getDate() + diff);
  return target;
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
