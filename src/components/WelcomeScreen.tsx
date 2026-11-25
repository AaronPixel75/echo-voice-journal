import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  ANIME_COURTYARD_URL,
  ANIME_HERO_URL,
  ANIME_PAGODA_URL,
  ANIME_RECORDING_URL,
  ANIME_STUDY_URL,
  EchoCrownMark,
  HandDrawnGoldUnderline,
} from './EditorialIllustrations';
import { sha256Hex } from './SettingsView';
import {
  computePasswordStrength,
  KINETIC_STARTUP_PHRASES,
  tokenizeKineticHeadline,
  validateVaultPassword,
  verifyPasswordHash,
} from '../utils/startupAuth';
import type { EchoSettings, ThemeMode } from '../types/echo';

interface CollagePillar {
  id: string;
  label: string;
  subtitle: string;
  imageUrl: string;
  positionClass: string;
}

const COLLAGE_PILLARS: CollagePillar[] = [
  {
    id: 'voice',
    label: 'Voice & Orb',
    subtitle: 'Glowing acoustic orb & local WAV capture',
    imageUrl: ANIME_RECORDING_URL,
    positionClass: '-top-5 -left-4 sm:-left-7 -rotate-3',
  },
  {
    id: 'whisper',
    label: 'Offline Whisper',
    subtitle: 'Private local speech-to-text & timestamps',
    imageUrl: ANIME_COURTYARD_URL,
    positionClass: '-top-5 -right-4 sm:-right-7 rotate-3',
  },
  {
    id: 'editorial',
    label: 'Editorial Notes',
    subtitle: 'Paper highlights, quotes & image cutouts',
    imageUrl: ANIME_PAGODA_URL,
    positionClass: 'bottom-12 -left-4 sm:-left-7 rotate-2',
  },
  {
    id: 'vault',
    label: 'Private Vault',
    subtitle: 'Encrypted SQLite FTS5 archive on device',
    imageUrl: ANIME_STUDY_URL,
    positionClass: 'bottom-12 -right-4 sm:-right-7 -rotate-2',
  },
];

interface WelcomeScreenProps {
  settings: EchoSettings;
  onEnterApp: (updates: Partial<EchoSettings>, unlocked: boolean) => Promise<void>;
}

