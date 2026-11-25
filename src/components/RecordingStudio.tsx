import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Mic,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { encodeWav } from '../utils/audioCodec';
import { formatTimestamp } from '../utils/transcriptUtils';
import { arrayBufferToBase64, echoApi } from '../services/echoApi';
import { deleteRecoveryCheckpoint, saveRecoveryCheckpoint } from '../services/offlineAudioVault';
import { ANIME_RECORDING_URL, RecordingSuccessIllustration } from './EditorialIllustrations';
import type { BookmarkMarker, EchoSettings, JournalEntry, Notebook, VisualizationMode } from '../types/echo';

interface RecordingStudioProps {
  settings: EchoSettings;
  notebooks: Notebook[];
  onSaved: (entry: JournalEntry) => void;
  onCancel: () => void;
}

type StudioPhase = 'ready' | 'recording' | 'paused' | 'saving' | 'saved';

export function RecordingStudio({ settings, notebooks, onSaved, onCancel }: RecordingStudioProps) {
  const [phase, setPhase] = useState<StudioPhase>('ready');
  const [vizMode, setVizMode] = useState<VisualizationMode>(settings.defaultVisualization || 'orb');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [useSimulatedMic, setUseSimulatedMic] = useState(false);
  const [micStatusNote, setMicStatusNote] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkMarker[]>([]);
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [confirmedLines, setConfirmedLines] = useState<string[]>([]);
  const [interimLine, setInterimLine] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [selectedNotebookId, setSelectedNotebookId] = useState(notebooks[0]?.id || 'nb-daily');
  const [savedEntry, setSavedEntry] = useState<JournalEntry | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const simIntervalRef = useRef<number | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(16000);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const checkpointRef = useRef<number | null>(null);
  const phaseRef = useRef<StudioPhase>('ready');
  const startedAtRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);
  const incompleteIdRef = useRef<string>(`inc-${Date.now().toString(36)}`);
  const recognitionRef = useRef<unknown>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const mergePcmChunks = useCallback(() => {
    const chunks = pcmChunksRef.current;
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }, []);

  const downsampleTo16k = (input: Float32Array, fromRate: number): Float32Array => {
    if (fromRate === 16000 || input.length === 0) return input;
    const ratio = fromRate / 16000;
    const newLength = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      output[i] = input[Math.floor(i * ratio)] || 0;
    }
    return output;
  };

  const cleanupAudioPipeline = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (checkpointRef.current) clearInterval(checkpointRef.current);
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    try {
      if (recognitionRef.current && typeof (recognitionRef.current as { stop?: () => void }).stop === 'function') {
        (recognitionRef.current as { stop: () => void }).stop();
      }
    } catch {
      // ignore
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudioPipeline();
    };
  }, [cleanupAudioPipeline]);

  // Glowing Orb surrounded by paper-like ink, gold & violet waveforms
  const startVisualizerLoop = useCallback(() => {
    let lastFrameMs = 0;
    const draw = (frameMs: number) => {
      if (phaseRef.current !== 'recording' && phaseRef.current !== 'paused') return;
      if (frameMs - lastFrameMs < 32) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameMs = frameMs;

      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      let amp = 0.06;
      const freqData = new Uint8Array(analyser ? analyser.frequencyBinCount : 64);
      const timeData = new Uint8Array(analyser ? analyser.fftSize : 128);

      if (analyser && phaseRef.current === 'recording') {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const centered = (timeData[i] - 128) / 128;
          sum += centered * centered;
        }
        amp = Math.min(1, Math.sqrt(sum / timeData.length) * 3.2);
      } else if (phaseRef.current === 'paused') {
        amp = 0.04;
      }

      const nowSec = performance.now() / 1000;
      const cx = w / 2;
      const cy = h / 2;

      if (vizMode === 'orb') {
        // Horizontal paper-cutout waveform ribbons flanking the glowing orb
        const ribbonBars = 42;
        const barW = Math.max(2 * dpr, w * 0.008);
        const gap = (w * 0.86) / ribbonBars;
        for (let i = 0; i < ribbonBars; i++) {
          const x = w * 0.07 + i * gap;
          const distFromCenter = Math.abs(x - cx) / (w * 0.5);
          if (distFromCenter < 0.24) continue;
          const bin = Math.floor((i / ribbonBars) * (freqData.length * 0.7));
          const mag = (freqData[bin] || 0) / 255;
          const barH = (12 + mag * 75 + amp * 35) * dpr * Math.sin((i / ribbonBars) * Math.PI);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(212, 164, 75, 0.78)' : 'rgba(133, 87, 246, 0.75)';
          ctx.beginPath();
          ctx.roundRect(x, cy - barH / 2, barW, Math.max(6 * dpr, barH), barW / 2);
          ctx.fill();
        }

        // Expanding antique gold & parchment ink rings
        const baseR = Math.min(w, h) * 0.2;
        for (let rIdx = 3; rIdx >= 1; rIdx--) {
          const pulse = ((nowSec * 0.55 + rIdx * 0.33) % 1) * (baseR * 0.95 + amp * baseR * 0.65);
          const alpha = Math.max(0.06, (1 - pulse / (baseR * 1.7)) * (0.35 + amp * 0.35));
          ctx.beginPath();
          ctx.arc(cx, cy, baseR + pulse, 0, Math.PI * 2);
          ctx.strokeStyle =
            rIdx % 2 === 0 ? `rgba(229, 184, 92, ${alpha})` : `rgba(187, 169, 255, ${alpha})`;
          ctx.lineWidth = 1.8 * dpr;
          ctx.stroke();
        }

        // Glowing luxury orb
        const orbR = baseR * (0.9 + amp * 0.38);
        const grad = ctx.createRadialGradient(
          cx - orbR * 0.22,
          cy - orbR * 0.22,
          orbR * 0.1,
          cx,
          cy,
          orbR
        );
        grad.addColorStop(0, '#F5EEDB');
        grad.addColorStop(0.28, '#E5B85C');
        grad.addColorStop(0.65, '#6839D3');
        grad.addColorStop(1, '#18102B');

        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.08) {
          const idx = Math.floor(((a / (Math.PI * 2)) * freqData.length) % freqData.length);
          const fBoost = (freqData[idx] || 0) / 255;
          const wobble = Math.sin(a * 4 + nowSec * 2.8) * (2.5 + amp * 11) * dpr + fBoost * 8 * dpr;
          const rx = cx + Math.cos(a) * (orbR + wobble);
          const ry = cy + Math.sin(a) * (orbR + wobble);
          if (a === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(229, 184, 92, 0.8)';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
      } else if (vizMode === 'wave') {
        // Paper-like layered cutout waveforms
        const layers = [
          { color: 'rgba(245, 238, 219, 0.9)', fill: 'rgba(245, 238, 219, 0.08)', width: 2.8 * dpr, scale: 1 },
          { color: 'rgba(212, 164, 75, 0.88)', fill: 'rgba(212, 164, 75, 0.1)', width: 2.2 * dpr, scale: 0.76 },
          { color: 'rgba(133, 87, 246, 0.82)', fill: 'rgba(133, 87, 246, 0.12)', width: 1.8 * dpr, scale: 0.54 },
        ];
        layers.forEach((layer, lIdx) => {
          ctx.beginPath();
          const len = timeData.length;
          for (let i = 0; i < len; i++) {
            const x = (i / (len - 1)) * w;
            const norm = (timeData[i] - 128) / 128;
            const envelope = Math.sin((i / (len - 1)) * Math.PI);
            const fallbackWave = Math.sin(i * 0.16 + nowSec * (2.6 + lIdx)) * (0.08 + amp * 0.25);
            const y = cy + (norm * 0.65 + fallbackWave) * (h * 0.36) * layer.scale * envelope;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = layer.width;
          ctx.lineCap = 'round';
          ctx.stroke();
        });
      } else {
        const bars = 44;
        const gap = w * 0.008;
        const barW = (w * 0.86 - gap * (bars - 1)) / bars;
        const startX = w * 0.07;

        for (let i = 0; i < bars; i++) {
          const bin = Math.floor((i / bars) * (freqData.length * 0.75));
          const mag = (freqData[bin] || 0) / 255;
          const heightPct = Math.max(0.08, mag * 0.82 + (phaseRef.current === 'recording' ? amp * 0.25 : 0.04));
          const barH = heightPct * (h * 0.74);
          const x = startX + i * (barW + gap);
          const y = cy - barH / 2;

          ctx.fillStyle = i % 3 === 0 ? '#D4A44B' : i % 3 === 1 ? '#8557F6' : '#E27A48';
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, barW / 2);
          ctx.fill();
        }
      }

      if (phaseRef.current === 'recording') {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    rafRef.current = requestAnimationFrame(draw);
  }, [vizMode]);

  useEffect(() => {
    if (phase === 'recording' || phase === 'paused') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      startVisualizerLoop();
    }
  }, [vizMode, phase, startVisualizerLoop]);

  const startLiveSpeechRecognition = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) return;
    try {
      const rec = new SpeechRec() as {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: (event: {
          resultIndex: number;
          results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
        }) => void;
        start: () => void;
      };
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript?.trim();
          if (!text) continue;
          if (res.isFinal) {
            setConfirmedLines((prev) => [...prev, text]);
          } else {
            interim += (interim ? ' ' : '') + text;
          }
        }
        setInterimLine(interim);
      };
      rec.start();
      recognitionRef.current = rec;
    } catch {
      // ignore
    }
  };

  const checkpointCurrentAudio = useCallback(async () => {
    if (pcmChunksRef.current.length === 0) return;
    const merged = mergePcmChunks();
    const downsampled = downsampleTo16k(merged, sampleRateRef.current);
    const wavBytes = encodeWav(downsampled, 16000);
    const id = incompleteIdRef.current;
    const draft = [...confirmedLines, manualNote.trim()].filter(Boolean).join(' ');

    await saveRecoveryCheckpoint({
      id,
      startedAt: new Date(startedAtRef.current || Date.now()).toISOString(),
      updatedAt: new Date().toISOString(),
      durationMs: accumulatedMsRef.current,
      draftTranscript: draft,
      titleHint: 'Interrupted voice note',
      audioBuffer: wavBytes.buffer.slice(0) as ArrayBuffer,
    });

    try {
      await echoApi.checkpointChunk({
        id,
        audioBase64: arrayBufferToBase64(wavBytes),
        durationMs: accumulatedMsRef.current,
        draftTranscript: draft,
        titleHint: 'Interrupted voice note',
      });
    } catch {
      // IndexedDB checkpoint remains safe
    }
  }, [confirmedLines, manualNote, mergePcmChunks]);

  const startRecording = async (forceSim = false) => {
    setSaveError(null);
    pcmChunksRef.current = [];
    accumulatedMsRef.current = 0;
    setElapsedMs(0);
    setBookmarks([]);
    setConfirmedLines([]);
    setInterimLine('');
    incompleteIdRef.current = `inc-${Date.now().toString(36)}`;

    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    audioCtxRef.current = ctx;
    sampleRateRef.current = ctx.sampleRate;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (ev) => {
      if (phaseRef.current !== 'recording') return;
      const input = ev.inputBuffer.getChannelData(0);
      pcmChunksRef.current.push(new Float32Array(input));
      let sum = 0;
      for (let i = 0; i < input.length; i += 8) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / Math.max(1, input.length / 8));
      setVoiceLevel(Math.min(100, Math.round(rms * 340)));
    };

    let usingSimulator = forceSim;
    if (!forceSim && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.connect(processor);
        processor.connect(ctx.destination);
        setUseSimulatedMic(false);
        setMicStatusNote('Live microphone active');
      } catch {
        usingSimulator = true;
        setMicStatusNote('Microphone unavailable — using Acoustic Voice Simulator');
      }
    } else {
      usingSimulator = true;
      setMicStatusNote('Acoustic Voice Simulator active');
    }

    if (usingSimulator) {
      setUseSimulatedMic(true);
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const masterGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 175;
      lfo.frequency.value = 3.2;
      lfoGain.gain.value = 36;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      masterGain.gain.value = 0.16;

      osc.connect(masterGain);
      masterGain.connect(analyser);
      analyser.connect(processor);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);
      osc.start();
      lfo.start();

      simIntervalRef.current = window.setInterval(() => {
        if (phaseRef.current !== 'recording') return;
        const phraseActive = Math.sin(Date.now() / 420) > -0.35;
        masterGain.gain.setTargetAtTime(phraseActive ? 0.18 : 0.01, ctx.currentTime, 0.04);
      }, 120);
    }

    startedAtRef.current = Date.now();
    setPhase('recording');
    phaseRef.current = 'recording';
    startLiveSpeechRecognition();
    startVisualizerLoop();

    timerRef.current = window.setInterval(() => {
      if (phaseRef.current === 'recording') {
        accumulatedMsRef.current += 200;
        setElapsedMs(accumulatedMsRef.current);
      }
    }, 200);

    checkpointRef.current = window.setInterval(() => {
      if (phaseRef.current === 'recording') {
        void checkpointCurrentAudio();
      }
    }, Math.max(2000, (settings.autoSaveIntervalSec || 3) * 1000));
  };

  const handlePauseResume = () => {
    if (phase === 'recording') {
      setPhase('paused');
      phaseRef.current = 'paused';
      setVoiceLevel(0);
    } else if (phase === 'paused') {
      setPhase('recording');
      phaseRef.current = 'recording';
    }
  };

  const handleAddBookmark = () => {
    const num = bookmarks.length + 1;
    setBookmarks((prev) => [
      ...prev,
      {
        id: `bm-${Date.now().toString(36)}`,
        timeMs: elapsedMs,
        label: `Bookmark ${num}`,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const handleStopAndSave = async () => {
    setPhase('saving');
    phaseRef.current = 'saving';
    setSaveError(null);

    try {
      const merged = mergePcmChunks();
      const downsampled = downsampleTo16k(merged, sampleRateRef.current);
      const safeSamples = downsampled.length >= 4000 ? downsampled : new Float32Array(8000);
      const wavBytes = encodeWav(safeSamples, 16000);
      const audioBase64 = arrayBufferToBase64(wavBytes);
      const draftTranscript = [...confirmedLines, interimLine.trim(), manualNote.trim()]
        .filter(Boolean)
        .join(' ');

      cleanupAudioPipeline();

      const { entry } = await echoApi.commitRecording({
        incompleteId: incompleteIdRef.current,
        audioBase64,
        mimeType: 'audio/wav',
        durationMs: Math.max(1000, elapsedMs),
        draftTranscript,
        notebookId: selectedNotebookId,
        bookmarks,
      });

      await deleteRecoveryCheckpoint(incompleteIdRef.current);
      setSavedEntry(entry);
      setPhase('saved');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to commit recording.');
      setPhase('paused');
    }
  };

  const handleCancelRecording = async () => {
    cleanupAudioPipeline();
    await deleteRecoveryCheckpoint(incompleteIdRef.current);
    try {
      await echoApi.discardIncomplete(incompleteIdRef.current);
    } catch {
      // ignore
    }
    onCancel();
  };

  if (phase === 'saved' && savedEntry) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-6 paper-card rounded-3xl text-center space-y-6 animate-paper-unfold">
        <RecordingSuccessIllustration className="w-44 h-32 mx-auto" />
        <div className="space-y-2">
          <p className="font-mono-meta text-xs text-[#6839D3] dark:text-[#E5B85C]">
            Original Audio Safely Committed
          </p>
          <h2 className="font-editorial text-3xl font-bold">{savedEntry.title}</h2>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
            Saved locally ({formatTimestamp(savedEntry.durationMs)}). Background transcription is running without blocking your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => onSaved(savedEntry)}
            className="py-3 px-6 rounded-xl bg-[#6839D3] hover:bg-[#5B30BE] border border-[#D4A44B]/40 text-white font-semibold text-sm flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4 text-[#E5B85C]" />
            <span>Open Journal Entry</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSavedEntry(null);
              setPhase('ready');
            }}
            className="py-3 px-5 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-sm font-medium cursor-pointer"
          >
            Record Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-10 animate-paper-unfold">
      <div className="relative rounded-3xl overflow-hidden bg-[#0D0C14] text-[#F5EEDB] border border-[#D4A44B]/30 shadow-2xl">
        {/* Hand-inked anime recording muse backdrop */}
        <img
          src={ANIME_RECORDING_URL}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-30 pointer-events-none select-none"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0D0C14]/92 via-[#0D0C14]/75 to-[#0D0C14]/88 pointer-events-none" />

        <div className="relative z-10 p-6 md:p-8 space-y-6">
          {/* Studio Header */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  phase === 'recording'
                    ? 'bg-[#E27A48] animate-pulse'
                    : phase === 'paused'
                      ? 'bg-[#E5B85C]'
                      : 'bg-[#D4A44B]'
                }`}
                aria-hidden="true"
              />
              <span className="font-editorial text-xl font-bold">
                {phase === 'ready'
                  ? 'Recording Sanctuary'
                  : phase === 'recording'
                    ? 'Recording…'
                    : phase === 'paused'
                      ? 'Paused'
                      : 'Committing Audio…'}
              </span>
              {micStatusNote && (
                <span className="text-xs text-[#B6AC9A] hidden sm:inline">· {micStatusNote}</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="studio-notebook" className="sr-only">
                Target Notebook
              </label>
              <select
                id="studio-notebook"
                value={selectedNotebookId}
                onChange={(e) => setSelectedNotebookId(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#161421] border border-[#D4A44B]/30 text-xs text-[#F5EEDB]"
              >
                {notebooks.map((nb) => (
                  <option key={nb.id} value={nb.id}>
                    {nb.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCancelRecording}
                aria-label="Close Recording Studio"
                className="min-w-[40px] min-h-[40px] rounded-xl bg-[#161421] hover:bg-[#232036] border border-[#F5EEDB]/15 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Live Timer */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-editorial italic text-2xl text-[#E5B85C]">Just speak…</p>
              <p className="text-xs text-[#B6AC9A]">Let your thoughts flow into paper and ink.</p>
            </div>

            <div className="text-right">
              <div
                data-testid="recording-timer"
                className="font-mono-meta text-3xl md:text-4xl font-bold tracking-wider tabular-nums text-[#F5EEDB]"
              >
                {formatTimestamp(elapsedMs, true)}
              </div>
              <div className="flex items-center justify-end gap-1.5 text-[11px] text-[#B6AC9A] mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#D4A44B]" />
                <span>Checkpoint every {settings.autoSaveIntervalSec}s</span>
              </div>
            </div>
          </div>

          {/* Audio-Reactive Canvas */}
          <div className="relative h-64 md:h-72 rounded-2xl bg-[#09080E]/80 border border-[#D4A44B]/25 overflow-hidden flex items-center justify-center">
            {phase === 'ready' ? (
              <div className="text-center space-y-4 px-6">
                <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-[#E5B85C] via-[#6839D3] to-[#1A1230] border-2 border-[#D4A44B] flex items-center justify-center shadow-lg shadow-[#6839D3]/35">
                  <Mic className="w-9 h-9 text-[#F5EEDB]" />
                </div>
                <p className="text-sm text-[#DED4BE] max-w-md mx-auto">
                  Start microphone recording or use the Acoustic Voice Simulator. Audio is preserved locally before transcription begins.
                </p>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                data-testid="recording-visualizer"
                className="w-full h-full block"
              />
            )}
          </div>

          {/* Voice Intensity Bar + Visualization Mode Switcher */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#B6AC9A]">Voice Level</span>
              <div className="flex items-center gap-1" aria-label={`Voice level ${voiceLevel}%`}>
                {Array.from({ length: 12 }, (_, idx) => {
                  const active = voiceLevel >= (idx + 1) * 8;
                  return (
                    <span
                      key={idx}
                      className={`w-2 h-4 rounded-sm transition-colors ${
                        active
                          ? idx > 9
                            ? 'bg-[#E27A48]'
                            : idx > 6
                              ? 'bg-[#E5B85C]'
                              : 'bg-[#91DCC1]'
                          : 'bg-[#252236]'
                      }`}
                    />
                  );
                })}
              </div>
            </div>

            <div
              role="group"
              aria-label="Recording visualization mode"
              className="flex items-center gap-1 p-1 rounded-xl bg-[#161421] border border-[#D4A44B]/25"
            >
              {(['orb', 'wave', 'spectrum'] as VisualizationMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setVizMode(mode)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    vizMode === mode
                      ? 'bg-[#6839D3] text-[#F5EEDB]'
                      : 'text-[#B6AC9A] hover:text-[#F5EEDB]'
                  }`}
                >
                  {mode === 'orb' ? 'Orb' : mode === 'wave' ? 'Wave' : 'Spectrum'}
                </button>
              ))}
            </div>
          </div>

          {saveError && (
            <div className="p-3 rounded-xl bg-[#E27A48]/20 border border-[#E27A48]/50 text-xs text-[#F5EEDB]">
              {saveError}
            </div>
          )}

          {/* Primary Recording Controls */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            {phase === 'ready' ? (
              <>
                <button
                  type="button"
                  onClick={() => void startRecording(false)}
                  className="min-h-[48px] px-7 py-3.5 rounded-2xl bg-[#D4A44B] hover:bg-[#C3943C] text-[#14121D] font-bold text-sm flex items-center gap-2.5 shadow-lg cursor-pointer"
                >
                  <Mic className="w-4 h-4" />
                  <span>Start Microphone Recording</span>
                </button>
                <button
                  type="button"
                  onClick={() => void startRecording(true)}
                  className="min-h-[48px] px-5 py-3.5 rounded-2xl bg-[#161421] hover:bg-[#232036] border border-[#D4A44B]/40 text-[#F5EEDB] font-medium text-sm flex items-center gap-2 cursor-pointer"
                >
                  <Radio className="w-4 h-4 text-[#E5B85C]" />
                  <span>Use Voice Simulator</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handlePauseResume}
                  aria-label={phase === 'paused' ? 'Resume recording' : 'Pause recording'}
                  className="min-w-[52px] min-h-[52px] px-5 rounded-2xl bg-[#161421] hover:bg-[#242038] border border-[#F5EEDB]/20 flex items-center justify-center gap-2 text-sm font-medium cursor-pointer"
                >
                  {phase === 'paused' ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                  <span>{phase === 'paused' ? 'Resume' : 'Pause'}</span>
                </button>

                <button
                  type="button"
                  disabled={phase === 'saving'}
                  onClick={() => void handleStopAndSave()}
                  className="min-w-[64px] min-h-[64px] px-8 rounded-full bg-[#E27A48] hover:bg-[#D16837] border-2 border-[#F5EEDB]/30 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-xl shadow-[#E27A48]/30 cursor-pointer"
                >
                  <Square className="w-5 h-5 fill-current" />
                  <span>{phase === 'saving' ? 'Saving Audio…' : 'Stop & Save'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleAddBookmark}
                  aria-label="Add timestamp bookmark"
                  className="min-w-[52px] min-h-[52px] px-5 rounded-2xl bg-[#161421] hover:bg-[#242038] border border-[#D4A44B]/30 flex items-center justify-center gap-2 text-sm font-medium cursor-pointer"
                >
                  <Bookmark className="w-4 h-4 text-[#E5B85C]" />
                  <span>Bookmark ({bookmarks.length})</span>
                </button>
              </>
            )}
          </div>

          {bookmarks.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-[#E5B85C]">
              {bookmarks.map((b) => (
                <span key={b.id} className="font-mono-meta px-2.5 py-1 rounded-lg bg-[#161421] border border-[#D4A44B]/35">
                  {formatTimestamp(b.timeMs)} · {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Emerging Transcript Parchment Panel */}
      <div className="paper-card rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-editorial text-lg font-bold">Live Transcript &amp; Ink Notes</h3>
            <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              {useSimulatedMic
                ? 'Voice Simulator active — jot companion thoughts below while WAV audio captures.'
                : 'Confirmed phrases appear live; full alignment runs locally after saving.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <span>{transcriptOpen ? 'Collapse' : 'Expand'}</span>
            {transcriptOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {transcriptOpen && (
          <div className="space-y-4">
            <div className="min-h-[88px] max-h-44 overflow-y-auto p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/10 dark:border-[#D4A44B]/15 space-y-2 text-sm leading-relaxed">
              {confirmedLines.length === 0 && !interimLine && !manualNote ? (
                <p className="text-[#5A5248] dark:text-[#B6AC9A] italic">
                  Speak naturally or add ink notes below. Audio is committed before transcription runs.
                </p>
              ) : (
                <>
                  {confirmedLines.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                  {interimLine && (
                    <p className="text-[#6839D3] dark:text-[#E5B85C] bg-[#D4A44B]/15 px-2 py-1 rounded-lg">
                      {interimLine}
                    </p>
                  )}
                </>
              )}
            </div>

            <div>
              <label htmlFor="live-manual-note" className="block text-xs font-medium text-[#5A5248] dark:text-[#B6AC9A] mb-1.5">
                Live spoken / companion note (saved into transcript)
              </label>
              <textarea
                id="live-manual-note"
                rows={2}
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="Type any spoken phrases or timestamped thoughts during recording…"
                className="w-full px-4 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A44B]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
