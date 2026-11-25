import React from 'react';

export const ANIME_HERO_URL = '/src/assets/images/anime_hero_listener_1795560481028.jpg';
export const ANIME_RECORDING_URL = '/src/assets/images/anime_recording_muse_1795560481377.jpg';
export const ANIME_COURTYARD_URL = '/src/assets/images/anime_campus_courtyard_1795560482032.jpg';
export const ANIME_PAGODA_URL = '/src/assets/images/anime_sakura_pagoda_1795560482281.jpg';
export const ANIME_STUDY_URL = '/src/assets/images/anime_study_horizon_1795560483169.jpg';
export const HERO_ART_URL = ANIME_HERO_URL;

export const BUNDLED_COVER_ART = [
  { id: 'hero', label: 'Moonlit Listener', url: ANIME_HERO_URL },
  { id: 'courtyard', label: 'Clocktower Courtyard', url: ANIME_COURTYARD_URL },
  { id: 'pagoda', label: 'Sakura Pagoda', url: ANIME_PAGODA_URL },
  { id: 'study', label: 'Twilight Study Desk', url: ANIME_STUDY_URL },
];

export function EchoCrownMark({ className = 'w-7 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 28" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 23 L7 9 L15 16 L20 4 L25 16 L33 9 L36 23 Z"
        fill="#D4A44B"
        stroke="#14121D"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7" r="2.2" fill="#E5B85C" />
      <circle cx="20" cy="3" r="2.5" fill="#E5B85C" />
      <circle cx="33" cy="7" r="2.2" fill="#E5B85C" />
    </svg>
  );
}

export function HandDrawnGoldUnderline({ className = 'w-32 h-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 14" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 9 C42 3, 128 2, 177 8"
        stroke="#D4A44B"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M16 12 C62 8, 124 9, 165 11"
        stroke="#E27A48"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeOpacity="0.7"
      />
    </svg>
  );
}

export function EmptyJournalIllustration({ className = 'w-56 h-40' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 180" fill="none" className={className} aria-hidden="true">
      <rect x="24" y="22" width="212" height="136" rx="20" fill="#EFE4C9" stroke="#14121D" strokeWidth="1.5" />
      <circle cx="188" cy="58" r="22" fill="#D4A44B" fillOpacity="0.88" stroke="#14121D" strokeWidth="1.5" />
      <path d="M24 134 C76 96, 120 112, 166 86 C198 68, 220 78, 236 92 L236 158 L24 158 Z" fill="#6839D3" fillOpacity="0.28" stroke="#14121D" strokeWidth="1.4" />
      <rect x="74" y="46" width="84" height="96" rx="6" fill="#FAF5E8" stroke="#14121D" strokeWidth="2" />
      <rect x="82" y="46" width="9" height="96" fill="#D4A44B" stroke="#14121D" strokeWidth="1.4" />
      <line x1="102" y1="72" x2="144" y2="72" stroke="#14121D" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="102" y1="88" x2="136" y2="88" stroke="#6839D3" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="102" y1="104" x2="140" y2="104" stroke="#14121D" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EmptySearchIllustration({ className = 'w-52 h-36' }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 160" fill="none" className={className} aria-hidden="true">
      <ellipse cx="120" cy="134" rx="82" ry="11" fill="#D4A44B" fillOpacity="0.22" />
      <path d="M40 120 Q85 68 130 98 T205 78" stroke="#6839D3" strokeWidth="2.5" strokeDasharray="5 5" />
      <circle cx="106" cy="74" r="33" fill="#FAF5E8" stroke="#14121D" strokeWidth="3.2" />
      <circle cx="106" cy="74" r="20" fill="#D4A44B" fillOpacity="0.28" />
      <line x1="130" y1="98" x2="162" y2="130" stroke="#D4A44B" strokeWidth="8" strokeLinecap="round" />
      <line x1="130" y1="98" x2="162" y2="130" stroke="#14121D" strokeWidth="2" strokeLinecap="round" />
      <circle cx="174" cy="46" r="9" fill="#E27A48" stroke="#14121D" strokeWidth="1.5" />
    </svg>
  );
}

export function EmptyCalendarIllustration({ className = 'w-48 h-32' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" className={className} aria-hidden="true">
      <rect x="34" y="26" width="152" height="96" rx="14" fill="#FAF5E8" stroke="#14121D" strokeWidth="1.8" />
      <rect x="34" y="26" width="152" height="28" rx="14" fill="#14121D" />
      <circle cx="72" cy="24" r="5.5" fill="#D4A44B" stroke="#14121D" strokeWidth="1.5" />
      <circle cx="148" cy="24" r="5.5" fill="#D4A44B" stroke="#14121D" strokeWidth="1.5" />
      <rect x="54" y="70" width="24" height="16" rx="4" fill="#D4A44B" fillOpacity="0.45" />
      <rect x="98" y="70" width="24" height="16" rx="4" fill="#6839D3" fillOpacity="0.35" />
      <rect x="142" y="70" width="24" height="16" rx="4" fill="#E27A48" fillOpacity="0.4" />
      <path d="M58 104 Q110 92 162 104" stroke="#14121D" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function RecordingSuccessIllustration({ className = 'w-44 h-32' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 140" fill="none" className={className} aria-hidden="true">
      <circle cx="100" cy="70" r="46" fill="#D4A44B" fillOpacity="0.22" />
      <circle cx="100" cy="70" r="32" fill="#6839D3" stroke="#14121D" strokeWidth="2" />
      <path d="M85 71 L96 82 L117 59" stroke="#F5EEDB" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="48" cy="44" r="7" fill="#D4A44B" stroke="#14121D" strokeWidth="1.5" />
      <circle cx="156" cy="42" r="5.5" fill="#E27A48" stroke="#14121D" strokeWidth="1.5" />
      <circle cx="152" cy="104" r="8" fill="#FAF5E8" stroke="#14121D" strokeWidth="1.5" />
    </svg>
  );
}
