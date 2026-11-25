import React, { useMemo, useState } from 'react';
import {
  BrainCircuit,
  Calendar,
  Clock,
  FileText,
  Mic,
  Pause,
  Play,
  Search,
  Sparkles,
  Star,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  ANIME_COURTYARD_URL,
  ANIME_HERO_URL,
  EmptyJournalIllustration,
  HandDrawnGoldUnderline,
} from './EditorialIllustrations';
import { computeWeeklyDigest } from '../utils/localIntelligence';
import { formatTimestamp } from '../utils/transcriptUtils';
import type { EchoSettings, JournalEntry, Notebook } from '../types/echo';

interface HomeDashboardProps {
  entries: JournalEntry[];
  notebooks: Notebook[];
  settings: EchoSettings;
  onStartRecording: () => void;
  onCreateTextNote: () => void;
  onOpenEntry: (entryId: string) => void;
  onToggleFavorite: (entry: JournalEntry) => void;
  onNavigate: (tab: 'journal' | 'calendar' | 'search' | 'models' | 'memories') => void;
}

export function HomeDashboard({
  entries,
  notebooks,
  settings,
  onStartRecording,
  onCreateTextNote,
  onOpenEntry,
  onToggleFavorite,
  onNavigate,
}: HomeDashboardProps) {
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl] = useState<HTMLAudioElement | null>(() =>
    typeof Audio !== 'undefined' ? new Audio() : null
  );

  const activeEntries = useMemo(() => entries.filter((e) => !e.isArchived), [entries]);
  const recentEntries = useMemo(() => activeEntries.slice(0, 6), [activeEntries]);

  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good morning';
    if (hr < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const todayFormatted = useMemo(
    () =>
      new Date().toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    []
  );

  const stats = useMemo(() => {
    const totalMs = activeEntries.reduce((sum, e) => sum + (e.durationMs || 0), 0);
    const totalMins = Math.max(1, Math.round(totalMs / 60000));
    const goalPct = Math.min(100, Math.round((totalMins / Math.max(1, settings.dailyGoalMinutes)) * 100));
    return {
      totalEntries: activeEntries.length,
      totalMinutes: totalMins,
      goalPct,
    };
  }, [activeEntries, settings.dailyGoalMinutes]);

  const weeklyDigest = useMemo(() => computeWeeklyDigest(activeEntries.slice(0, 10)), [activeEntries]);

  const handleQuickPlay = (e: React.MouseEvent, entry: JournalEntry) => {
    e.stopPropagation();
    if (!audioEl || !entry.audioUrl) return;
    if (playingId === entry.id) {
      audioEl.pause();
      setPlayingId(null);
      return;
    }
    audioEl.src = entry.audioUrl;
    audioEl.onended = () => setPlayingId(null);
    void audioEl.play().then(() => setPlayingId(entry.id)).catch(() => setPlayingId(null));
  };

  const handleParallax = (e: React.MouseEvent<HTMLDivElement>) => {
    if (settings.reducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width - 0.5) * 10;
    const y = ((e.clientY - rect.top) / rect.height - 0.5) * 10;
    setParallax({ x, y });
  };

  const getNotebookName = (id: string) => notebooks.find((n) => n.id === id)?.name || 'Journal';

  return (
    <div className="space-y-8 pb-12 animate-paper-unfold">
      {/* Editorial Parchment Masthead + Atmospheric Backdrop */}
      <section
        onMouseMove={handleParallax}
        onMouseLeave={() => setParallax({ x: 0, y: 0 })}
        className="paper-card rounded-3xl p-6 md:p-8 relative overflow-hidden"
      >
        {/* Subtle ink landscape atmosphere behind parchment */}
        <img
          src={ANIME_COURTYARD_URL}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-[0.13] dark:opacity-[0.14] pointer-events-none select-none transition-transform duration-300"
          style={{
            transform: settings.reducedMotion
              ? undefined
              : `scale(1.05) translate(${parallax.x}px, ${parallax.y}px)`,
          }}
        />

        <div className="relative z-10 space-y-7">
          {/* Masthead row */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <h1 className="font-editorial text-3xl md:text-5xl font-bold tracking-tight">
                {greeting}, {settings.userName}
              </h1>
              <p className="font-editorial italic text-base md:text-lg text-[#5A5248] dark:text-[#B6AC9A]">
                Another day, another story…
              </p>
            </div>

            <div className="text-right font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              <div className="font-semibold text-[#14121D] dark:text-[#F5EEDB]">{todayFormatted}</div>
              <div>100% Local Offline Vault</div>
            </div>
          </div>

          {/* 3 Metric Paper Cards + Editorial Quote Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <div className="lg:col-span-7 grid grid-cols-3 gap-3.5">
              <div className="paper-card rounded-2xl p-4 md:p-5 flex flex-col justify-between">
                <Mic className="w-4 h-4 text-[#6839D3] dark:text-[#BBA9FF]" />
                <div className="mt-3">
                  <div className="font-editorial text-2xl md:text-3xl font-bold tabular-nums">
                    {stats.totalEntries}
                  </div>
                  <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
                    Entries Saved
                  </div>
                </div>
              </div>

              <div className="paper-card rounded-2xl p-4 md:p-5 flex flex-col justify-between">
                <Clock className="w-4 h-4 text-[#D4A44B]" />
                <div className="mt-3">
                  <div className="font-editorial text-2xl md:text-3xl font-bold tabular-nums">
                    {stats.totalMinutes}m
                  </div>
                  <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
                    Audio Archive
                  </div>
                </div>
              </div>

              <div className="paper-card rounded-2xl p-4 md:p-5 flex flex-col justify-between">
                <Star className="w-4 h-4 text-[#E27A48]" />
                <div className="mt-3">
                  <div className="font-editorial text-2xl md:text-3xl font-bold tabular-nums">
                    {stats.goalPct}%
                  </div>
                  <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
                    Daily Goal
                  </div>
                </div>
              </div>
            </div>

            {/* Midnight Luxury Editorial Quote Card */}
            <div className="lg:col-span-5 rounded-2xl overflow-hidden relative bg-[#110F18] text-[#F5EEDB] border border-[#D4A44B]/30 p-5 md:p-6 flex flex-col justify-center">
              <img
                src={ANIME_HERO_URL}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover opacity-35"
              />
              <div className="relative z-10 space-y-1.5">
                <p className="font-editorial italic text-xl md:text-2xl leading-snug">
                  “Dream bigger, build better.”
                </p>
                <p className="font-mono-meta text-xs text-[#E5B85C]">— ECHO Journal</p>
              </div>
            </div>
          </div>

          {/* Central Glowing Recording Orb + Quick Actions Layered Paper Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pt-1">
            <div className="lg:col-span-7 flex flex-col items-center justify-center py-4 text-center space-y-3">
              <button
                type="button"
                onClick={onStartRecording}
                aria-label="Start Recording"
                className="group relative w-28 h-28 rounded-full bg-gradient-to-br from-[#8557F6] via-[#5B32B8] to-[#1D123B] border-2 border-[#D4A44B]/70 shadow-2xl shadow-[#6839D3]/35 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
              >
                <span className="absolute -inset-3 rounded-full border border-[#D4A44B]/35 pointer-events-none" />
                <span className="absolute -inset-6 rounded-full border border-[#6839D3]/20 pointer-events-none" />
                <Mic className="w-10 h-10 text-[#F5EEDB]" />
              </button>
              <div>
                <div className="font-editorial text-xl font-bold">Tap to Record</div>
                <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                  Speak your thoughts… saved locally before transcription.
                </p>
              </div>
            </div>

            <div className="lg:col-span-5 paper-card rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between px-1 pb-1 border-b border-black/8 dark:border-[#D4A44B]/15">
                <span className="font-editorial text-sm font-bold">Quick Actions</span>
                <HandDrawnGoldUnderline className="w-16 h-2" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onStartRecording}
                  className="p-2.5 rounded-xl bg-[#6839D3]/10 hover:bg-[#6839D3]/20 text-left text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Mic className="w-4 h-4 text-[#6839D3] dark:text-[#BBA9FF] shrink-0" />
                  <span className="truncate">New Recording</span>
                </button>
                <button
                  type="button"
                  onClick={onCreateTextNote}
                  className="p-2.5 rounded-xl bg-[#D4A44B]/15 hover:bg-[#D4A44B]/25 text-left text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-[#B68224] dark:text-[#E5B85C] shrink-0" />
                  <span className="truncate">New Note</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-left text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Calendar className="w-4 h-4 text-[#E27A48] shrink-0" />
                  <span className="truncate">Open Calendar</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('search')}
                  className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 text-left text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Search className="w-4 h-4 text-[#6839D3] dark:text-[#BBA9FF] shrink-0" />
                  <span className="truncate">Search Entries</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('memories')}
                  className="col-span-2 p-2.5 rounded-xl bg-gradient-to-r from-[#6839D3]/15 to-[#D4A44B]/15 hover:from-[#6839D3]/25 hover:to-[#D4A44B]/25 border border-[#D4A44B]/30 text-left text-xs font-semibold flex items-center justify-between gap-2 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <BrainCircuit className="w-4 h-4 text-[#6839D3] dark:text-[#E5B85C] shrink-0" />
                    <span>Ask My Memories (On-Device Gemma)</span>
                  </span>
                  <span className="font-mono-meta text-[11px] text-[#6839D3] dark:text-[#E5B85C]">Offline →</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Offline Weekly Editorial Reflection */}
      <section className="paper-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#6839D3] dark:text-[#E5B85C]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Offline Editorial Reflection</span>
          </div>
          <p className="font-editorial text-lg md:text-xl leading-relaxed">
            {weeklyDigest.reflectionPrompt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {weeklyDigest.topThemes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              {weeklyDigest.topThemes.slice(0, 3).map((theme, idx) => (
                <React.Fragment key={theme.topic}>
                  <span>#{theme.topic} ({theme.count})</span>
                  {idx < Math.min(2, weeklyDigest.topThemes.length - 1) && <span aria-hidden="true">·</span>}
                </React.Fragment>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => onNavigate('memories')}
            className="px-3.5 py-2 rounded-xl bg-[#6839D3]/15 hover:bg-[#6839D3]/25 border border-[#D4A44B]/30 text-xs font-semibold text-[#6839D3] dark:text-[#E5B85C] cursor-pointer whitespace-nowrap"
          >
            Ask My Memories →
          </button>
        </div>
      </section>

      {/* Recent Journal Entries */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-editorial text-2xl md:text-3xl font-bold">Recent Entries</h2>
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
              Layered paper stories ready for listening, highlighting, and revision.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('journal')}
            className="text-sm font-semibold text-[#6839D3] dark:text-[#E5B85C] hover:underline cursor-pointer whitespace-nowrap"
          >
            View All →
          </button>
        </div>

        {recentEntries.length === 0 ? (
          <div className="paper-card rounded-3xl p-10 text-center flex flex-col items-center gap-4">
            <EmptyJournalIllustration className="w-56 h-40" />
            <div className="space-y-1 max-w-md">
              <h3 className="font-editorial text-xl font-bold">Your notebook awaits</h3>
              <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
                Tap the orb above to speak your first entry or draft a written page.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {recentEntries.map((entry, idx) => {
              const isFeatured = idx === 0 && Boolean(entry.coverImage);
              const formattedDate = new Date(entry.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              const formattedTime = new Date(entry.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <article
                  key={entry.id}
                  onClick={() => onOpenEntry(entry.id)}
                  className={`group paper-card hover:border-[#D4A44B] rounded-2xl overflow-hidden transition-all cursor-pointer flex flex-col justify-between ${
                    isFeatured ? 'md:col-span-2 lg:col-span-2' : ''
                  }`}
                >
                  {entry.coverImage && (
                    <div className={`relative overflow-hidden bg-[#110F18] torn-edge-bottom ${isFeatured ? 'h-56' : 'h-40'}`}>
                      <img
                        src={entry.coverImage}
                        alt={entry.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                      {entry.audioUrl && (
                        <button
                          type="button"
                          aria-label={playingId === entry.id ? `Pause ${entry.title}` : `Play ${entry.title}`}
                          onClick={(ev) => handleQuickPlay(ev, entry)}
                          className="absolute bottom-4 right-4 w-11 h-11 rounded-full bg-[#110F18]/85 hover:bg-[#6839D3] border border-[#D4A44B]/60 text-[#F5EEDB] flex items-center justify-center backdrop-blur-sm transition-colors cursor-pointer"
                        >
                          {playingId === entry.id ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 ml-0.5" />
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="p-5 flex-1 flex flex-col justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#5A5248] dark:text-[#B6AC9A] font-mono-meta">
                          <span>{formattedDate}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formattedTime}</span>
                          {entry.durationMs > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{formatTimestamp(entry.durationMs)}</span>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          aria-label={
                            entry.isFavorite
                              ? `Remove ${entry.title} from favourites`
                              : `Favourite ${entry.title}`
                          }
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onToggleFavorite(entry);
                          }}
                          className="min-w-[38px] min-h-[38px] -mr-1.5 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
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

                      <h3 className="font-editorial text-xl font-bold leading-snug group-hover:text-[#6839D3] dark:group-hover:text-[#E5B85C] transition-colors">
                        {entry.title}
                      </h3>

                      <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] line-clamp-2 leading-relaxed">
                        {entry.transcriptText || 'Audio recording saved locally. Click to listen or edit.'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-black/8 dark:border-[#D4A44B]/15 text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                      <span className="truncate">
                        {getNotebookName(entry.notebookId)}
                        {entry.tags.length > 0 ? ` · #${entry.tags.slice(0, 2).join(' · #')}` : ''}
                      </span>

                      {entry.transcriptionStatus === 'processing' || entry.transcriptionStatus === 'pending' ? (
                        <span className="inline-flex items-center gap-1 text-[#6839D3] dark:text-[#BBA9FF] whitespace-nowrap">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Transcribing
                        </span>
                      ) : entry.transcriptionStatus === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-[#E27A48] whitespace-nowrap">
                          <AlertCircle className="w-3 h-3" />
                          Audio safe · Retry
                        </span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
