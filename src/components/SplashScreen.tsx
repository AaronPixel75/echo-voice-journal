import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { EchoCrownMark, HandDrawnGoldUnderline } from './EditorialIllustrations';
import { tokenizeKineticHeadline } from '../utils/startupAuth';

interface SplashScreenProps {
  resourcesReady: boolean;
  reducedMotion?: boolean;
  onComplete: () => void;
}

export function SplashScreen({
  resourcesReady,
  reducedMotion = false,
  onComplete,
}: SplashScreenProps) {
  const [minDelayElapsed, setMinDelayElapsed] = useState(reducedMotion);
  const [exiting, setExiting] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const completedRef = useRef(false);

  const titleTokens = useMemo(() => tokenizeKineticHeadline('ECHO', 25, 65), []);
  const mottoTokens = useMemo(
    () => tokenizeKineticHeadline('Speak. Reflect. Remember.', 190, 26),
    []
  );

  useEffect(() => {
    const ms = reducedMotion ? 120 : 1200;
    const timer = window.setTimeout(() => {
      setMinDelayElapsed(true);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (!resourcesReady || !minDelayElapsed || completedRef.current) return;
    setExiting(true);
    const transitionTimer = window.setTimeout(
      () => {
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current();
        }
      },
      reducedMotion ? 40 : 280
    );
    return () => window.clearTimeout(transitionTimer);
  }, [resourcesReady, minDelayElapsed, reducedMotion]);

  const progressPct = resourcesReady ? (minDelayElapsed ? 100 : 88) : 52;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading ECHO Voice Journal"
      className={`min-h-screen bg-[#0D0C14] text-[#F5EEDB] relative overflow-hidden flex items-center justify-center p-6 transition-opacity duration-300 ${
        exiting ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Layered Warm Parchment & Midnight Ink Paper-Texture Overlays */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage:
            'radial-gradient(rgba(212,164,75,0.16) 1px, transparent 1px), radial-gradient(circle at 22% 28%, rgba(104,57,211,0.28), transparent 52%), radial-gradient(circle at 78% 72%, rgba(212,164,75,0.18), transparent 50%)',
          backgroundSize: '24px 24px, 100% 100%, 100% 100%',
        }}
      />

      {/* Archival paper grain SVG overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)' opacity='0.55'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Torn-paper diagonal corner accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none hidden sm:block absolute -top-10 -left-12 w-64 h-44 bg-[#FAF5E8]/8 border border-[#D4A44B]/20 -rotate-12 torn-edge-bottom"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none hidden sm:block absolute -bottom-10 -right-12 w-72 h-48 bg-[#6839D3]/14 border border-[#D4A44B]/20 rotate-12 torn-edge-right"
      />

      {/* Center Kinetic Splash Card */}
      <div className="relative z-10 w-full max-w-lg text-center space-y-6 animate-paper-unfold">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#161421]/90 border border-[#D4A44B]/30 text-[11px] font-mono-meta uppercase tracking-widest text-[#E5B85C]">
          <EchoCrownMark className="w-5 h-3.5 shrink-0" />
          <span>Offline Editorial Voice Archive</span>
        </div>

        <div className="space-y-3">
          <h1
            aria-label="ECHO"
            className="font-editorial text-6xl sm:text-7xl md:text-8xl font-bold tracking-tight text-[#F5EEDB] leading-none"
          >
            <span aria-hidden="true" className="echo-glitch-type" data-text="ECHO">
              {titleTokens.map((t) => (
                <span
                  key={t.index}
                  className="animate-kinetic-letter"
                  style={{ animationDelay: `${t.delayMs}ms` }}
                >
                  {t.char}
                </span>
              ))}
            </span>
          </h1>

          <div className="max-w-[220px] mx-auto animate-gold-sweep">
            <HandDrawnGoldUnderline className="w-full h-3" />
          </div>

          <p
            aria-label="Speak. Reflect. Remember."
            className="font-editorial italic text-xl sm:text-2xl text-[#DED4BE] animate-kinetic-word"
          >
            <span aria-hidden="true">
              {mottoTokens.map((t) =>
                t.isSpace ? (
                  <span key={t.index}> </span>
                ) : (
                  <span
                    key={t.index}
                    className="animate-kinetic-letter"
                    style={{ animationDelay: `${t.delayMs}ms` }}
                  >
                    {t.char}
                  </span>
                )
              )}
            </span>
          </p>
        </div>

        {/* Parchment-edged Loading Progress Bar */}
        <div className="max-w-sm mx-auto space-y-2.5 pt-2">
          <div className="h-2.5 w-full rounded-full bg-[#1A1726] p-0.5 border border-[#D4A44B]/30 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#6839D3] via-[#9C6BFF] to-[#D4A44B] transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-mono-meta text-[#B6AC9A]">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#E5B85C]" />
              <span>
                {resourcesReady
                  ? 'Local vault verified'
                  : 'Loading offline notes & speech engine…'}
              </span>
            </span>
            <span className="text-[#E5B85C]">{progressPct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
