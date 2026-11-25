export type ThemeMode = 'dark' | 'light';
export type AccentColorId = 'violet' | 'orange' | 'mint' | 'lavender';
export type VisualizationMode = 'orb' | 'wave' | 'spectrum';
export type HighlightColor = 'yellow' | 'purple' | 'mint' | 'pink' | 'orange';
export type EntryViewMode = 'clean' | 'reading' | 'audio';
export type TranscriptionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'waiting_for_model';

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  speaker?: string;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  segmentId: string;
  precision: 'word' | 'segment-interpolated';
}

export interface BookmarkMarker {
  id: string;
  timeMs: number;
  label: string;
  createdAt: string;
}

export interface EntryAttachment {
  id: string;
  url: string;
  caption?: string;
  createdAt: string;
}

export type WhisperEngineId = 'whisper.cpp' | 'sherpa-onnx';

export interface WhisperVadConfig {
  threshold: number;
  minSpeechDurationMs: number;
  minSilenceDurationMs: number;
  maxSpeechDurationS: number;
  speechPadMs: number;
  samplesOverlap: number;
}

export interface VoiceProsodyMetrics {
  rmsEnergy: number;
  silenceRatio: number;
  speechDensityPct: number;
  wordsPerMinute: number;
  estimatedPitchHz: number | null;
  deliveryLabel: string;
}

export interface VoiceEngineRuntimeInfo {
  primaryEngine: WhisperEngineId;
  whisperCliAvailable: boolean;
  whisperCliPath: string | null;
  ffmpegAvailable: boolean;
  vadModelPath: string | null;
  sherpaOnnxAvailable: boolean;
  activeModelBinaryReady: boolean;
  executionMode: 'native-whisper-cpp' | 'offline-vad-dsp';
}

export type AiProviderId = 'litert-lm-gemma' | 'android-gemini-nano' | 'offline-compact';
export type AiResponseLength = 'concise' | 'balanced' | 'detailed';
export type AiJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused_low_memory';

export interface EntryAiInsights {
  summary: string;
  topic: string;
  keyIdeas: string[];
  growthObservation: string;
  reflectionQuestions: string[];
  proofreadText: string;
  suggestedTitle: string;
  suggestedTags: string[];
  generatedBy: string;
  modelId: string | null;
  generatedAt: string;
}

export interface AiModelInfo {
  id: string;
  name: string;
  fileName: string;
  format: 'litertlm' | 'task' | 'tflite' | 'aicore';
  family: 'gemma' | 'embedding-gemma' | 'gemini-nano';
  quantisation: string;
  sizeBytes: number;
  ramRequirementMb: number;
  contextLength: number;
  backend: 'android-litert-lm' | 'windows-litert-lm' | 'android-aicore' | 'cross-platform-litert';
  status: 'active' | 'installed';
  supportsDevice: boolean;
  hardwareNote: string;
  importedAt: string;
  checksum: string;
}

export interface AiAnalysisJob {
  id: string;
  entryId: string;
  entryTitle: string;
  taskType: 'full-analysis' | 'embedding' | 'reflection' | 'proofread';
  status: AiJobStatus;
  progress: number;
  provider: AiProviderId;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiRuntimeInfo {
  aiEnabled: boolean;
  activeProvider: AiProviderId;
  litertCliAvailable: boolean;
  litertCliPath: string | null;
  androidGeminiNanoSupported: boolean;
  deviceTotalRamMb: number;
  deviceFreeRamMb: number;
  embeddingCount: number;
  cloudRequestsMade: number;
}

export interface MemoryCitation {
  entryId: string;
  entryTitle: string;
  createdAt: string;
  timestampMs: number | null;
  timestampLabel: string | null;
  excerpt: string;
  score: number;
  matchSource: 'hybrid' | 'semantic' | 'keyword';
}

export interface AskMemoriesResult {
  question: string;
  answer: string;
  citations: MemoryCitation[];
  providerLabel: string;
  groundingNotice: string;
  retrievedCount: number;
  insufficientEvidence: boolean;
}

export interface PeriodicReflectionResult {
  period: 'daily' | 'weekly' | 'monthly';
  headline: string;
  summary: string;
  topTopics: Array<{ topic: string; count: number }>;
  growthObservations: string[];
  questions: string[];
  entryCount: number;
  totalMinutes: number;
  providerLabel: string;
}

export interface JournalEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notebookId: string;
  category: string;
  tags: string[];
  isFavorite: boolean;
  isPinned: boolean;
  isArchived: boolean;
  coverImage: string | null;
  recordingId: string | null;
  audioUrl: string | null;
  durationMs: number;
  waveformPeaks: number[];
  transcriptText: string;
  richHtml: string;
  segments: TranscriptSegment[];
  bookmarks: BookmarkMarker[];
  attachments: EntryAttachment[];
  transcriptionStatus: TranscriptionStatus | 'none';
  transcriptionError: string | null;
  transcriptionProgress: number;
  entryType: 'voice' | 'text';
  prosody?: VoiceProsodyMetrics | null;
  aiInsights?: EntryAiInsights | null;
}

export interface Notebook {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
}

export interface TranscriptionJob {
  id: string;
  recordingId: string;
  entryId: string;
  entryTitle: string;
  status: TranscriptionStatus;
  progress: number;
  modelId: string | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhisperModelInfo {
  id: string;
  name: string;
  fileName: string;
  format: 'gguf' | 'bin' | 'built-in';
  sizeBytes: number;
  ramRequirementMb: number;
  language: string;
  status: 'active' | 'installed';
  importedAt: string;
  checksum: string;
}

export interface IncompleteRecording {
  id: string;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  chunkCount: number;
  byteSize: number;
  draftTranscript: string;
  titleHint: string;
}

export interface EchoSettings {
  userName: string;
  theme: ThemeMode;
  accentColor: AccentColorId;
  editorFont: 'inter' | 'fraunces' | 'space-grotesk' | 'jetbrains-mono';
  recordingQuality: 'standard' | 'high' | 'studio';
  defaultVisualization: VisualizationMode;
  playbackSpeed: number;
  autoSaveIntervalSec: number;
  autoBackupEnabled: boolean;
  reducedMotion: boolean;
  dailyGoalMinutes: number;
  simulateTranscriptionFailure: boolean;
  appLockEnabled: boolean;
  appLockPinHash: string | null;
  hasCompletedOnboarding: boolean;
  preferredEngine: WhisperEngineId;
  vadEnabledForLongNotes: boolean;
  vadConfig: WhisperVadConfig;
  customVocabulary: string[];
  aiEnabled: boolean;
  aiProviderPreference: AiProviderId;
  aiResponseLength: AiResponseLength;
  aiBackgroundQueueEnabled: boolean;
  simulateAiLowMemory: boolean;
}

export interface StorageStats {
  totalBytes: number;
  directories: Array<{
    name: string;
    bytes: number;
    fileCount: number;
  }>;
  entryCount: number;
  recordingCount: number;
  orphanFiles: string[];
}

export type SearchMode = 'hybrid' | 'semantic' | 'fts';

export interface SearchResultItem {
  entry: JournalEntry;
  snippetHtml: string;
  matchedIn: string[];
  semanticScore?: number;
}

