import React, { useEffect, useRef, useState } from 'react';
import { Bookmark, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { formatTimestamp } from '../utils/transcriptUtils';
import type { BookmarkMarker } from '../types/echo';

interface AudioPlayerProps {
  audioUrl: string;
  durationMs: number;
  waveformPeaks: number[];
  bookmarks: BookmarkMarker[];
  defaultSpeed?: number;
  currentTimeMs: number;
  onTimeUpdateMs: (ms: number) => void;
  seekRequestMs: { ms: number; seq: number } | null;
  onAddBookmarkAt?: (timeMs: number) => void;
}

const SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];

export function AudioPlayer({
  audioUrl,
  durationMs,
  waveformPeaks,
  bookmarks,
  defaultSpeed = 1.0,
  currentTimeMs,
  onTimeUpdateMs,
  seekRequestMs,
  onAddBookmarkAt,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [resolvedDurationMs, setResolvedDurationMs] = useState(durationMs || 1000);

  useEffect(() => {
    setResolvedDurationMs(durationMs || 1000);
  }, [durationMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    if (!seekRequestMs || !audioRef.current) return;
    const sec = Math.max(0, seekRequestMs.ms / 1000);
    audioRef.current.currentTime = sec;
    onTimeUpdateMs(seekRequestMs.ms);
  }, [seekRequestMs, onTimeUpdateMs]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const seekBy = (deltaMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const targetMs = Math.max(0, Math.min(resolvedDurationMs, currentTimeMs + deltaMs));
    audio.currentTime = targetMs / 1000;
    onTimeUpdateMs(targetMs);
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetMs = Math.round(ratio * resolvedDurationMs);
    if (audioRef.current) {
      audioRef.current.currentTime = targetMs / 1000;
    }
    onTimeUpdateMs(targetMs);
  };

  const bars =
    waveformPeaks.length > 0
      ? waveformPeaks
      : Array.from({ length: 48 }, (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 0.4)));
  const maxPeak = Math.max(0.08, ...bars);
  const progressRatio = Math.min(1, Math.max(0, currentTimeMs / Math.max(1, resolvedDurationMs)));
  const speedLabel = Number.isInteger(speed) ? `${speed}.0x` : `${speed}x`;

  return (
    <div className="bg-[#0D0C14] text-[#F5EEDB] border border-[#D4A44B]/30 rounded-2xl p-5 md:p-6 space-y-4 shadow-xl">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setResolvedDurationMs(Math.round(d * 1000));
          }
        }}
        onTimeUpdate={(e) => {
          onTimeUpdateMs(Math.round(e.currentTarget.currentTime * 1000));
        }}
        onEnded={() => setIsPlaying(false)}
      />

      {/* Interactive Waveform Scrubber */}
      <div className="space-y-2">
        <div
          role="slider"
          aria-label="Audio playback timeline"
          aria-valuemin={0}
          aria-valuemax={resolvedDurationMs}
          aria-valuenow={currentTimeMs}
          tabIndex={0}
          onClick={handleWaveformClick}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') seekBy(5000);
            if (e.key === 'ArrowLeft') seekBy(-5000);
          }}
          className="relative h-16 flex items-center gap-[3px] cursor-pointer select-none px-1"
        >
          {bars.map((peak, idx) => {
            const barRatio = idx / Math.max(1, bars.length - 1);
            const passed = barRatio <= progressRatio;
            const normalizedHeight = Math.max(20, Math.round((peak / maxPeak) * 96));
            return (
              <div
                key={idx}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${normalizedHeight}%`,
                  backgroundColor: passed
                    ? idx % 3 === 0
                      ? '#E5B85C'
                      : '#8557F6'
                    : 'rgba(212, 164, 75, 0.24)',
                }}
              />
            );
          })}

          {/* Bookmark pins along timeline */}
          {bookmarks.map((bm) => {
            const leftPct = Math.min(98, Math.max(1, (bm.timeMs / Math.max(1, resolvedDurationMs)) * 100));
            return (
              <button
                key={bm.id}
                type="button"
                title={`${formatTimestamp(bm.timeMs)} — ${bm.label}`}
                aria-label={`Jump to bookmark ${bm.label}`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (audioRef.current) audioRef.current.currentTime = bm.timeMs / 1000;
                  onTimeUpdateMs(bm.timeMs);
                }}
                style={{ left: `${leftPct}%` }}
                className="absolute -top-1 -translate-x-1/2 w-3 h-3 rounded-full bg-[#D4A44B] ring-2 ring-[#0D0C14] cursor-pointer"
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between font-mono-meta text-xs text-[#B6AC9A]">
          <span>{formatTimestamp(currentTimeMs)}</span>
          <span>{formatTimestamp(resolvedDurationMs)}</span>
        </div>
      </div>

      {/* Playback Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Speed cycle */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              const nextIdx = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length;
              setSpeed(SPEEDS[nextIdx]);
            }}
            aria-label={`Playback speed ${speedLabel}`}
            className="min-h-[40px] px-3 rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#D4A44B]/25 font-mono-meta text-xs font-semibold text-[#E5B85C] cursor-pointer"
          >
            {speedLabel}
          </button>

          {onAddBookmarkAt && (
            <button
              type="button"
              onClick={() => onAddBookmarkAt(currentTimeMs)}
              title="Bookmark current timestamp"
              className="min-h-[40px] px-3 rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#D4A44B]/25 text-xs font-medium flex items-center gap-1.5 text-[#D4A44B] cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pin</span>
            </button>
          )}
        </div>

        {/* Center transport */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => seekBy(-15000)}
            aria-label="Rewind 15 seconds"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#F5EEDB]/12 flex items-center justify-center gap-0.5 text-xs font-mono-meta cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>15</span>
          </button>

          <button
            type="button"
            onClick={() => void togglePlay()}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            className="w-12 h-12 rounded-full bg-gradient-to-br from-[#8557F6] to-[#6839D3] hover:from-[#7544EE] hover:to-[#5A2EC0] border border-[#D4A44B]/70 text-[#F5EEDB] flex items-center justify-center shadow-lg shadow-[#6839D3]/35 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => seekBy(15000)}
            aria-label="Forward 15 seconds"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#F5EEDB]/12 flex items-center justify-center gap-0.5 text-xs font-mono-meta cursor-pointer"
          >
            <span>15</span>
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="min-w-[40px] min-h-[40px] rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#F5EEDB]/12 flex items-center justify-center cursor-pointer"
          >
            {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            aria-label="Playback volume"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              setMuted(false);
              setVolume(parseFloat(e.target.value));
            }}
            className="w-20 accent-[#D4A44B] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
