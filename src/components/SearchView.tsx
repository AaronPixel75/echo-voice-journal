import React, { useEffect, useState } from 'react';
import { ArrowRight, BrainCircuit, Clock, Search as SearchIcon } from 'lucide-react';
import { EmptySearchIllustration } from './EditorialIllustrations';
import { echoApi } from '../services/echoApi';
import { formatTimestamp } from '../utils/transcriptUtils';
import type { EchoSettings, SearchMode, SearchResultItem } from '../types/echo';

interface SearchViewProps {
  settings: EchoSettings;
  onOpenEntry: (entryId: string) => void;
}

export function SearchView({ settings, onOpenEntry }: SearchViewProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>(settings.aiEnabled ? 'hybrid' : 'fts');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  const effectiveMode: SearchMode = settings.aiEnabled ? mode : 'fts';

  useEffect(() => {
    if (!settings.aiEnabled) {
      setMode('fts');
    }
  }, [settings.aiEnabled]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await echoApi.search(trimmed, effectiveMode);
        setResults(res);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, effectiveMode]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 animate-paper-unfold">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial text-3xl font-bold">Offline Archive Search</h1>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
            {settings.aiEnabled
              ? 'Hybrid local SQLite FTS5 keyword matching + on-device EmbeddingGemma semantic retrieval.'
              : 'SQLite FTS5 keyword indexing active (On-Device AI is off — full keyword search remains ready).'}
          </p>
        </div>

        <div
          role="group"
          aria-label="Search Mode"
          className="flex items-center gap-1 p-1 rounded-xl paper-card text-xs"
        >
          {(
            [
              { id: 'hybrid', label: 'Hybrid (Semantic + FTS5)', requiresAi: true },
              { id: 'semantic', label: 'Semantic', requiresAi: true },
              { id: 'fts', label: 'Keyword (FTS5)', requiresAi: false },
            ] as const
          ).map((item) => {
            const disabled = item.requiresAi && !settings.aiEnabled;
            const active = effectiveMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setMode(item.id)}
                className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? 'bg-[#6839D3] text-[#F5EEDB]'
                    : 'text-[#5A5248] dark:text-[#B6AC9A] hover:text-[#14121D] dark:hover:text-[#F5EEDB]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <SearchIcon className="w-5 h-5 text-[#5A5248] dark:text-[#B6AC9A] absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          aria-label="Search journal entries"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search words, concepts, highlighted quotes, #tags, or dates…"
          className="w-full pl-12 pr-4 py-4 rounded-2xl paper-card text-base focus:outline-none focus:ring-2 focus:ring-[#D4A44B]"
        />
      </div>

      {/* Suggested quick queries */}
      {!query.trim() && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[#5A5248] dark:text-[#B6AC9A]">Try searching:</span>
          {['meaningful', 'clarity', 'creative focus', 'mountain', 'morning'].map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => setQuery(term)}
              className="px-3 py-1.5 rounded-xl paper-card hover:border-[#D4A44B] font-medium cursor-pointer"
            >
              {term}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] py-6">
          Searching local SQLite {effectiveMode === 'fts' ? 'FTS5' : '& EmbeddingGemma'} index…
        </p>
      ) : query.trim() && results.length === 0 ? (
        <div className="paper-card rounded-3xl p-10 text-center flex flex-col items-center gap-4">
          <EmptySearchIllustration className="w-52 h-36" />
          <div className="space-y-1">
            <h3 className="font-editorial text-xl font-bold">No matching memories found</h3>
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
              Try a shorter phrase or switch between Hybrid, Semantic, and FTS5 modes.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {results.map((item) => (
            <button
              key={item.entry.id}
              type="button"
              onClick={() => onOpenEntry(item.entry.id)}
              className="w-full text-left paper-card hover:border-[#D4A44B] rounded-2xl p-5 space-y-2 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] flex flex-wrap items-center gap-2">
                  <span>{new Date(item.entry.createdAt).toLocaleDateString()}</span>
                  <span aria-hidden="true">·</span>
                  <span>Matched in: {item.matchedIn.join(', ')}</span>
                  {typeof item.semanticScore === 'number' && item.semanticScore > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 text-[#6839D3] dark:text-[#E5B85C] font-semibold">
                        <BrainCircuit className="w-3 h-3" />
                        {Math.round(item.semanticScore * 100)}% semantic
                      </span>
                    </>
                  )}
                  {item.entry.durationMs > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(item.entry.durationMs)}
                      </span>
                    </>
                  )}
                </div>
                <ArrowRight className="w-4 h-4 text-[#D4A44B] shrink-0" />
              </div>
              <h3 className="font-editorial text-lg font-bold">{item.entry.title}</h3>
              <p
                className="text-sm text-[#5A5248] dark:text-[#B6AC9A] [&_mark]:bg-[#F6D063] [&_mark]:text-[#14121D] [&_mark]:px-1 [&_mark]:rounded"
                dangerouslySetInnerHTML={{ __html: item.snippetHtml }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
