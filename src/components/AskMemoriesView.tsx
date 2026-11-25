import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  Calendar,
  Clock,
  FileSearch,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { echoApi } from '../services/echoApi';
import { describeProviderLabel } from '../utils/onDeviceAi';
import type {
  AiModelInfo,
  AiResponseLength,
  AiRuntimeInfo,
  AskMemoriesResult,
  EchoSettings,
  PeriodicReflectionResult,
} from '../types/echo';

interface AskMemoriesViewProps {
  settings: EchoSettings;
  aiModels: AiModelInfo[];
  aiRuntime: AiRuntimeInfo;
  onOpenEntry: (entryId: string) => void;
  onNavigateSettings: () => void;
  onNavigateSearch: () => void;
}

const STARTER_PROMPTS = [
  'What ideas did I discuss last month?',
  'What projects have I been thinking about?',
  'What goals did I mention?',
  'Find entries where I discussed clarity or mountain',
  'What recurring topics appear in my journal?',
];

export function AskMemoriesView({
  settings,
  aiModels,
  aiRuntime,
  onOpenEntry,
  onNavigateSettings,
  onNavigateSearch,
}: AskMemoriesViewProps) {
  const [question, setQuestion] = useState('');
  const [responseLength, setResponseLength] = useState<AiResponseLength>(
    settings.aiResponseLength || 'balanced'
  );
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<AskMemoriesResult | null>(null);

  const [reflectionPeriod, setReflectionPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [reflectionLoading, setReflectionLoading] = useState(false);
  const [reflection, setReflection] = useState<PeriodicReflectionResult | null>(null);

  const activeLlm = aiModels.find((m) => m.family !== 'embedding-gemma' && m.status === 'active');
  const providerLabel = describeProviderLabel(settings.aiProviderPreference, activeLlm?.name);

  useEffect(() => {
    setResponseLength(settings.aiResponseLength || 'balanced');
  }, [settings.aiResponseLength]);

  useEffect(() => {
    if (!settings.aiEnabled) {
      setReflection(null);
      return;
    }
    let cancelled = false;
    setReflectionLoading(true);
    void echoApi
      .getPeriodicReflection(reflectionPeriod)
      .then((res) => {
        if (!cancelled) setReflection(res);
      })
      .catch(() => {
        if (!cancelled) setReflection(null);
      })
      .finally(() => {
        if (!cancelled) setReflectionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reflectionPeriod, settings.aiEnabled]);

  const handleAsk = async (promptOverride?: string) => {
    const q = (promptOverride ?? question).trim();
    if (!q) return;
    if (promptOverride !== undefined) setQuestion(q);
    setAsking(true);
    setAskError(null);
    try {
      const res = await echoApi.askMyMemories(q, responseLength);
      setAskResult(res);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Unable to query local memories.');
    } finally {
      setAsking(false);
    }
  };

  if (!settings.aiEnabled) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 pb-12 animate-paper-unfold">
        <div>
          <h1 className="font-editorial text-3xl font-bold">Ask My Memories</h1>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
            Private, on-device journal synthesis powered by Google Gemma &amp; LiteRT-LM.
          </p>
        </div>

        <section className="paper-card rounded-3xl p-8 space-y-4 text-center max-w-2xl mx-auto">
          <BrainCircuit className="w-10 h-10 text-[#D4A44B] mx-auto" />
          <h2 className="font-editorial text-2xl font-bold">On-Device AI is Turned Off</h2>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
            ECHO continues recording audio, running offline transcription, and indexing SQLite FTS5 keyword search with zero AI enabled. Re-enable local AI anytime in Settings to ask questions across your journal.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={onNavigateSettings}
              className="px-4 py-2.5 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Enable Local AI in Settings
            </button>
            <button
              type="button"
              onClick={onNavigateSearch}
              className="px-4 py-2.5 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Use Offline FTS5 Search
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 animate-paper-unfold">
      {/* Header & Local Status */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial text-3xl font-bold">Ask My Memories</h1>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
            Offline retrieval-augmented memory synthesis with verifiable entry &amp; timestamp citations.
          </p>
        </div>

        <div className="paper-card rounded-2xl px-4 py-2.5 flex flex-wrap items-center gap-3 text-xs font-mono-meta">
          <span className="inline-flex items-center gap-1.5 text-[#6839D3] dark:text-[#E5B85C] font-semibold">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>{providerLabel}</span>
          </span>
          <span aria-hidden="true" className="opacity-40">·</span>
          <span>{aiRuntime.embeddingCount} indexed</span>
          <span aria-hidden="true" className="opacity-40">·</span>
          <span>{aiRuntime.cloudRequestsMade} cloud calls</span>
        </div>
      </div>

      {settings.simulateAiLowMemory && (
        <div className="p-4 rounded-2xl bg-[#E27A48]/15 border border-[#E27A48]/45 flex items-center gap-3 text-xs">
          <AlertCircle className="w-4 h-4 text-[#E27A48] shrink-0" />
          <span>
            Low-memory simulation is active in Settings. Heavy generative inference is paused cleanly while direct local retrieval and audio recording remain unaffected.
          </span>
        </div>
      )}

      {/* Ask Form */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleAsk();
          }}
          className="space-y-3"
        >
          <label htmlFor="ask-memories-input" className="block text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
            Query Your Private Journal
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="ask-memories-input"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about past ideas, projects, goals, or recurring themes…"
              className="flex-1 px-4 py-3.5 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/25 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A44B]"
            />

            <div className="flex items-center gap-2 shrink-0">
              <select
                aria-label="Response length"
                value={responseLength}
                onChange={(e) => setResponseLength(e.target.value as AiResponseLength)}
                className="px-3 py-3.5 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/25 text-xs font-medium cursor-pointer"
              >
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>

              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="px-5 py-3.5 rounded-2xl bg-gradient-to-r from-[#6839D3] to-[#522AA8] hover:from-[#7546E0] hover:to-[#5C31B8] disabled:opacity-50 border border-[#D4A44B]/40 text-[#F5EEDB] text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {asking ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 text-[#E5B85C]" />
                )}
                <span>Ask Offline</span>
              </button>
            </div>
          </div>
        </form>

        {/* Suggested Prompts */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">Try asking:</span>
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void handleAsk(prompt)}
              className="px-3 py-1.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 text-xs font-medium transition-colors cursor-pointer text-left"
            >
              {prompt}
            </button>
          ))}
        </div>

        {askError && (
          <div className="p-3.5 rounded-xl bg-[#E27A48]/15 border border-[#E27A48]/40 text-xs text-[#E27A48]">
            {askError}
          </div>
        )}
      </section>

      {/* Answer & Verifiable Citations */}
      {askResult && (
        <section className="paper-card rounded-3xl p-6 space-y-5 border-[#D4A44B]/40">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-black/8 dark:border-[#D4A44B]/18">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#6839D3] dark:text-[#E5B85C]">
              <Sparkles className="w-4 h-4" />
              <span>{askResult.providerLabel}</span>
            </div>
            <span className="font-mono-meta text-[11px] text-[#5A5248] dark:text-[#B6AC9A]">
              {askResult.groundingNotice}
            </span>
          </div>

          <div className="font-editorial text-base md:text-lg leading-relaxed whitespace-pre-line">
            {askResult.answer}
          </div>

          {askResult.citations.length > 0 && (
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
                <FileSearch className="w-3.5 h-3.5 text-[#D4A44B]" />
                <span>Source Citations ({askResult.citations.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {askResult.citations.map((cit, idx) => (
                  <button
                    key={`${cit.entryId}-${idx}`}
                    type="button"
                    onClick={() => onOpenEntry(cit.entryId)}
                    className="text-left p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] hover:border-[#D4A44B] border border-black/10 dark:border-[#D4A44B]/20 space-y-1.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-editorial font-bold text-sm truncate">
                        {cit.entryTitle}
                      </span>
                      <ArrowRight className="w-4 h-4 text-[#D4A44B] shrink-0" />
                    </div>
                    <div className="font-mono-meta text-[11px] text-[#5A5248] dark:text-[#B6AC9A] flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(cit.createdAt).toLocaleDateString()}
                      </span>
                      {cit.timestampLabel && (
                        <span className="inline-flex items-center gap-1 text-[#6839D3] dark:text-[#E5B85C] font-semibold">
                          <Clock className="w-3 h-3" />
                          {cit.timestampLabel}
                        </span>
                      )}
                      <span>· {cit.matchSource}</span>
                    </div>
                    <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] line-clamp-2 leading-relaxed">
                      “{cit.excerpt}”
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Daily, Weekly & Monthly Offline Reflections */}
      <section className="paper-card rounded-3xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-editorial text-2xl font-bold">
              Periodic Journal Reflections
            </h2>
            <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
              Synthesized locally across your entries — daily, weekly, and monthly views.
            </p>
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/10 dark:border-[#D4A44B]/20">
            {(['daily', 'weekly', 'monthly'] as const).map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setReflectionPeriod(period)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer whitespace-nowrap transition-colors ${
                  reflectionPeriod === period
                    ? 'bg-[#6839D3] text-[#F5EEDB]'
                    : 'text-[#5A5248] dark:text-[#B6AC9A] hover:text-[#14121D] dark:hover:text-[#F5EEDB]'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>

        {reflectionLoading ? (
          <div className="py-6 flex items-center gap-2 text-xs text-[#5A5248] dark:text-[#B6AC9A]">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>Synthesizing {reflectionPeriod} reflection locally…</span>
          </div>
        ) : reflection ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-editorial text-lg font-bold text-[#6839D3] dark:text-[#E5B85C]">
                {reflection.headline}
              </h3>
              <span className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                {reflection.entryCount} {reflection.entryCount === 1 ? 'entry' : 'entries'} · {reflection.totalMinutes} min
              </span>
            </div>

            <p className="text-sm leading-relaxed">{reflection.summary}</p>

            {reflection.topTopics.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {reflection.topTopics.map((t) => (
                  <span
                    key={t.topic}
                    className="px-3 py-1 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-[#D4A44B]/30 text-xs font-medium"
                  >
                    {t.topic} · {t.count}
                  </span>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
                  Personal Development Observations
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed">
                  {reflection.growthObservations.map((obs, i) => (
                    <li key={i}>• {obs}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15 space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#5A5248] dark:text-[#B6AC9A]">
                  Questions Worth Revisiting
                </div>
                <ul className="space-y-1.5 text-xs leading-relaxed">
                  {reflection.questions.map((q, i) => (
                    <li key={i}>• {q}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
