import type { TranscriptSegment, VoiceProsodyMetrics, WhisperVadConfig } from '../types/echo';

/**
 * Pure offline speech engine utilities synthesized from inspecting:
 * - ggml-org/whisper.cpp (MIT): CLI flags, -ojf JSON timestamps, GGML/GGUF headers, VAD args
 * - OpenWhispr/openwhispr (MIT): duration-scaled timeouts, VAD clamping, hallucination prevention (#1454/#2150)
 * - intrepidkarthi/dailyvox (MIT): capped local custom vocabulary + on-device vocal prosody DSP
 * - k2-fsa/sherpa-onnx (Apache-2.0): secondary streaming / Silero VAD / speaker ID architecture comparison
 */

export const DEFAULT_WHISPER_VAD_CONFIG: Readonly<WhisperVadConfig> = Object.freeze({
  threshold: 0.5,
  minSpeechDurationMs: 250,
  minSilenceDurationMs: 200,
  maxSpeechDurationS: 30,
  speechPadMs: 100,
  samplesOverlap: 0.5,
});

export const WHISPER_VAD_LIMITS: Record<
  keyof WhisperVadConfig,
  { min: number; max: number; round: boolean }
> = {
  threshold: { min: 0.1, max: 0.95, round: false },
  minSpeechDurationMs: { min: 50, max: 2000, round: true },
  minSilenceDurationMs: { min: 50, max: 2000, round: true },
  maxSpeechDurationS: { min: 5, max: 120, round: true },
  speechPadMs: { min: 0, max: 1000, round: true },
  samplesOverlap: { min: 0, max: 0.95, round: false },
};

export function sanitizeWhisperVadConfig(
  input: Partial<WhisperVadConfig> | null | undefined
): WhisperVadConfig {
  const merged = { ...DEFAULT_WHISPER_VAD_CONFIG, ...(input || {}) };
  const out = { ...DEFAULT_WHISPER_VAD_CONFIG };
  (Object.keys(DEFAULT_WHISPER_VAD_CONFIG) as Array<keyof WhisperVadConfig>).forEach((key) => {
    const raw = merged[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    const { min, max, round } = WHISPER_VAD_LIMITS[key];
    const val = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_WHISPER_VAD_CONFIG[key];
    out[key] = round ? Math.round(val) : Number(val.toFixed(2));
  });
  return out;
}

/**
 * Pause-heavy short dictations can get over-trimmed by VAD and cause Whisper
 * to hallucinate prompt vocabulary; long-form journal notes benefit from VAD.
 */
export function resolveContextVadEnabled(
  opts: { vadEnabledForLongNotes?: boolean; vadEnabledForShortDictation?: boolean },
  context: 'shortDictation' | 'journalNote'
): boolean {
  if (context === 'shortDictation') {
    return opts.vadEnabledForShortDictation === true;
  }
  return opts.vadEnabledForLongNotes !== false;
}

const TIMEOUT_FLOOR_MS = 300_000; // 5 minutes
const TIMEOUT_PER_AUDIO_SEC_MS = 10_000; // 10x real-time budget for slow CPUs
const UNKNOWN_DURATION_TIMEOUT_MS = 3_600_000; // 60 minutes
const TIMEOUT_CEILING_MS = 86_400_000; // 24 hours

export function computeTranscriptionTimeoutMs(durationMs: number): number {
  const seconds = durationMs / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return UNKNOWN_DURATION_TIMEOUT_MS;
  }
  return Math.min(
    TIMEOUT_CEILING_MS,
    Math.max(TIMEOUT_FLOOR_MS, Math.ceil(seconds * TIMEOUT_PER_AUDIO_SEC_MS))
  );
}

export const MAX_CUSTOM_VOCABULARY_TERMS = 100;

export function mergeCustomVocabulary(
  existing: string[],
  additions: string[],
  maxTerms = MAX_CUSTOM_VOCABULARY_TERMS
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const raw of [...additions, ...existing]) {
    const clean = raw.trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(clean);
    if (ordered.length >= maxTerms) break;
  }

  return ordered;
}

export function buildCustomVocabularyPrompt(terms: string[]): string {
  const clean = mergeCustomVocabulary([], terms, MAX_CUSTOM_VOCABULARY_TERMS);
  if (clean.length === 0) return '';
  return `Personal vocabulary: ${clean.join(', ')}.`;
}

