import type {
  AiAnalysisJob,
  AiModelInfo,
  AiResponseLength,
  AiRuntimeInfo,
  AskMemoriesResult,
  EchoSettings,
  EntryAiInsights,
  IncompleteRecording,
  JournalEntry,
  Notebook,
  PeriodicReflectionResult,
  SearchMode,
  SearchResultItem,
  StorageStats,
  TranscriptionJob,
  VoiceEngineRuntimeInfo,
  WhisperModelInfo,
} from '../types/echo';

export interface BootstrapData {
  entries: JournalEntry[];
  notebooks: Notebook[];
  jobs: TranscriptionJob[];
  models: WhisperModelInfo[];
  settings: EchoSettings;
  incompleteRecordings: IncompleteRecording[];
  storageStats: StorageStats;
  engineRuntime: VoiceEngineRuntimeInfo;
  aiModels: AiModelInfo[];
  aiJobs: AiAnalysisJob[];
  aiRuntime: AiRuntimeInfo;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export const echoApi = {
  bootstrap(): Promise<BootstrapData> {
    return apiJson<BootstrapData>('/api/bootstrap');
  },

  checkpointChunk(payload: {
    id: string;
    audioBase64: string;
    durationMs: number;
    draftTranscript?: string;
    titleHint?: string;
    isInitial?: boolean;
  }) {
    return apiJson<{ ok: boolean; byteSize: number }>('/api/recordings/chunk', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  recoverIncomplete(id: string) {
    return apiJson<{ entry: JournalEntry; job: TranscriptionJob }>(
      `/api/recordings/incomplete/${id}/recover`,
      { method: 'POST' }
    );
  },

  discardIncomplete(id: string) {
    return apiJson<{ ok: boolean }>(`/api/recordings/incomplete/${id}`, {
      method: 'DELETE',
    });
  },

  commitRecording(payload: {
    incompleteId?: string;
    title?: string;
    audioBase64: string;
    mimeType?: string;
    durationMs: number;
    draftTranscript?: string;
    notebookId?: string;
    category?: string;
    tags?: string[];
    bookmarks?: JournalEntry['bookmarks'];
    coverImage?: string | null;
  }) {
    return apiJson<{ entry: JournalEntry; job: TranscriptionJob }>('/api/recordings/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createTextEntry(payload: {
    title: string;
    richHtml?: string;
    transcriptText?: string;
    notebookId?: string;
    category?: string;
    tags?: string[];
    coverImage?: string | null;
  }) {
    return apiJson<JournalEntry>('/api/entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateEntry(id: string, payload: Partial<JournalEntry>) {
    return apiJson<JournalEntry>(`/api/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  attachImage(id: string, dataUrl: string, caption?: string) {
    return apiJson<JournalEntry>(`/api/entries/${id}/attach-image`, {
      method: 'POST',
      body: JSON.stringify({ dataUrl, caption }),
    });
  },

  deleteEntry(id: string, deleteAudio = false) {
    return apiJson<{ ok: boolean }>(`/api/entries/${id}?deleteAudio=${deleteAudio}`, {
      method: 'DELETE',
    });
  },

  retranscribe(id: string) {
    return apiJson<{ ok: boolean; jobId: string; status: string }>(
      `/api/entries/${id}/retranscribe`,
      { method: 'POST' }
    );
  },

  retryJob(id: string) {
    return apiJson<{ ok: boolean }>(`/api/jobs/${id}/retry`, { method: 'POST' });
  },

  pauseJob(id: string) {
    return apiJson<{ ok: boolean }>(`/api/jobs/${id}/pause`, { method: 'POST' });
  },

  resumeJob(id: string) {
    return apiJson<{ ok: boolean }>(`/api/jobs/${id}/resume`, { method: 'POST' });
  },

  search(query: string, mode: SearchMode = 'hybrid') {
    return apiJson<SearchResultItem[]>(
      `/api/search?q=${encodeURIComponent(query)}&mode=${encodeURIComponent(mode)}`
    );
  },

  createNotebook(payload: { name: string; description?: string; color?: string }) {
    return apiJson<Notebook>('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteNotebook(id: string) {
    return apiJson<{ ok: boolean }>(`/api/notebooks/${id}`, { method: 'DELETE' });
  },

  importModel(payload: {
    fileName: string;
    sizeBytes: number;
    base64Head?: string;
    language?: string;
  }) {
    return apiJson<WhisperModelInfo[]>('/api/models/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  activateModel(id: string) {
    return apiJson<WhisperModelInfo[]>(`/api/models/${id}/activate`, { method: 'POST' });
  },

  deleteModel(id: string) {
    return apiJson<WhisperModelInfo[]>(`/api/models/${id}`, { method: 'DELETE' });
  },

  // Google On-Device AI (Gemma / LiteRT-LM / EmbeddingGemma / Gemini Nano)
  importAiModel(payload: {
    fileName: string;
    sizeBytes: number;
    base64Head?: string;
    quantisation?: string;
  }) {
    return apiJson<AiModelInfo[]>('/api/ai/models/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  activateAiModel(id: string) {
    return apiJson<AiModelInfo[]>(`/api/ai/models/${id}/activate`, { method: 'POST' });
  },

  deleteAiModel(id: string) {
    return apiJson<AiModelInfo[]>(`/api/ai/models/${id}`, { method: 'DELETE' });
  },

  benchmarkAiModel(id: string) {
    return apiJson<{
      ok: boolean;
      modelId: string;
      latencyMs: number;
      tokensPerSec: number;
      compatible: boolean;
      tier: string;
      message: string;
    }>(`/api/ai/models/${id}/benchmark`, { method: 'POST' });
  },

  analyzeEntryWithAi(entryId: string) {
    return apiJson<{ job: AiAnalysisJob; insights: EntryAiInsights | null; entry: JournalEntry }>(
      `/api/ai/entries/${entryId}/analyze`,
      { method: 'POST' }
    );
  },

  regenerateEntryAi(entryId: string) {
    return apiJson<{ job: AiAnalysisJob; insights: EntryAiInsights | null; entry: JournalEntry }>(
      `/api/ai/entries/${entryId}/regenerate`,
      { method: 'POST' }
    );
  },

  regenerateAllAi() {
    return apiJson<{ processed: number; aiJobs: AiAnalysisJob[] }>('/api/ai/regenerate-all', {
      method: 'POST',
    });
  },

  cancelAiJob(jobId: string) {
    return apiJson<{ ok: boolean; aiJobs: AiAnalysisJob[] }>(`/api/ai/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
  },

  askMyMemories(question: string, responseLength?: AiResponseLength) {
    return apiJson<AskMemoriesResult>('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ question, responseLength }),
    });
  },

  getPeriodicReflection(period: 'daily' | 'weekly' | 'monthly') {
    return apiJson<PeriodicReflectionResult>('/api/ai/reflections', {
      method: 'POST',
      body: JSON.stringify({ period }),
    });
  },

  updateSettings(partial: Partial<EchoSettings>) {
    return apiJson<EchoSettings>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(partial),
    });
  },

  getStorageStats() {
    return apiJson<StorageStats>('/api/storage/stats');
  },

  recoverOrphans() {
    return apiJson<{ recoveredCount: number; storageStats: StorageStats }>(
      '/api/storage/recover-orphans',
      { method: 'POST' }
    );
  },

  exportBackup() {
    return apiJson<Record<string, unknown>>('/api/backup/export');
  },

  restoreBackup(payload: unknown) {
    return apiJson<{ ok: boolean; restoredEntries: number }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

