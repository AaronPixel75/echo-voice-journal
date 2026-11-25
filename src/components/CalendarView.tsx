import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Star } from 'lucide-react';
import { ANIME_PAGODA_URL, EmptyCalendarIllustration, HandDrawnGoldUnderline } from './EditorialIllustrations';
import { formatTimestamp } from '../utils/transcriptUtils';
import type { JournalEntry } from '../types/echo';

interface CalendarViewProps {
  entries: JournalEntry[];
  initialDayRequest?: { dayKey: string; seq: number } | null;
  onOpenEntry: (entryId: string) => void;
  onStartRecording: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({
  entries,
  initialDayRequest,
  onOpenEntry,
  onStartRecording,
}: CalendarViewProps) {
  const today = new Date();
  const initialKey = initialDayRequest?.dayKey || today.toISOString().slice(0, 10);
  const [cursor, setCursor] = useState(() => {
    const dt = new Date(`${initialKey}T12:00:00`);
    return Number.isNaN(dt.getTime())
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : new Date(dt.getFullYear(), dt.getMonth(), 1);
  });
  const [selectedDayKey, setSelectedDayKey] = useState<string>(initialKey);

  useEffect(() => {
    if (!initialDayRequest?.dayKey) return;
    setSelectedDayKey(initialDayRequest.dayKey);
    const dt = new Date(`${initialDayRequest.dayKey}T12:00:00`);
    if (!Number.isNaN(dt.getTime())) {
      setCursor(new Date(dt.getFullYear(), dt.getMonth(), 1));
    }
  }, [initialDayRequest]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const entriesByDate = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const entry of entries) {
      if (entry.isArchived) continue;
      const key = entry.createdAt.slice(0, 10);
      const list = map.get(key) || [];
      list.push(entry);
      map.set(key, list);
    }
    return map;
  }, [entries]);

  const calendarCells = useMemo(() => {
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number | null; key: string | null }> = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ day: null, key: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ day: d, key });
    }
    return cells;
  }, [year, month]);

  const monthStats = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthEntries = entries.filter((e) => !e.isArchived && e.createdAt.startsWith(prefix));
    const totalMs = monthEntries.reduce((s, e) => s + (e.durationMs || 0), 0);
    const activeDays = new Set(monthEntries.map((e) => e.createdAt.slice(0, 10))).size;
    return {
      count: monthEntries.length,
      minutes: Math.round(totalMs / 60000),
      activeDays,
    };
  }, [entries, year, month]);

  const selectedEntries = entriesByDate.get(selectedDayKey) || [];
  const selectedLabel = new Date(`${selectedDayKey}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="space-y-8 pb-12 animate-paper-unfold">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-editorial text-3xl font-bold">Memory Calendar</h1>
            <HandDrawnGoldUnderline className="w-24 h-2.5 hidden sm:block" />
          </div>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
            Select any highlighted day to revisit your recordings and written reflections.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
          <span>{monthStats.count} entries</span>
          <span aria-hidden="true">·</span>
          <span>{monthStats.activeDays} active days</span>
          <span aria-hidden="true">·</span>
          <span>{monthStats.minutes}m audio</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Monthly Grid */}
        <div className="lg:col-span-7 paper-card rounded-3xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <h2 className="font-editorial text-xl font-bold">
              {cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h2>

            <button
              type="button"
              aria-label="Next month"
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-[#5A5248] dark:text-[#B6AC9A]">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell, idx) => {
              if (!cell.day || !cell.key) {
                return <div key={`empty-${idx}`} className="h-12" />;
              }
              const dayEntries = entriesByDate.get(cell.key) || [];
              const hasEntries = dayEntries.length > 0;
              const isSelected = cell.key === selectedDayKey;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDayKey(cell.key!)}
                  className={`h-12 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer relative ${
                    isSelected
                      ? 'bg-[#6839D3] text-[#F5EEDB] font-bold shadow-md shadow-[#6839D3]/30 ring-1 ring-[#D4A44B]'
                      : hasEntries
                        ? 'bg-[#D4A44B]/18 hover:bg-[#D4A44B]/28 font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 text-[#5A5248] dark:text-[#B6AC9A]'
                  }`}
                >
                  <span className="font-mono-meta text-sm tabular-nums">{cell.day}</span>
                  {hasEntries && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isSelected ? 'bg-[#E5B85C]' : 'bg-[#6839D3] dark:bg-[#E5B85C]'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Day Entries + Showcase Sakura Pagoda Artwork */}
        <div className="lg:col-span-5 paper-card rounded-3xl overflow-hidden">
          <div className="relative h-32 bg-[#0D0C14] torn-edge-bottom">
            <img
              src={ANIME_PAGODA_URL}
              alt="Sakura pagoda calendar illustration"
              className="w-full h-full object-cover opacity-85"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0D0C14]/85 via-[#0D0C14]/35 to-transparent" />
            <div className="absolute bottom-3 left-5 right-5 flex items-center justify-between text-[#F5EEDB]">
              <h3 className="font-editorial text-lg font-bold">{selectedLabel}</h3>
              <span className="font-mono-meta text-xs text-[#E5B85C]">
                {selectedEntries.length} {selectedEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {selectedEntries.length === 0 ? (
              <div className="py-6 text-center space-y-4">
                <EmptyCalendarIllustration className="w-44 h-28 mx-auto" />
                <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
                  No entries recorded on this day.
                </p>
                <button
                  type="button"
                  onClick={onStartRecording}
                  className="px-4 py-2.5 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer"
                >
                  Capture a Thought Now
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onOpenEntry(entry.id)}
                    className="w-full text-left p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/18 hover:border-[#D4A44B] transition-colors flex items-center gap-3.5 cursor-pointer"
                  >
                    {entry.coverImage && (
                      <img
                        src={entry.coverImage}
                        alt={entry.title}
                        className="w-16 h-16 rounded-xl object-cover shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-editorial font-bold text-base truncate">{entry.title}</h4>
                        {entry.isFavorite && (
                          <Star className="w-3.5 h-3.5 fill-[#D4A44B] text-[#D4A44B] shrink-0" />
                        )}
                      </div>
                      <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-1 flex items-center gap-2">
                        {entry.durationMs > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimestamp(entry.durationMs)}
                          </span>
                        )}
                        <span>· {entry.tags.length} tags</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
