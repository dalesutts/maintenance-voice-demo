const { cleanForVoice, enforceBrevity } = require('../src/post-process');

describe('cleanForVoice', () => {
  test('strips asterisks', () => {
    expect(cleanForVoice('This is **important** info')).toBe('This is important info');
  });

  test('strips bullet points', () => {
    expect(cleanForVoice('- First item\n- Second item')).toBe('First item\nSecond item');
  });

  test('strips markdown headers', () => {
    expect(cleanForVoice('## Section Title')).toBe('Section Title');
  });

  test('strips inline code backticks', () => {
    expect(cleanForVoice('Run the `command` now')).toBe('Run the command now');
  });

  test('replaces "standard priority" with neutral language', () => {
    const result = cleanForVoice("This is a standard priority issue.");
    expect(result).not.toContain('standard priority');
  });

  test('replaces "standard repair" with neutral language', () => {
    const result = cleanForVoice("This is a standard repair.");
    expect(result).not.toContain('standard repair');
  });

  test('removes classify/categorize jargon', () => {
    expect(cleanForVoice("Let me classify this for you.")).not.toContain('classify');
    expect(cleanForVoice("I'll categorize your issue.")).not.toContain('categorize');
  });

  test('removes meta-commentary about classifying', () => {
    const result = cleanForVoice("Let me classify this for you. When are you available?");
    expect(result).not.toContain('classify');
    expect(result).toContain('available');
  });

  test('removes reasoning explanations', () => {
    const result = cleanForVoice("Since the water is draining into the sink, we can schedule this without rushing. When works for you?");
    expect(result).not.toMatch(/since the water/i);
  });

  test('preserves SR IDs (SR-2026-xxxxx)', () => {
    const result = cleanForVoice("Your reference number is SR-2026-12345.");
    expect(result).toContain('SR-2026-12345');
  });

  test('collapses extra whitespace', () => {
    expect(cleanForVoice('Hello   world')).toBe('Hello world');
  });

  test('returns null for empty result', () => {
    expect(cleanForVoice('***')).toBeNull();
  });

  test('handles null input', () => {
    expect(cleanForVoice(null)).toBeNull();
  });

  test('inserts SSML break between sentences', () => {
    const result = cleanForVoice('Got it. What works best for you?');
    expect(result).toContain('<break time="350ms"/>');
    // Break tag should sit between the two sentences.
    expect(result).toMatch(/Got it\. <break time="350ms"\/> What/);
  });

  test('does not add break after final sentence', () => {
    const result = cleanForVoice('Single sentence here.');
    expect(result).not.toContain('<break');
  });
});

describe('enforceBrevity', () => {
  test('keeps responses under 3 sentences by default', () => {
    const long = "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const result = enforceBrevity(long);
    const sentences = result.match(/[^.!?]+[.!?]+/g);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  test('does not truncate short responses', () => {
    const short = "One sentence. Two sentences.";
    expect(enforceBrevity(short)).toBe(short);
  });

  test('handles custom max sentences', () => {
    const text = "One. Two. Three. Four.";
    const result = enforceBrevity(text, 2);
    const sentences = result.match(/[^.!?]+[.!?]+/g);
    expect(sentences.length).toBeLessThanOrEqual(2);
  });

  test('handles null input', () => {
    expect(enforceBrevity(null)).toBeNull();
  });
});
