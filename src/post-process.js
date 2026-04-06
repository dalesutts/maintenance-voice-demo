/**
 * Post-processing layer for Claude responses before sending to Retell TTS.
 * Catches issues that prompt engineering alone can't reliably prevent.
 */

/**
 * Clean a response before it's spoken by TTS.
 * Strips special characters, jargon, and enforces voice-friendly formatting.
 */
function cleanForVoice(text) {
  if (!text) return text;

  let cleaned = text;

  // 1. Strip markdown/special characters that TTS would verbalize
  cleaned = cleaned.replace(/\*+/g, '');           // asterisks
  cleaned = cleaned.replace(/^[-•]\s*/gm, '');     // bullet points
  cleaned = cleaned.replace(/^#+\s*/gm, '');       // markdown headers
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');   // inline code
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // markdown links
  cleaned = cleaned.replace(/_{2,}/g, '');          // underscores used for emphasis
  cleaned = cleaned.replace(/~{2,}/g, '');          // strikethrough
  cleaned = cleaned.replace(/>/g, '');              // blockquotes

  // 2. Replace internal jargon with resident-friendly language
  const jargonReplacements = [
    [/\bstandard (priority|repair|issue|maintenance)\b/gi, 'maintenance issue'],
    [/\bclassif(y|ied|ying|ication)\b/gi, ''],
    [/\bcategoriz(e|ed|ing|ation)\b/gi, ''],
    [/\btaxonomy\b/gi, ''],
    [/\btriage[d]?\b/gi, ''],
    [/\bpriority level\b/gi, ''],
    [/\bescalat(e|ed|ing)\b/gi, 'prioritize'],
    [/\bservice request\b/gi, 'request'],
    [/\bwork order\b/gi, 'request'],
    [/\bSR\b/g, 'request'],                       // but keep SR-2026-xxxxx IDs
    [/\bWO\b/g, 'request'],
  ];

  for (const [pattern, replacement] of jargonReplacements) {
    // Don't replace if it's part of an SR ID (SR-2026-xxxxx)
    cleaned = cleaned.replace(pattern, (match, ...args) => {
      const fullStr = args[args.length - 1]; // last arg is full string
      const offset = args[args.length - 2];  // second to last is offset
      // Check if this "SR" is part of an ID like SR-2026-12345
      if (match === 'SR' && fullStr.substring(offset, offset + 8).match(/^SR-\d{4}/)) {
        return match;
      }
      return replacement;
    });
  }

  // 3. Remove meta-commentary about what the bot is doing
  const metaPatterns = [
    /let me (classify|categorize|triage|process|log|record) (this|that|your issue)[^.]*\./gi,
    /I('m| am) (going to |about to )?(classify|categorize|create a ticket|submit|file|log)[^.]*\./gi,
    /I('ll| will) (now )?(classify|categorize|create|file|submit|log) (this|that|your|a)[^.]*\./gi,
    /since (the water|it|this|your)[^,]*, (we can|I can|let me)[^.]*\./gi, // Remove reasoning explanations
  ];

  for (const pattern of metaPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // 4. Clean up whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ');       // collapse multiple spaces
  cleaned = cleaned.replace(/\.\s*\./g, '.');      // collapse double periods
  cleaned = cleaned.replace(/^\s+|\s+$/g, '');     // trim

  // 5. Ensure response isn't empty after cleaning
  if (!cleaned.trim()) {
    return null; // Signal to caller that nothing should be spoken
  }

  return cleaned;
}

/**
 * Enforce maximum sentence count for voice responses.
 * Keeps only the first N sentences.
 */
function enforceBrevity(text, maxSentences = 3) {
  if (!text) return text;

  // Split on sentence boundaries (period, exclamation, question mark followed by space or end)
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length <= maxSentences) return text;

  return sentences.slice(0, maxSentences).join(' ').trim();
}

module.exports = { cleanForVoice, enforceBrevity };
