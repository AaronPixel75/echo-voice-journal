import type { JournalEntry } from '../types/echo';
import { extractHighlightsFromHtml, formatTimestamp, stripHtmlToPlainText } from './transcriptUtils';

export function formatEntryAsTxt(entry: JournalEntry): string {
  const plainBody = stripHtmlToPlainText(entry.richHtml) || entry.transcriptText;
  const highlights = extractHighlightsFromHtml(entry.richHtml);
  const lines = [
    entry.title,
    '='.repeat(Math.min(60, Math.max(12, entry.title.length))),
    `Date: ${new Date(entry.createdAt).toLocaleString()}`,
    `Duration: ${formatTimestamp(entry.durationMs)}`,
    `Category: ${entry.category}`,
    `Tags: ${entry.tags.join(', ') || 'None'}`,
    '',
    plainBody,
  ];

  if (highlights.length > 0) {
    lines.push('', 'Highlighted Passages:', ...highlights.map((h) => `- [${h.color}] ${h.text}`));
  }

  if (entry.bookmarks.length > 0) {
    lines.push(
      '',
      'Timestamp Bookmarks:',
      ...entry.bookmarks.map((b) => `- ${formatTimestamp(b.timeMs)} — ${b.label}`)
    );
  }

  return lines.join('\n');
}

export function formatEntryAsMarkdown(entry: JournalEntry): string {
  const plainBody = stripHtmlToPlainText(entry.richHtml) || entry.transcriptText;
  const highlights = extractHighlightsFromHtml(entry.richHtml);
  const lines = [
    `# ${entry.title}`,
    '',
    `- **Date:** ${new Date(entry.createdAt).toISOString()}`,
    `- **Duration:** ${formatTimestamp(entry.durationMs)}`,
    `- **Category:** ${entry.category}`,
    `- **Tags:** ${entry.tags.map((t) => `#${t}`).join(' ') || 'None'}`,
    '',
    '## Transcript & Notes',
    '',
    plainBody,
  ];

  if (highlights.length > 0) {
    lines.push('', '## Highlights', '');
    for (const h of highlights) {
      lines.push(`> ==${h.text}== *(marker: ${h.color})*`, '');
    }
  }

  if (entry.bookmarks.length > 0) {
    lines.push('', '## Bookmarks', '');
    for (const b of entry.bookmarks) {
      lines.push(`- \`${formatTimestamp(b.timeMs)}\` ${b.label}`);
    }
  }

  return lines.join('\n');
}

export function formatEntryAsJson(entry: JournalEntry): string {
  return JSON.stringify(entry, null, 2);
}
