import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Eraser,
  Heading2,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from 'lucide-react';
import {
  alignWordsToSegments,
  extractHighlightsFromHtml,
  findActiveWordAtTime,
  formatTimestamp,
} from '../utils/transcriptUtils';
import { extractKeyIdeas } from '../utils/localIntelligence';
import { ANIME_COURTYARD_URL, HandDrawnGoldUnderline } from './EditorialIllustrations';
import type { EntryViewMode, HighlightColor, TranscriptSegment } from '../types/echo';

interface RichTranscriptEditorProps {
  richHtml: string;
  transcriptText: string;
  segments: TranscriptSegment[];
  hasAudio: boolean;
  currentTimeMs: number;
  editorFont: 'inter' | 'fraunces' | 'space-grotesk' | 'jetbrains-mono';
  onChangeHtml: (nextHtml: string) => void;
  onSeekToMs: (ms: number) => void;
}

const HIGHLIGHT_MARKERS: Array<{ id: HighlightColor; label: string; swatch: string }> = [
  { id: 'yellow', label: 'Yellow marker', swatch: '#FDE047' },
  { id: 'purple', label: 'Purple marker', swatch: '#BBA9FF' },
  { id: 'mint', label: 'Mint marker', swatch: '#91DCC1' },
  { id: 'pink', label: 'Pink marker', swatch: '#F9A8D4' },
  { id: 'orange', label: 'Orange marker', swatch: '#FF9F7A' },
];

