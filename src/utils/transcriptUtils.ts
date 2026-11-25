import type { HighlightColor, TranscriptSegment, WordTiming } from '../types/echo';

/**
 * Timestamp alignment layer:
 * When exact word-level timings are unavailable, interpolates proportional
 * word timings within each segment based on character length and explicitly
 * marks them as 'segment-interpolated' so callers never misrepresent precision.
 */
export function alignWordsToSegments(segments: TranscriptSegment[]): WordTiming[] {
  const words: WordTiming[] = [];

  for (const seg of segments) {
    const tokens = seg.text
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) continue;

    const totalDuration = Math.max(200, seg.endMs - seg.startMs);
    const totalWeight = tokens.reduce((acc, w) => acc + Math.max(2, w.length), 0);

    let cursorMs = seg.startMs;
    tokens.forEach((word, index) => {
      const weight = Math.max(2, word.length);
      const sliceMs =
        index === tokens.length - 1
          ? Math.max(50, seg.endMs - cursorMs)
          : Math.max(40, Math.round((weight / totalWeight) * totalDuration));
      const endMs = index === tokens.length - 1 ? Math.max(cursorMs + 50, seg.endMs) : cursorMs + sliceMs;
      words.push({
        word,
        startMs: cursorMs,
        endMs,
        segmentId: seg.id,
        precision: 'segment-interpolated',
      });
      cursorMs = endMs;
    });
  }

  return words;
}

export function findActiveWordAtTime(words: WordTiming[], currentTimeMs: number): number {
  if (words.length === 0 || currentTimeMs < 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTimeMs >= words[i].startMs && currentTimeMs < words[i].endMs) {
      return i;
    }
  }
  if (currentTimeMs >= words[words.length - 1].endMs) {
    return words.length - 1;
  }
  return 0;
}

export function formatTimestamp(ms: number, includeHours = false): string {
  const safeMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (includeHours || hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|h1|h2|h3|blockquote|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractHighlightsFromHtml(
  html: string
): Array<{ text: string; color: HighlightColor }> {
  const highlights: Array<{ text: string; color: HighlightColor }> = [];
  const regex = /<mark[^>]*data-highlight="(yellow|purple|mint|pink|orange)"[^>]*>([\s\S]*?)<\/mark>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const color = match[1].toLowerCase() as HighlightColor;
    const text = stripHtmlToPlainText(match[2]).trim();
    if (text) {
      highlights.push({ text, color });
    }
  }
  return highlights;
}

export function plainTextToRichHtml(text: string): string {
  if (!text.trim()) return '<p></p>';
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export function sanitizeRichHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ReadingMetrics {
  wordCount: number;
  readingMinutes: number;
  readingTimeLabel: string;
}

export function computeReadingMetrics(text: string, wordsPerMinute = 200): ReadingMetrics {
  const cleaned = text.trim();
  if (!cleaned) {
    return {
      wordCount: 0,
      readingMinutes: 0,
      readingTimeLabel: '0 min read',
    };
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;
  const safeWpm = Math.max(60, wordsPerMinute);
  if (wordCount < Math.round(safeWpm * 0.5)) {
    return {
      wordCount,
      readingMinutes: 1,
      readingTimeLabel: '< 1 min read',
    };
  }
  const readingMinutes = Math.max(1, Math.ceil(wordCount / safeWpm));
  return {
    wordCount,
    readingMinutes,
    readingTimeLabel: `${readingMinutes} min read`,
  };
}
