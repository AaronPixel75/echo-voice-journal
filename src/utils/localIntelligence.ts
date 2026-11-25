/**
 * 100% offline deterministic heuristic intelligence for ECHO.
 * Works with zero external APIs or downloaded LLMs.
 */

const STOP_WORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they',
  'what', 'when', 'where', 'which', 'while', 'about', 'after', 'before', 'could',
  'would', 'should', 'there', 'their', 'these', 'those', 'into', 'just', 'like',
  'more', 'some', 'such', 'than', 'then', 'very', 'your', 'will', 'also', 'even',
  'much', 'only', 'over', 'back', 'really', 'going', 'think', 'today', 'feel',
]);

const TOPIC_LEXICON: Array<{ tag: string; keywords: string[] }> = [
  { tag: 'reflection', keywords: ['reflect', 'perspective', 'grateful', 'calm', 'quiet', 'morning', 'mind'] },
  { tag: 'ideas', keywords: ['idea', 'build', 'design', 'project', 'create', 'concept', 'prototype'] },
  { tag: 'focus', keywords: ['focus', 'deep', 'work', 'clarity', 'routine', 'plan', 'priority'] },
  { tag: 'nature', keywords: ['mountain', 'lake', 'walk', 'trail', 'sun', 'trees', 'air', 'sky'] },
  { tag: 'reading', keywords: ['book', 'read', 'chapter', 'quote', 'note', 'study', 'write'] },
  { tag: 'creativity', keywords: ['story', 'music', 'voice', 'color', 'sketch', 'art', 'sound'] },
];

export function suggestTitle(transcript: string): string {
  const cleaned = transcript.trim();
  if (!cleaned) return 'Untitled Voice Note';
  const firstSentence = cleaned.split(/[.!?]\s+/)[0]?.trim() || cleaned;
  const words = firstSentence.split(/\s+/).slice(0, 7);
  let title = words.join(' ').replace(/[,:;]+$/, '');
  if (words.length >= 7 && firstSentence.split(/\s+/).length > 7) {
    title += '…';
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function extractKeyIdeas(transcript: string, maxItems = 3): string[] {
  const sentences = transcript
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);
  if (sentences.length === 0) return [];

  const scored = sentences.map((sentence, idx) => {
    const lower = sentence.toLowerCase();
    let score = 0;
    if (lower.includes('important') || lower.includes('remember') || lower.includes('key')) score += 3;
    if (lower.includes('realized') || lower.includes('learned') || lower.includes('idea')) score += 2;
    if (sentence.length >= 45 && sentence.length <= 160) score += 2;
    if (idx === 0) score += 1;
    return { sentence, score, idx };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, maxItems)
    .sort((a, b) => a.idx - b.idx)
    .map((item) => item.sentence);
}

export function suggestTags(transcript: string): string[] {
  const lower = transcript.toLowerCase();
  const matched: string[] = [];

  for (const entry of TOPIC_LEXICON) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      matched.push(entry.tag);
    }
  }

  if (matched.length < 2) {
    const freq = new Map<string, number>();
    const tokens = lower.match(/[a-z]{4,}/g) || [];
    for (const token of tokens) {
      if (STOP_WORDS.has(token)) continue;
      freq.set(token, (freq.get(token) || 0) + 1);
    }
    const topWords = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3 - matched.length)
      .map(([word]) => word);
    for (const w of topWords) {
      if (!matched.includes(w)) matched.push(w);
    }
  }

  return matched.slice(0, 4);
}

export function computeWeeklyDigest(
  entries: Array<{ title: string; transcriptText: string; durationMs: number; createdAt: string; tags: string[] }>
) {
  const totalMs = entries.reduce((sum, e) => sum + (e.durationMs || 0), 0);
  const topicCounts = new Map<string, number>();

  for (const entry of entries) {
    const tags = entry.tags.length > 0 ? entry.tags : suggestTags(entry.transcriptText);
    for (const tag of tags) {
      topicCounts.set(tag, (topicCounts.get(tag) || 0) + 1);
    }
  }

  const topThemes = Array.from(topicCounts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const primaryTopic = topThemes[0]?.topic || 'quiet reflection';
  const reflectionPrompt =
    entries.length === 0
      ? 'Press record to capture your first unfiltered thought of the day.'
      : `Your notes gravitate toward ${primaryTopic}. What is one small thread from this week worth revisiting tomorrow?`;

  return {
    totalMinutes: Math.round(totalMs / 60000),
    entryCount: entries.length,
    topThemes,
    reflectionPrompt,
  };
}
