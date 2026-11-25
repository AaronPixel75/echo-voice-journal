import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Bookmark,
  BookOpen,
  Clock,
  FolderPlus,
  Mic,
  Pin,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { ANIME_PAGODA_URL, EmptyJournalIllustration, HandDrawnGoldUnderline } from './EditorialIllustrations';
import { formatTimestamp } from '../utils/transcriptUtils';
import type { JournalEntry, Notebook } from '../types/echo';

interface JournalTimelineProps {
  entries: JournalEntry[];
  notebooks: Notebook[];
  initialNotebookRequest?: { notebookId: string; seq: number } | null;
  onOpenEntry: (entryId: string) => void;
  onToggleFavorite: (entry: JournalEntry) => void;
  onCreateNotebook: (payload: { name: string; description: string; color: string }) => Promise<void>;
  onDeleteNotebook: (id: string) => Promise<void>;
  onStartRecording: () => void;
  onCreateTextNote: () => void;
}

type GroupBy = 'day' | 'week' | 'month';
type FilterMode = 'all' | 'favorites' | 'pinned' | 'bookmarked' | 'archived';

export function JournalTimeline({
  entries,
  notebooks,
  initialNotebookRequest,
  onOpenEntry,
  onToggleFavorite,
  onCreateNotebook,
  onDeleteNotebook,
  onStartRecording,
  onCreateTextNote,
}: JournalTimelineProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>(
    initialNotebookRequest?.notebookId || 'all'
  );
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [nbName, setNbName] = useState('');
  const [nbDesc, setNbDesc] = useState('');
  const [nbColor, setNbColor] = useState('#8557F6');

  useEffect(() => {
    if (initialNotebookRequest) {
      setSelectedNotebookId(initialNotebookRequest.notebookId);
      setFilterMode('all');
      setSelectedTag('all');
    }
  }, [initialNotebookRequest]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => e.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterMode === 'archived') {
        if (!e.isArchived) return false;
      } else {
        if (e.isArchived) return false;
        if (filterMode === 'favorites' && !e.isFavorite) return false;
        if (filterMode === 'pinned' && !e.isPinned) return false;
        if (filterMode === 'bookmarked' && e.bookmarks.length === 0) return false;
      }
      if (selectedNotebookId !== 'all' && e.notebookId !== selectedNotebookId) return false;
      if (selectedTag !== 'all' && !e.tags.includes(selectedTag)) return false;
      return true;
    });
  }, [entries, filterMode, selectedNotebookId, selectedTag]);

  const grouped = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const entry of filtered) {
      const dt = new Date(entry.createdAt);
      let key = '';
      if (groupBy === 'day') {
        key = dt.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
      } else if (groupBy === 'week') {
        const start = new Date(dt);
        start.setDate(dt.getDate() - dt.getDay());
        key = `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      } else {
        key = dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      }
      const list = map.get(key) || [];
      list.push(entry);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered, groupBy]);

  const handleCreateNotebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nbName.trim()) return;
    await onCreateNotebook({ name: nbName.trim(), description: nbDesc.trim(), color: nbColor });
    setNbName('');
    setNbDesc('');
    setShowNotebookForm(false);
  };

  return (
    <div className="space-y-8 pb-12 animate-paper-unfold">
      {/* Header & Notebooks Strip */}
      <div className="paper-card rounded-3xl p-6 md:p-7 relative overflow-hidden">
        <img
          src={ANIME_PAGODA_URL}
          alt=""
          aria-hidden="true"
          className="hidden md:block absolute right-0 top-0 h-full w-64 object-cover opacity-20 dark:opacity-25 pointer-events-none select-none torn-edge-right"
        />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-editorial text-3xl font-bold">Journal &amp; Notebooks</h1>
              <HandDrawnGoldUnderline className="w-24 h-2.5 hidden sm:block" />
            </div>
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1 max-w-xl">
              Browse your spoken and written archive across notebooks, collections, and time.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowNotebookForm((v) => !v)}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#FAF5E8] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/25 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderPlus className="w-4 h-4 text-[#D4A44B]" />
              <span>New Notebook</span>
            </button>
            <button
              type="button"
              onClick={onCreateTextNote}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#6839D3] hover:bg-[#5A2EC0] text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#E5B85C]" />
              <span>Text Note</span>
            </button>
          </div>
        </div>
      </div>

      {showNotebookForm && (
        <form
          onSubmit={handleCreateNotebook}
          className="paper-card rounded-2xl p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
        >
          <div className="md:col-span-4">
            <label htmlFor="nb-name" className="block text-xs font-medium mb-1">
              Notebook name
            </label>
            <input
              id="nb-name"
              type="text"
              required
              value={nbName}
              onChange={(e) => setNbName(e.target.value)}
              placeholder="e.g. Travel Dispatches"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            />
          </div>
          <div className="md:col-span-5">
            <label htmlFor="nb-desc" className="block text-xs font-medium mb-1">
              Description
            </label>
            <input
              id="nb-desc"
              type="text"
              value={nbDesc}
              onChange={(e) => setNbDesc(e.target.value)}
              placeholder="Optional notebook theme"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            />
          </div>
          <div className="md:col-span-3 flex items-center gap-2">
            <input
              type="color"
              aria-label="Notebook colour"
              value={nbColor}
              onChange={(e) => setNbColor(e.target.value)}
              className="w-10 h-10 rounded-lg cursor-pointer bg-transparent"
            />
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-sm font-semibold cursor-pointer"
            >
              Create
            </button>
          </div>
        </form>
      )}

      {/* Notebooks Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => setSelectedNotebookId('all')}
          className={`p-4 rounded-2xl border text-left transition-colors cursor-pointer ${
            selectedNotebookId === 'all'
              ? 'bg-[#6839D3]/10 border-[#D4A44B]'
              : 'paper-card hover:border-[#D4A44B]/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <BookOpen className="w-4 h-4 text-[#D4A44B]" />
            <span className="font-mono-meta text-xs tabular-nums">
              {entries.filter((e) => !e.isArchived).length}
            </span>
          </div>
          <div className="font-editorial font-bold text-base mt-3">All Notebooks</div>
          <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">Combined timeline</div>
        </button>

        {notebooks.map((nb) => {
          const count = entries.filter((e) => !e.isArchived && e.notebookId === nb.id).length;
          return (
            <div
              key={nb.id}
              className={`relative p-4 rounded-2xl border transition-colors ${
                selectedNotebookId === nb.id
                  ? 'bg-[#6839D3]/10 border-[#D4A44B]'
                  : 'paper-card hover:border-[#D4A44B]/60'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedNotebookId(nb.id)}
                className="w-full text-left cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: nb.color }}
                    aria-hidden="true"
                  />
                  <span className="font-mono-meta text-xs tabular-nums">{count}</span>
                </div>
                <div className="font-editorial font-bold text-base mt-3 truncate">{nb.name}</div>
                <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A] truncate">
                  {nb.description || 'Custom notebook'}
                </div>
              </button>
              {nb.id !== 'nb-daily' && (
                <button
                  type="button"
                  aria-label={`Delete notebook ${nb.name}`}
                  onClick={() => void onDeleteNotebook(nb.id)}
                  className="absolute bottom-3 right-3 p-1.5 rounded-lg text-[#5A5248] hover:text-[#E27A48] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Filters & Grouping Bar */}
      <div className="paper-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-3">
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'favorites', label: 'Favourites' },
              { id: 'pinned', label: 'Pinned' },
              { id: 'bookmarked', label: 'Bookmarked' },
              { id: 'archived', label: 'Archived' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterMode(f.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                filterMode === f.id
                  ? 'bg-[#6839D3] text-[#F5EEDB]'
                  : 'text-[#5A5248] dark:text-[#B6AC9A] hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {allTags.length > 0 && (
            <select
              aria-label="Filter by tag"
              value={selectedTag}
              onChange={(e) => setSelectedTag(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-xs"
            >
              <option value="all">All tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EFE4C9] dark:bg-[#0D0C14]">
            {(['day', 'week', 'month'] as GroupBy[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroupBy(g)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize cursor-pointer ${
                  groupBy === g
                    ? 'bg-[#FAF5E8] dark:bg-[#211E31] text-[#14121D] dark:text-[#E5B85C] shadow-sm'
                    : 'text-[#5A5248] dark:text-[#B6AC9A]'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Groups */}
      {grouped.length === 0 ? (
        <div className="paper-card rounded-3xl p-10 text-center flex flex-col items-center gap-4">
          <EmptyJournalIllustration className="w-52 h-36" />
          <div className="space-y-1">
            <h3 className="font-editorial text-xl font-bold">No matching entries</h3>
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
              Adjust your filters or record a new thought to populate this view.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartRecording}
            className="py-2.5 px-5 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Mic className="w-4 h-4 text-[#E5B85C]" />
            <span>Start Recording</span>
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(([dateLabel, groupEntries]) => (
            <section key={dateLabel} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="font-editorial text-base font-bold">{dateLabel}</h2>
                <span className="h-px flex-1 bg-black/10 dark:bg-[#D4A44B]/18" />
                <span className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                  {groupEntries.length} {groupEntries.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {groupEntries.map((entry) => (
                  <article
                    key={entry.id}
                    onClick={() => onOpenEntry(entry.id)}
                    className="paper-card hover:border-[#D4A44B] rounded-2xl p-4 flex gap-4 cursor-pointer transition-colors"
                  >
                    {entry.coverImage && (
                      <img
                        src={entry.coverImage}
                        alt={entry.title}
                        referrerPolicy="no-referrer"
                        className="w-24 h-24 rounded-xl object-cover shrink-0 bg-[#0D0C14]"
                      />
                    )}
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] flex items-center gap-1.5">
                            <span>
                              {new Date(entry.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            {entry.durationMs > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatTimestamp(entry.durationMs)}
                                </span>
                              </>
                            )}
                            {entry.isPinned && <Pin className="w-3 h-3 text-[#6839D3] dark:text-[#E5B85C]" />}
                            {entry.isArchived && <Archive className="w-3 h-3 text-[#E27A48]" />}
                          </div>

                          <button
                            type="button"
                            aria-label={entry.isFavorite ? 'Remove favourite' : 'Favourite entry'}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onToggleFavorite(entry);
                            }}
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                entry.isFavorite
                                  ? 'fill-[#D4A44B] text-[#D4A44B]'
                                  : 'text-[#5A5248] dark:text-[#B6AC9A]'
                              }`}
                            />
                          </button>
                        </div>

                        <h3 className="font-editorial text-base font-bold truncate mt-0.5">
                          {entry.title}
                        </h3>
                        <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] line-clamp-2 mt-1">
                          {entry.transcriptText || 'Audio recording'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-[#5A5248] dark:text-[#B6AC9A]">
                        <span className="truncate">
                          {entry.tags.length > 0 ? `#${entry.tags.join(' · #')}` : entry.category}
                        </span>
                        {entry.bookmarks.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[#D4A44B] shrink-0">
                            <Bookmark className="w-3 h-3" />
                            {entry.bookmarks.length}
                          </span>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