export function buildWhisperCliArgs(params: {
  modelPath: string;
  wavPath: string;
  jsonOutputPrefix: string;
  language?: string;
  threads?: number;
  customVocabulary?: string[];
  vadEnabled?: boolean;
  vadModelPath?: string | null;
  vadConfig?: Partial<WhisperVadConfig>;
}): string[] {
  const args: string[] = [
    '-m',
    params.modelPath,
    '-f',
    params.wavPath,
    '-l',
    params.language === 'multi' ? 'auto' : params.language || 'en',
    '-t',
    String(Math.max(1, Math.min(8, params.threads || 4))),
    '--output-json-full',
    '--output-file',
    params.jsonOutputPrefix,
    // Keep timestamp tokens active (--max-len instead of --no-timestamps) so 30s seek windows stay accurate
    '--max-len',
    '4096',
  ];

  const prompt = buildCustomVocabularyPrompt(params.customVocabulary || []);
  if (prompt) {
    args.push('--prompt', prompt);
  }

  if (params.vadEnabled && params.vadModelPath) {
    const cfg = sanitizeWhisperVadConfig(params.vadConfig);
    args.push(
      '--vad',
      '--vad-model',
      params.vadModelPath,
      '--vad-threshold',
      String(cfg.threshold),
      '--vad-min-speech-duration-ms',
      String(cfg.minSpeechDurationMs),
      '--vad-min-silence-duration-ms',
      String(cfg.minSilenceDurationMs),
      '--vad-max-speech-duration-s',
      String(cfg.maxSpeechDurationS),
      '--vad-speech-pad-ms',
      String(cfg.speechPadMs),
      '--vad-samples-overlap',
      String(cfg.samplesOverlap)
    );
  }

  return args;
}

interface WhisperCppJsonToken {
  text?: string;
  p?: number;
}

interface WhisperCppJsonSegment {
  offsets?: { from?: number; to?: number };
  text?: string;
  tokens?: WhisperCppJsonToken[];
}

interface WhisperCppJsonDoc {
  transcription?: WhisperCppJsonSegment[];
}

export function parseWhisperCppJsonOutput(rawJson: string): {
  transcriptText: string;
  segments: TranscriptSegment[];
} {
  const parsed = JSON.parse(rawJson) as WhisperCppJsonDoc;
  const rawSegments = Array.isArray(parsed.transcription) ? parsed.transcription : [];
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    const cleanText = String(seg.text || '')
      .replace(/\[_BEG_\]|\[_TT_\d+\]|\[BLANK_AUDIO\]/g, '')
      .trim();
    if (!cleanText) continue;

    const startMs = Math.max(0, Math.round(Number(seg.offsets?.from ?? 0)));
    const endMs = Math.max(startMs + 250, Math.round(Number(seg.offsets?.to ?? startMs + 1000)));
    const tokenProbs = Array.isArray(seg.tokens)
      ? seg.tokens.map((t) => t.p).filter((p): p is number => typeof p === 'number' && Number.isFinite(p))
      : [];
    const avgProb =
      tokenProbs.length > 0
        ? Number((tokenProbs.reduce((s, p) => s + p, 0) / tokenProbs.length).toFixed(3))
        : 0.92;

    segments.push({
      id: `seg-wcpp-${i + 1}`,
      startMs,
      endMs,
      text: cleanText,
      confidence: avgProb,
    });
  }

  return {
    transcriptText: segments.map((s) => s.text).join(' ').trim(),
    segments,
  };
}

export function isRealGgmlBinaryHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const text4 = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  // GGML ('lmgg' / 'ggml' / 'ggjt' / 'ggmf') or GGUF ('GGUF')
  return (
    text4 === 'GGUF' ||
    text4 === 'lmgg' ||
    text4 === 'ggml' ||
    text4 === 'ggjt' ||
    text4 === 'ggmf'
  );
}

/**
 * Pure PCM acoustic delivery / prosody analyzer adapted from DailyVox's ProsodyExtractor.
 * Non-diagnostic: summarizes energy, pause density, speaking rate (WPM), and F0 pitch.
 */
