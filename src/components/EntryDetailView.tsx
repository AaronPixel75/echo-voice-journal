import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bookmark,
  BookOpen,
  BrainCircuit,
  Calendar,
  Check,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { RichTranscriptEditor } from './RichTranscriptEditor';
import { BUNDLED_COVER_ART } from './EditorialIllustrations';
import { formatEntryAsJson, formatEntryAsMarkdown, formatEntryAsTxt } from '../utils/exportFormatters';
import { suggestTags, suggestTitle } from '../utils/localIntelligence';
import { computeReadingMetrics, formatTimestamp, stripHtmlToPlainText } from '../utils/transcriptUtils';
import { echoApi } from '../services/echoApi';
import type { EchoSettings, JournalEntry, Notebook } from '../types/echo';

interface EntryDetailViewProps {
  entry: JournalEntry;
  notebooks: Notebook[];
  settings: EchoSettings;
  onBack: () => void;
  onNavigateToJournal: (notebookId?: string) => void;
  onNavigateToCalendarDay: (dayKey: string) => void;
  onUpdated: (entry: JournalEntry) => void;
  onDeleted: (entryId: string) => void;
  onRefreshBootstrap: () => Promise<void>;
}

export function EntryDetailView({
  entry,
  notebooks,
  settings,
  onBack,
  onNavigateToJournal,
  onNavigateToCalendarDay,
  onUpdated,
  onDeleted,
  onRefreshBootstrap,
}: EntryDetailViewProps) {
  const [title, setTitle] = useState(entry.title);
  const [newTag, setNewTag] = useState('');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [seekRequestMs, setSeekRequestMs] = useState<{ ms: number; seq: number } | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [retranscribing, setRetranscribing] = useState(false);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const patchEntry = async (updates: Partial<JournalEntry>, notice?: string) => {
    const updated = await echoApi.updateEntry(entry.id, updates);
    onUpdated(updated);
    if (notice) {
      setSaveNotice(notice);
      setTimeout(() => setSaveNotice(null), 2200);
    }
  };

  const handleTitleBlur = () => {
    if (title.trim() && title.trim() !== entry.title) {
      void patchEntry({ title: title.trim() }, 'Title saved');
    }
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newTag.trim().toLowerCase().replace(/^#/, '');
    if (!clean || entry.tags.includes(clean)) {
      setNewTag('');
      return;
    }
    void patchEntry({ tags: [...entry.tags, clean] }, 'Tag added');
    setNewTag('');
  };

  const handleRemoveTag = (tag: string) => {
    void patchEntry({ tags: entry.tags.filter((t) => t !== tag) });
  };

  const handleAddBookmarkAt = (timeMs: number) => {
    const bm = {
      id: `bm-${Date.now().toString(36)}`,
      timeMs,
      label: `Note at ${formatTimestamp(timeMs)}`,
      createdAt: new Date().toISOString(),
    };
    void patchEntry({ bookmarks: [...entry.bookmarks, bm] }, 'Bookmark pinned');
  };

  const handleRetranscribe = async () => {
    setRetranscribing(true);
    try {
      await echoApi.retranscribe(entry.id);
      await onRefreshBootstrap();
      setSaveNotice('Transcription queued locally');
    } catch (err) {
      setSaveNotice(err instanceof Error ? err.message : 'Unable to queue transcription');
    } finally {
      setRetranscribing(false);
    }
  };

  const handleAnalyzeAi = async () => {
    setAnalyzingAi(true);
    setAiNotice(null);
    try {
      const res = await echoApi.regenerateEntryAi(entry.id);
      if (res.entry) {
        onUpdated(res.entry);
      }
      if (res.job.status === 'paused_low_memory') {
        setAiNotice(res.job.errorMessage || 'Insufficient memory — AI analysis safely paused.');
      } else if (res.job.status === 'cancelled') {
        setAiNotice(res.job.errorMessage || 'Local AI is disabled in Settings.');
      } else {
        setAiNotice('Local Gemma insights updated (original audio preserved).');
      }
      await onRefreshBootstrap();
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : 'Unable to run local AI analysis.');
    } finally {
      setAnalyzingAi(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const updated = await echoApi.attachImage(entry.id, dataUrl, file.name);
      onUpdated(updated);
      setSaveNotice('Image saved to ECHO/images');
    };
    reader.readAsDataURL(file);
  };

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const safeSlug = entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'echo-entry';
  const entryPlainText =
    entry.transcriptText.trim() || stripHtmlToPlainText(entry.richHtml || '');
  const readingMetrics = computeReadingMetrics(entryPlainText);
  const currentNotebook = notebooks.find((nb) => nb.id === entry.notebookId) || null;
  const entryDayKey = entry.createdAt.slice(0, 10);
  const entryShortDate = new Date(entry.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-14 animate-paper-unfold">
      {/* Top Action Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[40px] px-3.5 py-2 rounded-xl paper-card text-sm font-medium flex items-center gap-2 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {saveNotice && (
            <span className="font-mono-meta text-xs text-[#6839D3] dark:text-[#E5B85C] px-2">
              {saveNotice}
            </span>
          )}
          <button
            type="button"
            onClick={() => void patchEntry({ isFavorite: !entry.isFavorite })}
            aria-label={entry.isFavorite ? 'Remove favourite' : 'Mark favourite'}
            className="min-w-[40px] min-h-[40px] px-3 rounded-xl paper-card flex items-center gap-1.5 text-xs font-medium cursor-pointer"
          >
            <Star className={`w-4 h-4 ${entry.isFavorite ? 'fill-[#D4A44B] text-[#D4A44B]' : ''}`} />
            <span className="hidden sm:inline">{entry.isFavorite ? 'Favourited' : 'Favourite'}</span>
          </button>
          <button
            type="button"
            onClick={() => void patchEntry({ isPinned: !entry.isPinned })}
            aria-label={entry.isPinned ? 'Unpin entry' : 'Pin entry'}
            className="min-w-[40px] min-h-[40px] px-3 rounded-xl paper-card flex items-center gap-1.5 text-xs font-medium cursor-pointer"
          >
            <Pin className={`w-4 h-4 ${entry.isPinned ? 'text-[#6839D3] dark:text-[#E5B85C]' : ''}`} />
            <span className="hidden sm:inline">{entry.isPinned ? 'Pinned' : 'Pin'}</span>
          </button>
          <button
            type="button"
            onClick={() => void patchEntry({ isArchived: !entry.isArchived }, entry.isArchived ? 'Restored' : 'Archived')}
            aria-label={entry.isArchived ? 'Unarchive entry' : 'Archive entry'}
            className="min-w-[40px] min-h-[40px] px-3 rounded-xl paper-card flex items-center gap-1.5 text-xs font-medium cursor-pointer"
          >
            <Archive className="w-4 h-4" />
            <span className="hidden sm:inline">{entry.isArchived ? 'Restore' : 'Archive'}</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete((v) => !v)}
            aria-label="Delete entry options"
            className="min-w-[40px] min-h-[40px] px-3 rounded-xl paper-card text-[#E27A48] flex items-center justify-center cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Safe Deletion Prompt */}
      {confirmDelete && (
        <div className="no-print p-4 rounded-2xl bg-[#E27A48]/12 border border-[#E27A48]/40 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            Remove this journal entry? You can keep the original audio file safely on disk or delete both.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await echoApi.deleteEntry(entry.id, false);
                onDeleted(entry.id);
              }}
              className="px-3.5 py-2 rounded-xl bg-[#0D0C14] text-[#F5EEDB] text-xs font-semibold cursor-pointer"
            >
              Delete Entry (Keep Audio)
            </button>
            <button
              type="button"
              onClick={async () => {
                await echoApi.deleteEntry(entry.id, true);
                onDeleted(entry.id);
              }}
              className="px-3.5 py-2 rounded-xl bg-[#E27A48] text-white text-xs font-semibold cursor-pointer"
            >
              Delete Permanently
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-2 rounded-xl text-xs cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Cover Artwork & Title Header */}
      <header className="paper-card rounded-3xl overflow-hidden">
        {entry.coverImage && (
          <div className="relative h-56 md:h-64 bg-[#0D0C14] torn-edge-bottom">
            <img
              src={entry.coverImage}
              alt={entry.title}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => setShowCoverPicker((v) => !v)}
              className="no-print absolute bottom-4 right-4 px-3 py-1.5 rounded-xl bg-[#0D0C14]/85 border border-[#D4A44B]/40 text-[#F5EEDB] text-xs font-medium backdrop-blur-sm cursor-pointer"
            >
              Change Cover
            </button>
          </div>
        )}

        <div className="p-6 md:p-8 space-y-5">
          {/* Editorial Breadcrumb Navigation Trail */}
          <nav
            aria-label="Entry breadcrumb"
            className="no-print flex flex-wrap items-center gap-1.5 font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] pb-3 border-b border-black/8 dark:border-[#D4A44B]/18"
          >
            <button
              type="button"
              onClick={() => onNavigateToJournal('all')}
              className="inline-flex items-center gap-1.5 hover:text-[#6839D3] dark:hover:text-[#E5B85C] transition-colors cursor-pointer"
            >
              <BookOpen className="w-3.5 h-3.5 text-[#D4A44B]" />
              <span>Journal</span>
            </button>
            <ChevronRight className="w-3.5 h-3.5 opacity-50 shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onNavigateToJournal(entry.notebookId)}
              title={`Open ${currentNotebook?.name || 'Notebook'} in Journal`}
              className="inline-flex items-center gap-1.5 hover:text-[#6839D3] dark:hover:text-[#E5B85C] transition-colors cursor-pointer"
            >
              {currentNotebook && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: currentNotebook.color }}
                  aria-hidden="true"
                />
              )}
              <span>{currentNotebook?.name || 'Notebook'}</span>
            </button>
            <ChevronRight className="w-3.5 h-3.5 opacity-50 shrink-0" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onNavigateToCalendarDay(entryDayKey)}
              title={`View ${entryShortDate} in Calendar`}
              className="inline-flex items-center gap-1.5 hover:text-[#6839D3] dark:hover:text-[#E5B85C] transition-colors cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5 text-[#D4A44B]" />
              <span>{entryShortDate}</span>
            </button>
            <ChevronRight className="w-3.5 h-3.5 opacity-50 shrink-0" aria-hidden="true" />
            <span
              aria-current="page"
              className="text-[#14121D] dark:text-[#F5EEDB] font-semibold truncate max-w-[220px] sm:max-w-[320px]"
            >
              {title || entry.title}
            </span>
          </nav>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#5A5248] dark:text-[#B6AC9A] font-mono-meta tabular-nums">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span>
                {new Date(entry.createdAt).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}{' '}
                · {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span aria-hidden="true" className="text-[#D4A44B]">
                ·
              </span>
              <span className="text-[#14121D] dark:text-[#F5EEDB] font-medium">
                {readingMetrics.wordCount} {readingMetrics.wordCount === 1 ? 'word' : 'words'}
              </span>
              <span aria-hidden="true" className="text-[#D4A44B]">
                ·
              </span>
              <span>{readingMetrics.readingTimeLabel}</span>
            </div>
            <div className="no-print flex items-center gap-3">
              {!entry.coverImage && (
                <button
                  type="button"
                  onClick={() => setShowCoverPicker((v) => !v)}
                  className="text-[#6839D3] dark:text-[#E5B85C] hover:underline cursor-pointer"
                >
                  + Add Cover Illustration
                </button>
              )}
              <button
                type="button"
                title="Suggest title offline"
                onClick={() => {
                  const suggested = suggestTitle(entry.transcriptText);
                  setTitle(suggested);
                  void patchEntry({ title: suggested }, 'Title suggested offline');
                }}
                className="min-h-[34px] px-3 py-1 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] border border-[#D4A44B]/30 text-xs font-sans font-medium text-[#14121D] dark:text-[#F5EEDB] flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#D4A44B]" />
                <span>Suggest Title</span>
              </button>
            </div>
          </div>

          <div>
            <input
              type="text"
              aria-label="Entry title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              className="w-full font-editorial text-2xl md:text-4xl font-bold bg-transparent focus:outline-none border-b border-transparent focus:border-[#D4A44B] pb-1"
            />
          </div>

          {showCoverPicker && (
            <div className="no-print grid grid-cols-2 sm:grid-cols-5 gap-3 p-3 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14]">
              {BUNDLED_COVER_ART.map((art) => (
                <button
                  key={art.id}
                  type="button"
                  onClick={() => {
                    void patchEntry({ coverImage: art.url }, 'Cover updated');
                    setShowCoverPicker(false);
                  }}
                  className="rounded-xl overflow-hidden border border-black/10 dark:border-[#D4A44B]/20 hover:ring-2 hover:ring-[#D4A44B] text-left cursor-pointer"
                >
                  <img src={art.url} alt={art.label} className="w-full h-16 object-cover" />
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  void patchEntry({ coverImage: null }, 'Cover removed');
                  setShowCoverPicker(false);
                }}
                className="rounded-xl border border-dashed border-black/20 dark:border-[#D4A44B]/30 text-xs flex items-center justify-center p-2 cursor-pointer"
              >
                None
              </button>
            </div>
          )}

          {/* Notebook, Category, Tags */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="entry-notebook" className="text-[#5A5248] dark:text-[#B6AC9A]">
                Notebook:
              </label>
              <select
                id="entry-notebook"
                value={entry.notebookId}
                onChange={(e) => void patchEntry({ notebookId: e.target.value }, 'Moved notebook')}
                className="px-2.5 py-1.5 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20"
              >
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {entry.tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 text-[#6839D3] dark:text-[#E5B85C] font-medium">
                  #{tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => handleRemoveTag(tag)}
                    className="no-print hover:text-[#E27A48] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <form onSubmit={handleAddTag} className="no-print inline-flex items-center gap-1">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add tag…"
                  className="w-24 px-2 py-1 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-xs"
                />
                <button
                  type="submit"
                  aria-label="Add tag"
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const suggested = suggestTags(entry.transcriptText);
                    const merged = Array.from(new Set([...entry.tags, ...suggested]));
                    void patchEntry({ tags: merged }, 'Tags suggested offline');
                  }}
                  className="px-2 py-1 rounded-lg text-[11px] bg-[#EFE4C9] dark:bg-[#211E31] cursor-pointer"
                >
                  Auto-tag
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Transcription Status Banner (when pending, processing, waiting, or failed) */}
      {entry.audioUrl && entry.transcriptionStatus !== 'completed' && entry.transcriptionStatus !== 'none' && (
        <div className="no-print paper-card p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {entry.transcriptionStatus === 'failed' || entry.transcriptionStatus === 'waiting_for_model' ? (
              <AlertTriangle className="w-5 h-5 text-[#E27A48]" />
            ) : (
              <Loader2 className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C] animate-spin" />
            )}
            <div>
              <div className="text-sm font-semibold">
                {entry.transcriptionStatus === 'failed'
                  ? 'Transcription paused — original audio is safe and playable'
                  : entry.transcriptionStatus === 'waiting_for_model'
                    ? 'Waiting for local Whisper model'
                    : `Local transcription ${entry.transcriptionStatus} (${entry.transcriptionProgress}%)`}
              </div>
              {entry.transcriptionError && (
                <p className="text-xs text-[#E27A48] mt-0.5">{entry.transcriptionError}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={retranscribing}
            onClick={() => void handleRetranscribe()}
            className="px-4 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Transcription</span>
          </button>
        </div>
      )}

      {/* Studio Audio Player */}
      {entry.audioUrl && (
        <div className="no-print space-y-3">
          <AudioPlayer
            audioUrl={entry.audioUrl}
            durationMs={entry.durationMs}
            waveformPeaks={entry.waveformPeaks}
            bookmarks={entry.bookmarks}
            defaultSpeed={settings.playbackSpeed}
            currentTimeMs={currentTimeMs}
            onTimeUpdateMs={setCurrentTimeMs}
            seekRequestMs={seekRequestMs}
            onAddBookmarkAt={handleAddBookmarkAt}
          />
          {entry.prosody && (
            <div className="paper-card rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-editorial font-bold text-[#14121D] dark:text-[#F5EEDB]">
                  Vocal Cadence:
                </span>
                <span className="text-[#6839D3] dark:text-[#E5B85C] font-semibold">
                  {entry.prosody.deliveryLabel}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">
                <span>{entry.prosody.wordsPerMinute} wpm</span>
                <span>{entry.prosody.speechDensityPct}% vocal density</span>
                {entry.prosody.estimatedPitchHz !== null && (
                  <span>~{entry.prosody.estimatedPitchHz} Hz F0</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rich Text & Word-Level Highlighting Editor */}
      <RichTranscriptEditor
        richHtml={entry.richHtml}
        transcriptText={entry.transcriptText}
        segments={entry.segments}
        hasAudio={Boolean(entry.audioUrl)}
        currentTimeMs={currentTimeMs}
        editorFont={settings.editorFont}
        onChangeHtml={(nextHtml) => void patchEntry({ richHtml: nextHtml })}
        onSeekToMs={(ms) => setSeekRequestMs({ ms, seq: Date.now() })}
      />

      {/* On-Device Google Gemma Insights & Optional Proofread Card */}
      <section className="no-print paper-card rounded-2xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C]" />
            <div>
              <h3 className="font-editorial text-lg font-bold">On-Device Gemma Insights</h3>
              <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                {entry.aiInsights?.generatedBy || 'Google Gemma · LiteRT-LM Offline'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={analyzingAi || !settings.aiEnabled}
            onClick={() => void handleAnalyzeAi()}
            className="px-3.5 py-2 rounded-xl bg-[#6839D3] hover:bg-[#5A2EC0] disabled:opacity-45 text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {analyzingAi ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-[#E5B85C]" />
            )}
            <span>{entry.aiInsights ? 'Regenerate Insights' : 'Analyze Offline'}</span>
          </button>
        </div>

        {aiNotice && (
          <div className="p-3 rounded-xl bg-[#D4A44B]/15 border border-[#D4A44B]/35 text-xs font-medium">
            {aiNotice}
          </div>
        )}

        {!settings.aiEnabled ? (
          <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
            Local On-Device AI is disabled in Settings. Original audio, manual edits, highlights, and keyword search remain 100% active.
          </p>
        ) : entry.aiInsights ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-[#6839D3]/12 border border-[#6839D3]/25 font-semibold text-[#6839D3] dark:text-[#BBA9FF]">
                Topic: {entry.aiInsights.topic}
              </span>
              {entry.aiInsights.suggestedTags.slice(0, 4).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    if (!entry.tags.includes(t)) {
                      void patchEntry({ tags: [...entry.tags, t] }, `Added #${t}`);
                    }
                  }}
                  className="px-2 py-1 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-[#D4A44B]/25 hover:border-[#D4A44B] text-[11px] cursor-pointer"
                >
                  + #{t}
                </button>
              ))}
            </div>

            <p className="text-sm leading-relaxed">{entry.aiInsights.summary}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {entry.aiInsights.keyIdeas.length > 0 && (
                <div className="p-4 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
                    Key Ideas Extracted
                  </div>
                  <ul className="space-y-1 text-xs leading-relaxed">
                    {entry.aiInsights.keyIdeas.map((idea, i) => (
                      <li key={i}>• {idea}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="p-4 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
                  Reflection &amp; Growth Prompt
                </div>
                <p className="text-xs leading-relaxed font-medium">
                  {entry.aiInsights.growthObservation}
                </p>
                {entry.aiInsights.reflectionQuestions[0] && (
                  <p className="text-xs text-[#6839D3] dark:text-[#E5B85C] italic pt-1">
                    “{entry.aiInsights.reflectionQuestions[0]}”
                  </p>
                )}
              </div>
            </div>

            {entry.aiInsights.proofreadText &&
              entry.aiInsights.proofreadText !== entry.transcriptText.trim() && (
                <div className="p-4 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-[#D4A44B]/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold">
                      Optional Proofread Suggestion (Original audio untouched)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void patchEntry(
                          { transcriptText: entry.aiInsights!.proofreadText },
                          'Proofread transcript applied'
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-[#D4A44B] text-[#14121D] text-xs font-semibold flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply Proofread</span>
                    </button>
                  </div>
                  <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
                    {entry.aiInsights.proofreadText}
                  </p>
                </div>
              )}
          </div>
        ) : (
          <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
            Click “Analyze Offline” to generate an on-device summary, topic tags, reflection questions, and optional proofreading without leaving your device.
          </p>
        )}
      </section>

      {/* Bookmarks, Image Attachments & Local Exports */}
      <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Bookmarks & Attachments */}
        <div className="paper-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-editorial text-base font-bold">Bookmarks &amp; Visual Notes</h3>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>Attach Image</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>

          {entry.bookmarks.length === 0 ? (
            <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Pin timestamped moments from the player above to jump directly to key reflections.
            </p>
          ) : (
            <ul className="space-y-2">
              {entry.bookmarks.map((bm) => (
                <li key={bm.id} className="flex items-center justify-between gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setSeekRequestMs({ ms: bm.timeMs, seq: Date.now() })}
                    className="flex items-center gap-2 text-left hover:text-[#6839D3] dark:hover:text-[#E5B85C] cursor-pointer"
                  >
                    <Bookmark className="w-3.5 h-3.5 text-[#D4A44B]" />
                    <span className="font-mono-meta text-xs">{formatTimestamp(bm.timeMs)}</span>
                    <span>{bm.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${bm.label}`}
                    onClick={() =>
                      void patchEntry({ bookmarks: entry.bookmarks.filter((b) => b.id !== bm.id) })
                    }
                    className="text-xs text-[#5A5248] hover:text-[#E27A48] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {entry.attachments.length > 0 && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              {entry.attachments.map((att) => (
                <img
                  key={att.id}
                  src={att.url}
                  alt={att.caption || 'Attached memory'}
                  className="w-full h-28 object-cover rounded-xl border border-black/10 dark:border-[#D4A44B]/20"
                />
              ))}
            </div>
          )}
        </div>

        {/* Export & Offline Processing */}
        <div className="paper-card rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-editorial text-base font-bold">Export &amp; Audio Actions</h3>
            {entry.audioUrl && (
              <button
                type="button"
                disabled={retranscribing}
                onClick={() => void handleRetranscribe()}
                className="text-xs font-medium text-[#6839D3] dark:text-[#E5B85C] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-run Whisper Pass</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => triggerDownload(formatEntryAsTxt(entry), `${safeSlug}.txt`, 'text/plain')}
              className="py-2.5 px-3 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>TXT</span>
            </button>
            <button
              type="button"
              onClick={() =>
                triggerDownload(formatEntryAsMarkdown(entry), `${safeSlug}.md`, 'text/markdown')
              }
              className="py-2.5 px-3 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>
            <button
              type="button"
              onClick={() =>
                triggerDownload(formatEntryAsJson(entry), `${safeSlug}.json`, 'application/json')
              }
              className="py-2.5 px-3 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="py-2.5 px-3 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>PDF / Print</span>
            </button>
            {entry.audioUrl && (
              <a
                href={entry.audioUrl}
                download={`${safeSlug}.wav`}
                className="col-span-2 sm:col-span-2 py-2.5 px-3 rounded-xl bg-[#6839D3]/15 border border-[#D4A44B]/30 text-[#6839D3] dark:text-[#E5B85C] text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Original Audio (.wav)</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