export function RichTranscriptEditor({
  richHtml,
  transcriptText,
  segments,
  hasAudio,
  currentTimeMs,
  editorFont,
  onChangeHtml,
  onSeekToMs,
}: RichTranscriptEditorProps) {
  const [viewMode, setViewMode] = useState<EntryViewMode>('clean');
  const [fontFamily, setFontFamily] = useState(editorFont);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
  const [selectionPos, setSelectionPos] = useState<{ top: number; left: number } | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlRef = useRef<string>(richHtml);

  useEffect(() => {
    if (editorRef.current && richHtml !== lastHtmlRef.current) {
      if (document.activeElement !== editorRef.current) {
        editorRef.current.innerHTML = richHtml || '<p></p>';
      }
      lastHtmlRef.current = richHtml;
    }
  }, [richHtml]);

  useEffect(() => {
    if (editorRef.current && viewMode === 'clean') {
      editorRef.current.innerHTML = richHtml || '<p></p>';
    }
  }, [viewMode]);

  const alignedWords = useMemo(() => alignWordsToSegments(segments), [segments]);
  const activeWordIndex = useMemo(
    () => findActiveWordAtTime(alignedWords, currentTimeMs),
    [alignedWords, currentTimeMs]
  );

  const highlights = useMemo(() => extractHighlightsFromHtml(richHtml), [richHtml]);
  const keyIdeas = useMemo(() => extractKeyIdeas(transcriptText, 3), [transcriptText]);

  const emitEditorChange = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    lastHtmlRef.current = html;
    onChangeHtml(html);
  };

  const execFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emitEditorChange();
  };

  const applyHighlightColor = (color: HighlightColor) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editorRef.current?.contains(range.commonAncestorContainer)) return;

    const mark = document.createElement('mark');
    mark.setAttribute('data-highlight', color);
    try {
      range.surroundContents(mark);
    } catch {
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
    }
    sel.removeAllRanges();
    setSelectionPos(null);
    emitEditorChange();
  };

  const clearHighlightInSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    const markEl =
      node instanceof Element
        ? node.closest('mark')
        : node?.parentElement?.closest('mark');
    if (markEl && markEl.parentNode) {
      const textNode = document.createTextNode(markEl.textContent || '');
      markEl.parentNode.replaceChild(textNode, markEl);
      emitEditorChange();
    }
    setSelectionPos(null);
  };

  const updateFloatingSelectionToolbar = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !wrapperRef.current || !editorRef.current) {
      setSelectionPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editorRef.current.contains(range.commonAncestorContainer)) {
      setSelectionPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const wrapRect = wrapperRef.current.getBoundingClientRect();
    if (rect.width < 2) {
      setSelectionPos(null);
      return;
    }
    setSelectionPos({
      top: Math.max(8, rect.top - wrapRect.top - 48),
      left: Math.max(12, Math.min(wrapRect.width - 260, rect.left - wrapRect.left)),
    });
  };

  const fontClass =
    fontFamily === 'fraunces'
      ? 'font-editorial'
      : fontFamily === 'space-grotesk'
        ? 'font-display'
        : fontFamily === 'jetbrains-mono'
          ? 'font-mono-meta'
          : 'font-sans';

  const sizeClass =
    fontSize === 'sm'
      ? 'text-sm leading-relaxed'
      : fontSize === 'lg'
        ? 'text-lg leading-relaxed'
        : fontSize === 'xl'
          ? 'text-xl leading-relaxed'
          : 'text-base leading-relaxed';

  return (
    <div
      ref={wrapperRef}
      className="relative paper-card rounded-3xl p-5 md:p-7 space-y-5 animate-paper-unfold"
    >
      {/* Top Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-black/10 dark:border-[#D4A44B]/15">
        <div
          role="tablist"
          aria-label="Transcript presentation mode"
          className="flex items-center gap-1 p-1 rounded-xl bg-[#EFE4C9] dark:bg-[#0D0C14]"
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'clean'}
            onClick={() => setViewMode('clean')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'clean'
                ? 'bg-[#FAF5E8] dark:bg-[#6839D3] text-[#14121D] dark:text-[#F5EEDB] shadow-sm border border-[#D4A44B]/30'
                : 'text-[#5A5248] dark:text-[#B6AC9A]'
            }`}
          >
            Rich Editor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'reading'}
            onClick={() => setViewMode('reading')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              viewMode === 'reading'
                ? 'bg-[#FAF5E8] dark:bg-[#6839D3] text-[#14121D] dark:text-[#F5EEDB] shadow-sm border border-[#D4A44B]/30'
                : 'text-[#5A5248] dark:text-[#B6AC9A]'
            }`}
          >
            Reading View
          </button>
          {hasAudio && (
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'audio'}
              onClick={() => setViewMode('audio')}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'audio'
                  ? 'bg-[#FAF5E8] dark:bg-[#6839D3] text-[#14121D] dark:text-[#F5EEDB] shadow-sm border border-[#D4A44B]/30'
                  : 'text-[#5A5248] dark:text-[#B6AC9A]'
              }`}
            >
              Synced Audio &amp; Words
            </button>
          )}
        </div>

        {/* Font & Size Controls */}
        <div className="flex items-center gap-2">
          <label htmlFor="editor-font-select" className="sr-only">
            Transcript Font
          </label>
          <select
            id="editor-font-select"
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value as typeof fontFamily)}
            className="px-2.5 py-1.5 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-xs"
          >
            <option value="fraunces">Fraunces Serif</option>
            <option value="inter">Inter</option>
            <option value="space-grotesk">Space Grotesk</option>
            <option value="jetbrains-mono">JetBrains Mono</option>
          </select>

          <label htmlFor="editor-size-select" className="sr-only">
            Font Size
          </label>
          <select
            id="editor-size-select"
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value as typeof fontSize)}
            className="px-2.5 py-1.5 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-xs"
          >
            <option value="sm">Small</option>
            <option value="base">Medium</option>
            <option value="lg">Large</option>
            <option value="xl">Editorial XL</option>
          </select>
        </div>
      </div>

      {/* Rich Formatting & Creative Highlighting Toolbar */}
      {viewMode === 'clean' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/10 dark:border-[#D4A44B]/20">
            <div className="flex flex-wrap items-center gap-1">
              <button type="button" onClick={() => execFormat('bold')} aria-label="Bold" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Bold className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('italic')} aria-label="Italic" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Italic className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('underline')} aria-label="Underline" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Underline className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('strikeThrough')} aria-label="Strikethrough" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Strikethrough className="w-4 h-4" />
              </button>
              <span className="w-px h-5 bg-black/12 dark:bg-[#D4A44B]/20 mx-1" aria-hidden="true" />
              <button type="button" onClick={() => execFormat('formatBlock', 'h2')} aria-label="Heading" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Heading2 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('formatBlock', 'blockquote')} aria-label="Editorial Quotation" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <Quote className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('insertUnorderedList')} aria-label="Bulleted list" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <List className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => execFormat('insertOrderedList')} aria-label="Numbered list" className="min-w-[36px] min-h-[36px] rounded-lg hover:bg-black/8 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer">
                <ListOrdered className="w-4 h-4" />
              </button>
            </div>

            {/* 5 Highlighter Markers */}
            <div className="flex items-center gap-1.5" aria-label="Highlight markers">
              <Highlighter className="w-4 h-4 text-[#5A5248] dark:text-[#B6AC9A] mr-1" />
              {HIGHLIGHT_MARKERS.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  title={`Highlight ${marker.id}`}
                  aria-label={marker.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyHighlightColor(marker.id);
                  }}
                  style={{ backgroundColor: marker.swatch }}
                  className="w-6 h-6 rounded-full border border-black/25 hover:scale-110 transition-transform cursor-pointer"
                />
              ))}
              <button
                type="button"
                title="Remove highlight"
                aria-label="Clear highlight"
                onMouseDown={(e) => {
                  e.preventDefault();
                  clearHighlightInSelection();
                }}
                className="min-w-[32px] min-h-[32px] rounded-lg hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer ml-1"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Floating Contextual Selection Toolbar */}
          {selectionPos && (
            <div
              style={{ top: selectionPos.top, left: selectionPos.left }}
              className="absolute z-30 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0D0C14] text-[#F5EEDB] border border-[#D4A44B]/40 shadow-xl"
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execFormat('bold');
                }}
                className="px-2 py-1 text-xs font-bold hover:bg-white/10 rounded cursor-pointer"
              >
                B
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execFormat('italic');
                }}
                className="px-2 py-1 text-xs italic hover:bg-white/10 rounded cursor-pointer"
              >
                I
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  execFormat('formatBlock', 'blockquote');
                }}
                className="px-2 py-1 text-xs font-editorial hover:bg-white/10 rounded cursor-pointer"
              >
                “Quote”
              </button>
              <span className="w-px h-4 bg-white/20" aria-hidden="true" />
              {HIGHLIGHT_MARKERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-label={`Selection ${m.label}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyHighlightColor(m.id);
                  }}
                  style={{ backgroundColor: m.swatch }}
                  className="w-4 h-4 rounded-full cursor-pointer"
                />
              ))}
            </div>
          )}

          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            data-testid="rich-transcript-editor"
            onInput={emitEditorChange}
            onMouseUp={updateFloatingSelectionToolbar}
            onKeyUp={updateFloatingSelectionToolbar}
            className={`echo-rich-editor min-h-[220px] p-4 rounded-2xl bg-[#FAF5E8]/60 dark:bg-[#0D0C14]/40 focus:outline-none ${fontClass} ${sizeClass}`}
          />
        </>
      )}

      {/* Editorial Reading View */}
      {viewMode === 'reading' && (
        <div className="space-y-8 py-2">
          <div className="relative rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-[#D4A44B]/25 p-6 md:p-8 overflow-hidden">
            {/* Subtle anime courtyard artwork vignette matching showcase journal page */}
            <img
              src={ANIME_COURTYARD_URL}
              alt=""
              aria-hidden="true"
              className="hidden sm:block absolute bottom-0 right-0 w-56 h-44 object-cover opacity-25 dark:opacity-20 torn-edge-bottom pointer-events-none select-none rounded-tl-3xl"
            />
            <div className="relative z-10 max-w-2xl space-y-4">
              <div className="flex items-center gap-3">
                <span className="font-mono-meta text-[11px] uppercase tracking-wider text-[#B68224] dark:text-[#E5B85C]">
                  Editorial Edition
                </span>
                <HandDrawnGoldUnderline className="w-20 h-2" />
              </div>

              {keyIdeas[0] && (
                <blockquote className="font-editorial italic text-2xl md:text-3xl font-bold leading-snug text-[#14121D] dark:text-[#F5EEDB] border-l-2 border-[#D4A44B] pl-4">
                  “{keyIdeas[0]}”
                </blockquote>
              )}

              <div
                className={`echo-prose ${fontClass} ${sizeClass}`}
                dangerouslySetInnerHTML={{ __html: richHtml || '<p>No transcript notes yet.</p>' }}
              />
            </div>
          </div>

          {(highlights.length > 0 || keyIdeas.length > 0) && (
            <div className="max-w-3xl mx-auto pt-4 border-t border-black/10 dark:border-[#D4A44B]/15 grid grid-cols-1 md:grid-cols-2 gap-5">
              {highlights.length > 0 && (
                <div className="p-5 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-2.5">
                  <h4 className="font-editorial text-sm font-bold">Highlighted Passages</h4>
                  <ul className="space-y-2 text-sm">
                    {highlights.map((h, i) => (
                      <li key={i} className="leading-snug">
                        <mark data-highlight={h.color}>{h.text}</mark>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {keyIdeas.length > 0 && (
                <div className="p-5 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-2.5">
                  <h4 className="font-editorial text-sm font-bold">Key Ideas Extracted</h4>
                  <ul className="space-y-2 text-sm text-[#5A5248] dark:text-[#B6AC9A]">
                    {keyIdeas.map((idea, i) => (
                      <li key={i}>• {idea}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Synchronized Audio + Word Highlighting View */}
      {viewMode === 'audio' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A5248] dark:text-[#B6AC9A]">
            <span>Tap any word or timestamp to jump audio playback directly there.</span>
            <span className="font-mono-meta">Alignment: segment-interpolated</span>
          </div>

          {segments.length === 0 ? (
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] py-6 text-center">
              No timed segments yet. Run local transcription or edit the note in Rich Editor.
            </p>
          ) : (
            <div className="space-y-4">
              {segments.map((seg) => {
                const segWords = alignedWords.filter((w) => w.segmentId === seg.id);
                const isActiveSeg = currentTimeMs >= seg.startMs && currentTimeMs < seg.endMs;
                return (
                  <div
                    key={seg.id}
                    className={`p-4 rounded-2xl border transition-colors ${
                      isActiveSeg
                        ? 'bg-[#6839D3]/10 border-[#D4A44B]/60'
                        : 'bg-[#F5EEDB]/70 dark:bg-[#0D0C14]/70 border-black/8 dark:border-[#D4A44B]/12'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSeekToMs(seg.startMs)}
                      className="font-mono-meta text-xs text-[#6839D3] dark:text-[#E5B85C] hover:underline mb-2 inline-block cursor-pointer"
                    >
                      {formatTimestamp(seg.startMs)} – {formatTimestamp(seg.endMs)}
                    </button>
                    <p className={`leading-relaxed ${fontClass} ${sizeClass}`}>
                      {segWords.map((w, idx) => {
                        const globalIdx = alignedWords.indexOf(w);
                        const isActiveWord = globalIdx === activeWordIndex;
                        return (
                          <React.Fragment key={`${seg.id}-${idx}`}>
                            <button
                              type="button"
                              onClick={() => onSeekToMs(w.startMs)}
                              className={`inline px-0.5 rounded transition-colors cursor-pointer ${
                                isActiveWord
                                  ? 'bg-[#F6D063] text-[#14121D] font-semibold'
                                  : 'hover:bg-[#6839D3]/20'
                              }`}
                            >
                              {w.word}
                            </button>{' '}
                          </React.Fragment>
                        );
                      })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