export function extractOfflineProsody(
  samples: Float32Array,
  sampleRate: number,
  wordCount: number
): VoiceProsodyMetrics | null {
  if (samples.length < sampleRate * 0.4 || sampleRate <= 0) return null;

  const frameLength = 1024;
  const hopLength = 512;
  const silenceRmsThreshold = 0.015;
  let totalEnergySq = 0;
  let silentFrames = 0;
  let totalFrames = 0;
  const pitchEstimates: number[] = [];

  const minLag = Math.max(20, Math.floor(sampleRate / 380)); // 380 Hz upper bound
  const maxLag = Math.min(frameLength - 1, Math.floor(sampleRate / 75)); // 75 Hz lower bound

  for (let start = 0; start + frameLength <= samples.length; start += hopLength) {
    let sumSq = 0;
    for (let i = 0; i < frameLength; i++) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / frameLength);
    totalEnergySq += rms * rms;
    totalFrames += 1;

    if (rms < silenceRmsThreshold) {
      silentFrames += 1;
      continue;
    }

    // Simple frame autocorrelation F0 estimation on voiced frames
    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < frameLength - lag; i++) {
        const a = samples[start + i];
        const b = samples[start + i + lag];
        corr += a * b;
        normA += a * a;
        normB += b * b;
      }
      const denom = Math.sqrt(normA * normB);
      const r = denom > 0 ? corr / denom : 0;
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }
    if (bestLag > 0 && bestCorr > 0.45) {
      pitchEstimates.push(sampleRate / bestLag);
    }
  }

  if (totalFrames === 0) return null;
  const rmsEnergy = Number(Math.sqrt(totalEnergySq / totalFrames).toFixed(3));
  const silenceRatio = Number((silentFrames / totalFrames).toFixed(3));
  const speechDensityPct = Math.round((1 - silenceRatio) * 100);
  const durationMinutes = Math.max(1 / 60, samples.length / sampleRate / 60);
  const wordsPerMinute = Math.max(0, Math.round(wordCount / durationMinutes));

  let estimatedPitchHz: number | null = null;
  if (pitchEstimates.length >= 3) {
    const sorted = [...pitchEstimates].sort((a, b) => a - b);
    estimatedPitchHz = Math.round(sorted[Math.floor(sorted.length / 2)]);
  }

  let deliveryLabel = 'Measured & Reflective';
  if (wordsPerMinute >= 145 || rmsEnergy >= 0.22) {
    deliveryLabel = 'Expressive & Animated';
  } else if (speechDensityPct < 45 || wordsPerMinute < 95) {
    deliveryLabel = 'Calm & Contemplative';
  } else if (rmsEnergy >= 0.12 && speechDensityPct >= 55) {
    deliveryLabel = 'Calm & Steady';
  }

  return {
    rmsEnergy,
    silenceRatio,
    speechDensityPct,
    wordsPerMinute,
    estimatedPitchHz,
    deliveryLabel,
  };
}

export interface EngineComparisonRow {
  project: string;
  license: string;
  roleInEcho: string;
  strengths: string;
  tradeoff: string;
}

export const REFERENCE_ENGINE_MATRIX: ReadonlyArray<EngineComparisonRow> = [
  {
    project: 'ggml-org/whisper.cpp',
    license: 'MIT',
    roleInEcho: 'Primary offline STT engine',
    strengths: 'Single-file .bin/.gguf models, JSON word/segment timestamps (-ojf), Metal/Vulkan/CPU SIMD, zero cloud calls.',
    tradeoff: 'Batch 30s decode windows; needs Silero VAD guardrails on long silence.',
  },
  {
    project: 'k2-fsa/sherpa-onnx',
    license: 'Apache-2.0',
    roleInEcho: 'Alternative streaming & VAD engine',
    strengths: 'Streaming Zipformer/Transducer ASR, Silero VAD, speaker diarization, Flutter/Android/Windows/Node-addon bindings.',
    tradeoff: 'Multi-file ONNX model bundles (encoder/decoder/tokens.txt) increase packaging complexity.',
  },
  {
    project: 'OpenWhispr/openwhispr',
    license: 'MIT',
    roleInEcho: 'Desktop pipeline patterns adopted',
    strengths: '16 kHz mono WAV normalization, audio-scaled transcription timeouts, VAD clamping (#1454), seek-window fix (#2150).',
    tradeoff: 'Includes optional BYOK cloud AI SDKs that ECHO explicitly excludes to stay 100% offline.',
  },
  {
    project: 'intrepidkarthi/dailyvox',
    license: 'MIT',
    roleInEcho: 'Voice-journal UX & DSP patterns adopted',
    strengths: 'Zero-account local privacy, 100-term personal CustomVocabulary biasing, offline vocal ProsodyExtractor.',
    tradeoff: 'Relies on OS speech recognizers (SFSpeech/Android) and keeps TwinEngine closed outside the public repo.',
  },
];