export function WelcomeScreen({ settings, onEnterApp }: WelcomeScreenProps) {
  const hasPasswordConfigured = Boolean(settings.appLockEnabled && settings.appLockPinHash);

  const [name, setName] = useState(settings.userName || 'Maya');
  const [theme, setTheme] = useState<ThemeMode>(settings.theme);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [activeSceneId, setActiveSceneId] = useState<string>('hero');

  useEffect(() => {
    if (settings.reducedMotion) return;
    const timer = window.setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % KINETIC_STARTUP_PHRASES.length);
    }, 3400);
    return () => window.clearInterval(timer);
  }, [settings.reducedMotion]);

  const titleTokens = useMemo(() => tokenizeKineticHeadline('ECHO', 30, 55), []);
  const mottoTokens = useMemo(
    () => tokenizeKineticHeadline('Speak. Reflect. Remember.', 180, 26),
    []
  );

  const activePhrase = KINETIC_STARTUP_PHRASES[phraseIndex];
  const passwordStrength = computePasswordStrength(password);

  const activeScene = useMemo(() => {
    if (activeSceneId === 'hero') {
      return {
        label: 'ECHO · Voice Journal & Notebook',
        subtitle: 'A luxury illustrated journal, with the soul of an editorial magazine.',
        imageUrl: ANIME_HERO_URL,
      };
    }
    const found = COLLAGE_PILLARS.find((p) => p.id === activeSceneId);
    return (
      found || {
        label: 'ECHO · Voice Journal & Notebook',
        subtitle: 'A luxury illustrated journal, with the soul of an editorial magazine.',
        imageUrl: ANIME_HERO_URL,
      }
    );
  }, [activeSceneId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (hasPasswordConfigured) {
      const check = validateVaultPassword(password, { required: true });
      if (!check.valid) {
        setAuthError(check.error);
        return;
      }

      setSubmitting(true);
      try {
        const matches = await verifyPasswordHash(
          password,
          settings.appLockPinHash,
          sha256Hex
        );
        if (!matches) {
          setAuthError('Incorrect vault password. Please try again.');
          return;
        }
        await onEnterApp({ hasCompletedOnboarding: true }, true);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedPassword = password.trim();
    const check = validateVaultPassword(trimmedPassword, { required: false });
    if (!check.valid) {
      setAuthError(check.error);
      return;
    }

    setSubmitting(true);
    try {
      const updates: Partial<EchoSettings> = {
        userName: name.trim() || 'Maya',
        theme,
        hasCompletedOnboarding: true,
      };
      if (trimmedPassword.length >= 4) {
        updates.appLockEnabled = true;
        updates.appLockPinHash = await sha256Hex(trimmedPassword);
      }
      await onEnterApp(updates, true);
    } finally {
      setSubmitting(false);
    }
  };

  const strengthLabel =
    passwordStrength === 'strong'
      ? 'Strong passphrase'
      : passwordStrength === 'fair'
        ? 'Fair password'
        : passwordStrength === 'weak'
          ? 'Minimum 4 characters'
          : null;

  return (
    <div className="min-h-screen bg-[#0D0C14] text-[#F5EEDB] relative overflow-hidden flex flex-col justify-center px-4 py-6 sm:px-8 lg:px-12">
      {/* Studio Dot Texture & Sweeping Purple/Gold Ribbons */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(rgba(212,164,75,0.14) 1px, transparent 1px), radial-gradient(circle at 18% 28%, rgba(104,57,211,0.24), transparent 50%), radial-gradient(circle at 82% 74%, rgba(212,164,75,0.16), transparent 48%)',
          backgroundSize: '26px 26px, 100% 100%, 100% 100%',
        }}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 1440 500"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 w-full opacity-30"
        fill="none"
      >
        <path
          d="M-60 280 C 260 110, 580 420, 960 210 C 1180 95, 1340 220, 1500 180"
          stroke="#6839D3"
          strokeWidth="44"
          strokeLinecap="round"
        />
        <path
          d="M-40 340 C 310 430, 620 150, 1010 310 C 1220 390, 1360 260, 1500 290"
          stroke="#D4A44B"
          strokeWidth="12"
          strokeLinecap="round"
          strokeOpacity="0.6"
        />
      </svg>

      <div className="relative z-10 w-full max-w-6xl mx-auto space-y-6 lg:space-y-8">
        {/* Expressive Kinetic & Glitch Editorial Header */}
        <header className="text-center space-y-2.5">
          <div className="inline-flex flex-wrap items-center justify-center gap-2 text-[11px] sm:text-xs font-mono-meta text-[#E5B85C] tracking-widest uppercase">
            <EchoCrownMark className="w-5 h-3.5 shrink-0" />
            <span>Offline Voice Journal · Local Vault</span>
          </div>

          <h1
            aria-label="ECHO"
            className="font-editorial text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-[#F5EEDB] leading-none"
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

          <div className="max-w-[260px] mx-auto animate-gold-sweep">
            <HandDrawnGoldUnderline className="w-full h-3" />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-4 pt-1">
            <p
              aria-label="Speak. Reflect. Remember."
              className="font-editorial italic text-lg sm:text-xl text-[#F5EEDB]/95 animate-kinetic-word"
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
            <span aria-hidden="true" className="hidden sm:inline text-[#D4A44B]/60">
              ·
            </span>
            <p
              key={activePhrase}
              aria-label={activePhrase}
              className="font-mono-meta text-xs uppercase tracking-widest text-[#BBA9FF] animate-kinetic-phrase"
            >
              <span aria-hidden="true" className="echo-glitch-type" data-text={activePhrase}>
                {activePhrase}
              </span>
            </p>
          </div>
        </header>

        {/* Reference-Inspired Taped-Paper Collage + Password Entry Login Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Original ECHO Taped Paper Collage */}
          <div className="lg:col-span-7 space-y-4 sm:px-4">
            <div className="relative p-3 sm:p-4 rounded-2xl bg-[#FAF5E8] text-[#14121D] shadow-2xl border border-[#D4A44B]/50">
              {/* Top Masking Tape Strips */}
              <div
                aria-hidden="true"
                className="hidden sm:block absolute -top-3 left-12 w-18 h-5 bg-[#E5D3A6]/90 -rotate-2 border border-black/10 shadow-xs z-20"
              />
              <div
                aria-hidden="true"
                className="hidden sm:block absolute -top-3 right-12 w-18 h-5 bg-[#E5D3A6]/90 rotate-2 border border-black/10 shadow-xs z-20"
              />

              {/* Centerpiece Torn-Paper Scene */}
              <div className="relative rounded-xl overflow-hidden bg-[#12101B] aspect-[16/10] torn-edge-bottom">
                <img
                  src={activeScene.imageUrl}
                  alt={activeScene.label}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Floating Taped Polaroid Cutouts around Collage Corners (Desktop/Tablet) */}
              {COLLAGE_PILLARS.map((pillar) => {
                const isSelected = activeSceneId === pillar.id;
                return (
                  <button
                    key={pillar.id}
                    type="button"
                    onClick={() => setActiveSceneId(pillar.id)}
                    className={`hidden md:block absolute ${pillar.positionClass} w-28 p-1.5 pb-2 rounded-lg bg-[#FAF5E8] text-[#14121D] shadow-xl border transition-transform hover:scale-105 cursor-pointer z-20 ${
                      isSelected ? 'border-[#6839D3] ring-2 ring-[#6839D3]/40' : 'border-black/15'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="block w-8 h-2.5 bg-[#E5D3A6]/90 mx-auto -mt-2.5 mb-1 border border-black/10"
                    />
                    <img
                      src={pillar.imageUrl}
                      alt=""
                      aria-hidden="true"
                      className="w-full h-14 object-cover rounded-sm"
                    />
                    <div className="text-[10px] font-bold tracking-tight mt-1 text-center truncate">
                      {pillar.label}
                    </div>
                  </button>
                );
              })}

              {/* Clean Parchment Scene Caption (centered on desktop so side polaroids never overlap) */}
              <div className="pt-2.5 pb-1 px-2 md:px-24 text-center">
                <div className="font-editorial text-sm sm:text-base font-bold text-[#14121D]">
                  {activeScene.label}
                </div>
                <p className="text-[11px] sm:text-xs text-[#5A5248] mt-0.5 line-clamp-1">
                  {activeScene.subtitle}
                </p>
              </div>

              {/* Interactive Thumbnail Strip & 100% Ready Indicator inside Paper Frame */}
              <div className="pt-2 px-1 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    aria-label="Show main ECHO hero illustration"
                    onClick={() => setActiveSceneId('hero')}
                    className={`w-10 h-7 sm:w-12 sm:h-8 rounded-md overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                      activeSceneId === 'hero'
                        ? 'border-[#D4A44B] scale-105'
                        : 'border-black/15 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img src={ANIME_HERO_URL} alt="" className="w-full h-full object-cover" />
                  </button>
                  {COLLAGE_PILLARS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={`Preview ${p.label}`}
                      onClick={() => setActiveSceneId(p.id)}
                      className={`w-10 h-7 sm:w-12 sm:h-8 rounded-md overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                        activeSceneId === p.id
                          ? 'border-[#6839D3] scale-105'
                          : 'border-black/15 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>

                <span className="font-mono-meta text-xs font-bold text-[#6839D3] whitespace-nowrap shrink-0">
                  100% Offline
                </span>
              </div>
            </div>

            {/* Purple-to-Gold Startup Entrance Bar */}
            <div className="space-y-2 px-1">
              <div className="h-2 w-full rounded-full bg-[#1C1829] overflow-hidden border border-[#D4A44B]/20">
                <div className="h-full w-full rounded-full bg-gradient-to-r from-[#6839D3] via-[#9C6BFF] to-[#D4A44B] animate-startup-progress" />
              </div>
              <div className="flex items-center justify-between text-xs text-[#B6AC9A]">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[#E5B85C] shrink-0" />
                  <span>
                    {hasPasswordConfigured
                      ? 'Vault locked — enter your local password to continue'
                      : 'Ready — enter a password or tap Enter App to begin'}
                  </span>
                </span>
                <span className="font-mono-meta text-[#BBA9FF] shrink-0">100%</span>
              </div>
            </div>
          </div>

          {/* Right Password Entry Login & Vault Gate */}
          <div className="lg:col-span-5">
            <form
              onSubmit={handleSubmit}
              className="rounded-3xl bg-[#161421]/95 border border-[#D4A44B]/35 p-6 sm:p-7 shadow-2xl space-y-5 backdrop-blur-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 font-mono-meta text-[11px] uppercase tracking-widest text-[#E5B85C]">
                    <Lock className="w-3.5 h-3.5" />
                    <span>{hasPasswordConfigured ? 'Password Login' : 'Vault Access'}</span>
                  </div>
                  <h2 className="font-editorial text-2xl font-bold text-[#F5EEDB]">
                    {hasPasswordConfigured
                      ? `Welcome back, ${settings.userName}`
                      : 'Open Your Journal'}
                  </h2>
                  <p className="text-xs text-[#B6AC9A]">
                    {hasPasswordConfigured
                      ? 'Authenticate with your local vault password to unlock your entries.'
                      : 'Protect this local vault with a password now, or enter directly.'}
                  </p>
                </div>

                <div className="w-10 h-10 rounded-2xl bg-[#6839D3]/25 border border-[#D4A44B]/40 flex items-center justify-center shrink-0">
                  {hasPasswordConfigured ? (
                    <KeyRound className="w-5 h-5 text-[#E5B85C]" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-[#E5B85C]" />
                  )}
                </div>
              </div>

              {!hasPasswordConfigured && (
                <>
                  <div>
                    <label
                      htmlFor="startup-owner-name"
                      className="block text-xs font-medium text-[#DED4BE] mb-1.5"
                    >
                      Journal Owner Name
                    </label>
                    <input
                      id="startup-owner-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0D0C14] border border-[#D4A44B]/30 text-[#F5EEDB] text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A44B]"
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-medium text-[#DED4BE] mb-1.5">
                      Paper &amp; Ink Theme
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setTheme('light')}
                        className={`px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                          theme === 'light'
                            ? 'bg-[#F5EEDB] border-[#D4A44B] text-[#14121D]'
                            : 'bg-[#0D0C14]/80 border-[#F5EEDB]/15 text-[#B6AC9A]'
                        }`}
                      >
                        <div className="text-xs font-bold">Warm Parchment</div>
                        <div className="text-[11px] opacity-75">Editorial paper</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('dark')}
                        className={`px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                          theme === 'dark'
                            ? 'bg-[#6839D3]/30 border-[#D4A44B] text-[#F5EEDB]'
                            : 'bg-[#0D0C14]/80 border-[#F5EEDB]/15 text-[#B6AC9A]'
                        }`}
                      >
                        <div className="text-xs font-bold">Midnight Ink</div>
                        <div className="text-[11px] opacity-75">Obsidian &amp; gold</div>
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="startup-vault-password"
                    className="block text-xs font-medium text-[#DED4BE]"
                  >
                    {hasPasswordConfigured
                      ? 'Vault Password'
                      : 'Set Vault Password (optional, 4+ chars)'}
                  </label>
                  {!hasPasswordConfigured && strengthLabel && (
                    <span className="font-mono-meta text-[11px] text-[#E5B85C]">
                      {strengthLabel}
                    </span>
                  )}
                </div>

                <div className="relative">
                  <input
                    id="startup-vault-password"
                    type={showPassword ? 'text' : 'password'}
                    aria-label="Vault password"
                    autoComplete={hasPasswordConfigured ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (authError) setAuthError(null);
                    }}
                    placeholder={
                      hasPasswordConfigured
                        ? 'Enter password to unlock'
                        : 'Leave blank or enter 4+ characters'
                    }
                    className="w-full pl-3.5 pr-11 py-3 rounded-xl bg-[#0D0C14] border border-[#D4A44B]/35 text-[#F5EEDB] text-sm placeholder:text-[#787066] focus:outline-none focus:ring-2 focus:ring-[#D4A44B]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] rounded-lg text-[#B6AC9A] hover:text-[#F5EEDB] flex items-center justify-center cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {authError && (
                <div
                  role="alert"
                  className="px-3.5 py-2.5 rounded-xl bg-[#E27A48]/15 border border-[#E27A48]/45 text-xs font-medium text-[#FFB490]"
                >
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 px-6 rounded-xl bg-[#6839D3] hover:bg-[#5B30BE] border-2 border-[#D4A44B] text-[#F5EEDB] font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-[#6839D3]/30 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>
                  {submitting
                    ? 'Opening Vault…'
                    : hasPasswordConfigured
                      ? 'Unlock & Enter App'
                      : password.trim().length > 0
                        ? 'Set Password & Enter App'
                        : 'Enter App'}
                </span>
                <ArrowRight className="w-4 h-4 text-[#E5B85C]" />
              </button>

              <p className="text-[11px] font-mono-meta text-center text-[#8F8678]">
                SHA-256 local verification · Persisted solely on this device
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
