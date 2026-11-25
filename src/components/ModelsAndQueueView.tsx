import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BookMarked,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDriveUpload,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';
import { arrayBufferToBase64, echoApi } from '../services/echoApi';
import {
  REFERENCE_ENGINE_MATRIX,
  mergeCustomVocabulary,
  sanitizeWhisperVadConfig,
} from '../utils/whisperEngine';
import { ON_DEVICE_AI_ARCHITECTURE } from '../utils/onDeviceAi';
import type {
  AiAnalysisJob,
  AiModelInfo,
  AiRuntimeInfo,
  EchoSettings,
  TranscriptionJob,
  VoiceEngineRuntimeInfo,
  WhisperModelInfo,
} from '../types/echo';

interface ModelsAndQueueViewProps {
  models: WhisperModelInfo[];
  jobs: TranscriptionJob[];
  aiModels: AiModelInfo[];
  aiJobs: AiAnalysisJob[];
  aiRuntime: AiRuntimeInfo;
  settings: EchoSettings;
  engineRuntime: VoiceEngineRuntimeInfo;
  onUpdateSettings: (partial: Partial<EchoSettings>) => Promise<void>;
  onRefresh: () => Promise<void>;
  onOpenEntry: (entryId: string) => void;
}

export function ModelsAndQueueView({
  models,
  jobs,
  aiModels,
  aiJobs,
  aiRuntime,
  settings,
  engineRuntime,
  onUpdateSettings,
  onRefresh,
  onOpenEntry,
}: ModelsAndQueueViewProps) {
  const [importing, setImporting] = useState(false);
  const [importingAi, setImportingAi] = useState(false);
  const [language, setLanguage] = useState('en');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [benchmarkingId, setBenchmarkingId] = useState<string | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [vocabInput, setVocabInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const aiFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleModelFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportNotice(null);
    try {
      // Read header slice up to 512KB so multi-hundred-MB GGUF/BIN models import instantaneously offline
      const slice = file.slice(0, 512 * 1024);
      const buf = await slice.arrayBuffer();
      await echoApi.importModel({
        fileName: file.name,
        sizeBytes: file.size,
        base64Head: arrayBufferToBase64(buf),
        language,
      });
      await onRefresh();
      setImportNotice(`Imported "${file.name}" into ECHO/models and set as active.`);
    } catch (err) {
      setImportNotice(err instanceof Error ? err.message : 'Model import failed.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddVocabularyTerm = async (e: React.FormEvent) => {
    e.preventDefault();
    const parts = vocabInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = mergeCustomVocabulary(settings.customVocabulary || [], parts);
    await onUpdateSettings({ customVocabulary: next });
    setVocabInput('');
  };

  const handleRemoveVocabularyTerm = async (term: string) => {
    const next = (settings.customVocabulary || []).filter((t) => t !== term);
    await onUpdateSettings({ customVocabulary: next });
  };

  const handleAiModelFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingAi(true);
    setAiNotice(null);
    try {
      const slice = file.slice(0, 512 * 1024);
      const buf = await slice.arrayBuffer();
      await echoApi.importAiModel({
        fileName: file.name,
        sizeBytes: file.size,
        base64Head: arrayBufferToBase64(buf),
      });
      await onRefresh();
      setAiNotice(`Imported local AI model "${file.name}" into ECHO/models.`);
    } catch (err) {
      setAiNotice(err instanceof Error ? err.message : 'AI model import failed.');
    } finally {
      setImportingAi(false);
      if (aiFileInputRef.current) aiFileInputRef.current.value = '';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const vad = sanitizeWhisperVadConfig(settings.vadConfig);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 animate-paper-unfold">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-editorial text-3xl font-bold">Offline Voice Engine &amp; Queue</h1>
          <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
            Import local whisper.cpp (.bin / .gguf) model files, tune offline VAD &amp; custom vocabulary, and monitor the persistent SQLite queue.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            aria-label="Model language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="px-3 py-2.5 rounded-xl paper-card text-xs"
          >
            <option value="en">English (en)</option>
            <option value="multi">Multilingual</option>
          </select>
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[42px] px-4 py-2.5 rounded-xl bg-[#6839D3] hover:bg-[#5A2EC0] border border-[#D4A44B]/40 text-[#F5EEDB] text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <HardDriveUpload className="w-4 h-4 text-[#E5B85C]" />
            <span>{importing ? 'Importing…' : 'Import Local Model (.bin / .gguf)'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".bin,.gguf"
            onChange={handleModelFilePicked}
            className="hidden"
          />
        </div>
      </div>

      {importNotice && (
        <div className="p-4 rounded-2xl bg-[#D4A44B]/15 border border-[#D4A44B]/45 text-sm font-medium">
          {importNotice}
        </div>
      )}

      {/* Local Speech Runtime & Recording-First Guardrails */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C]" />
            <h2 className="font-editorial text-xl font-bold">Local Speech Runtime Architecture</h2>
          </div>
          <span className="font-mono-meta text-xs text-[#6839D3] dark:text-[#E5B85C] font-semibold">
            {engineRuntime.executionMode === 'native-whisper-cpp'
              ? 'Native whisper-cli + GGML Ready'
              : 'Offline Acoustic VAD DSP Active'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">whisper.cpp CLI</div>
            <div className="font-semibold mt-1">
              {engineRuntime.whisperCliAvailable
                ? `Detected (${engineRuntime.whisperCliPath})`
                : 'Place binary in ECHO/bin/whisper-cli'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">16 kHz PCM Pipeline</div>
            <div className="font-semibold mt-1">
              {engineRuntime.ffmpegAvailable
                ? 'Local FFmpeg normalization ready'
                : 'Built-in 16 kHz RIFF WAV encoder'}
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">Preferred Engine</div>
            <div className="mt-1">
              <select
                aria-label="Preferred offline speech engine"
                value={settings.preferredEngine}
                onChange={(e) =>
                  void onUpdateSettings({
                    preferredEngine: e.target.value as EchoSettings['preferredEngine'],
                  })
                }
                className="w-full bg-transparent font-semibold focus:outline-none cursor-pointer"
              >
                <option value="whisper.cpp">whisper.cpp (Primary · GGML/GGUF)</option>
                <option value="sherpa-onnx">sherpa-onnx (Alternative · Streaming/VAD)</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Installed Whisper Models */}
      <section className="space-y-4">
        <h2 className="font-editorial text-xl font-bold">Installed Local Models (ECHO/models)</h2>

        {models.length === 0 ? (
          <div className="paper-card rounded-2xl p-8 text-center space-y-3">
            <Cpu className="w-8 h-8 text-[#E27A48] mx-auto" />
            <h3 className="font-editorial text-lg font-bold">No Whisper model installed</h3>
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] max-w-md mx-auto">
              Recordings are still saved safely. Import a local .bin or .gguf Whisper model file to resume queued transcriptions.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {models.map((model) => (
              <div
                key={model.id}
                className={`p-5 rounded-2xl border space-y-4 ${
                  model.status === 'active'
                    ? 'paper-card border-[#D4A44B] ring-1 ring-[#D4A44B]/40'
                    : 'paper-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-editorial text-base font-bold">{model.name}</h3>
                      {model.status === 'active' && (
                        <span className="font-mono-meta text-[11px] text-[#B68224] dark:text-[#E5B85C] font-semibold">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-1">
                      {model.fileName} · {model.format.toUpperCase()}
                    </p>
                  </div>

                  {model.id !== 'model-base-en' && (
                    <button
                      type="button"
                      aria-label={`Remove model ${model.name}`}
                      onClick={async () => {
                        await echoApi.deleteModel(model.id);
                        await onRefresh();
                      }}
                      className="p-2 rounded-lg text-[#5A5248] hover:text-[#E27A48] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs font-mono-meta text-[#5A5248] dark:text-[#B6AC9A] pt-2 border-t border-black/8 dark:border-[#D4A44B]/15">
                  <div>
                    <div className="opacity-70">Size</div>
                    <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                      {formatBytes(model.sizeBytes)}
                    </div>
                  </div>
                  <div>
                    <div className="opacity-70">Est. RAM</div>
                    <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                      ~{model.ramRequirementMb} MB
                    </div>
                  </div>
                  <div>
                    <div className="opacity-70">Language</div>
                    <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                      {model.language}
                    </div>
                  </div>
                </div>

                {model.status !== 'active' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await echoApi.activateModel(model.id);
                      await onRefresh();
                    }}
                    className="w-full py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer"
                  >
                    Set Active Model
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Personal Custom Vocabulary & Context-Aware VAD Guardrails */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="paper-card rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookMarked className="w-4 h-4 text-[#D4A44B]" />
              <h2 className="font-editorial text-lg font-bold">Personal Custom Vocabulary</h2>
            </div>
            <span className="font-mono-meta text-[11px] text-[#5A5248] dark:text-[#B6AC9A]">
              {(settings.customVocabulary || []).length}/100 terms
            </span>
          </div>
          <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
            Names, places, and specialist terms seeded into local Whisper prompts so corrections persist offline across future entries.
          </p>

          <form onSubmit={handleAddVocabularyTerm} className="flex items-center gap-2">
            <input
              type="text"
              aria-label="Add custom vocabulary term"
              value={vocabInput}
              onChange={(e) => setVocabInput(e.target.value)}
              placeholder="Add name, place, or term…"
              className="flex-1 px-3 py-2 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-xs"
            />
            <button
              type="submit"
              className="min-h-[36px] px-3 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            {(settings.customVocabulary || []).map((term) => (
              <span
                key={term}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F5EEDB] dark:bg-[#0D0C14] border border-[#D4A44B]/30 text-xs font-medium"
              >
                <span>{term}</span>
                <button
                  type="button"
                  aria-label={`Remove vocabulary term ${term}`}
                  onClick={() => void handleRemoveVocabularyTerm(term)}
                  className="text-[#5A5248] hover:text-[#E27A48] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="paper-card rounded-3xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#6839D3] dark:text-[#E5B85C]" />
            <h2 className="font-editorial text-lg font-bold">VAD &amp; Hallucination Guardrails</h2>
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-xs font-semibold">Trim Extended Silence on Long Recordings</div>
              <div className="text-[11px] text-[#5A5248] dark:text-[#B6AC9A]">
                Automatically bypassed on short dictations (&lt;8s) to prevent prompt hallucinations.
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.vadEnabledForLongNotes}
              onChange={(e) => void onUpdateSettings({ vadEnabledForLongNotes: e.target.checked })}
              className="w-4 h-4 accent-[#6839D3]"
            />
          </label>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label htmlFor="vad-threshold" className="block text-[11px] font-mono-meta mb-1">
                Speech Threshold ({vad.threshold})
              </label>
              <input
                id="vad-threshold"
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={vad.threshold}
                onChange={(e) =>
                  void onUpdateSettings({
                    vadConfig: sanitizeWhisperVadConfig({ ...vad, threshold: Number(e.target.value) }),
                  })
                }
                className="w-full accent-[#6839D3]"
              />
            </div>
            <div>
              <label htmlFor="vad-pad" className="block text-[11px] font-mono-meta mb-1">
                Speech Padding ({vad.speechPadMs} ms)
              </label>
              <input
                id="vad-pad"
                type="range"
                min={0}
                max={500}
                step={25}
                value={vad.speechPadMs}
                onChange={(e) =>
                  void onUpdateSettings({
                    vadConfig: sanitizeWhisperVadConfig({ ...vad, speechPadMs: Number(e.target.value) }),
                  })
                }
                className="w-full accent-[#D4A44B]"
              />
            </div>
          </div>
        </section>
      </div>

      {/* Persistent SQLite Transcription Queue */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-editorial text-xl font-bold">Persistent Transcription Queue</h2>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="text-xs font-medium text-[#6839D3] dark:text-[#E5B85C] flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Queue</span>
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="paper-card rounded-2xl p-6 text-sm text-[#5A5248] dark:text-[#B6AC9A]">
            No background transcription jobs queued yet. New voice recordings automatically enqueue here after audio is safely committed.
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="paper-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    {job.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-[#D4A44B]" />
                    ) : job.status === 'failed' || job.status === 'waiting_for_model' ? (
                      <AlertCircle className="w-4 h-4 text-[#E27A48]" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-[#6839D3] dark:text-[#E5B85C] animate-spin" />
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenEntry(job.entryId)}
                      className="font-editorial font-bold text-sm hover:text-[#6839D3] dark:hover:text-[#E5B85C] cursor-pointer text-left"
                    >
                      {job.entryTitle}
                    </button>
                  </div>
                  <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                    Status: {job.status} · Progress: {job.progress}% · Attempts: {job.attempts}
                  </div>
                  {job.errorMessage && (
                    <p className="text-xs text-[#E27A48]">{job.errorMessage}</p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {(job.status === 'failed' || job.status === 'waiting_for_model') && (
                    <button
                      type="button"
                      onClick={async () => {
                        await echoApi.retryJob(job.id);
                        await onRefresh();
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry</span>
                    </button>
                  )}
                  {(job.status === 'pending' || job.status === 'processing') && (
                    <button
                      type="button"
                      onClick={async () => {
                        await echoApi.pauseJob(job.id);
                        await onRefresh();
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause</span>
                    </button>
                  )}
                  {job.status === 'paused' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await echoApi.resumeJob(job.id);
                        await onRefresh();
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Resume</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Google On-Device AI Models (Gemma · LiteRT-LM · EmbeddingGemma · Gemini Nano) */}
      <section className="space-y-4 pt-2 border-t border-black/10 dark:border-[#D4A44B]/20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C]" />
              <h2 className="font-editorial text-2xl font-bold">
                Google On-Device AI Models (LiteRT-LM &amp; Gemma)
              </h2>
            </div>
            <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-1">
              Import .litertlm, .task, or .tflite models locally. Optional Android Gemini Nano via AICore is supported without any cloud fallback.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={importingAi}
              onClick={() => aiFileInputRef.current?.click()}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-[#6839D3] hover:bg-[#5A2EC0] border border-[#D4A44B]/40 text-[#F5EEDB] text-xs font-semibold flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <HardDriveUpload className="w-4 h-4 text-[#E5B85C]" />
              <span>{importingAi ? 'Importing…' : 'Import .litertlm / .task Model'}</span>
            </button>
            <input
              ref={aiFileInputRef}
              type="file"
              accept=".litertlm,.task,.tflite"
              onChange={handleAiModelFilePicked}
              className="hidden"
            />
          </div>
        </div>

        {/* Runtime Memory & Offline Guarantee Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="paper-card rounded-2xl p-3.5">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">AI Engine</div>
            <div className="font-semibold mt-1">
              {settings.aiEnabled ? 'Enabled (100% Local)' : 'Disabled'}
            </div>
          </div>
          <div className="paper-card rounded-2xl p-3.5">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">Device RAM</div>
            <div className="font-semibold mt-1">
              {aiRuntime.deviceFreeRamMb} MB free / {aiRuntime.deviceTotalRamMb} MB
            </div>
          </div>
          <div className="paper-card rounded-2xl p-3.5">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">LiteRT-LM Runtime</div>
            <div className="font-semibold mt-1">
              {aiRuntime.litertCliAvailable ? 'Native Binary Ready' : 'Integrated Offline Core'}
            </div>
          </div>
          <div className="paper-card rounded-2xl p-3.5">
            <div className="font-mono-meta text-[#5A5248] dark:text-[#B6AC9A]">Cloud API Calls</div>
            <div className="font-semibold mt-1 text-[#6839D3] dark:text-[#E5B85C] flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{aiRuntime.cloudRequestsMade} (Guaranteed Zero)</span>
            </div>
          </div>
        </div>

        {aiNotice && (
          <div className="p-4 rounded-2xl bg-[#D4A44B]/15 border border-[#D4A44B]/45 text-sm font-medium">
            {aiNotice}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {aiModels.map((model) => (
            <div
              key={model.id}
              className={`p-5 rounded-2xl border space-y-3.5 ${
                model.status === 'active'
                  ? 'paper-card border-[#D4A44B] ring-1 ring-[#D4A44B]/40'
                  : 'paper-card'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-editorial text-base font-bold">{model.name}</h3>
                    {model.status === 'active' && (
                      <span className="font-mono-meta text-[11px] text-[#B68224] dark:text-[#E5B85C] font-semibold">
                        Active
                      </span>
                    )}
                    <span
                      className={`font-mono-meta text-[11px] font-semibold ${
                        model.supportsDevice ? 'text-[#6839D3] dark:text-[#BBA9FF]' : 'text-[#E27A48]'
                      }`}
                    >
                      {model.supportsDevice ? 'Compatible' : 'Insufficient RAM'}
                    </span>
                  </div>
                  <p className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-1">
                    {model.fileName} · {model.format.toUpperCase()} · {model.quantisation}
                  </p>
                </div>

                {!model.id.startsWith('gemma-3-') && !model.id.startsWith('embeddinggemma-') && model.id !== 'gemini-nano-aicore' && (
                  <button
                    type="button"
                    aria-label={`Remove AI model ${model.name}`}
                    onClick={async () => {
                      await echoApi.deleteAiModel(model.id);
                      await onRefresh();
                    }}
                    className="p-2 rounded-lg text-[#5A5248] hover:text-[#E27A48] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
                {model.hardwareNote}
              </p>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono-meta text-[#5A5248] dark:text-[#B6AC9A] pt-2 border-t border-black/8 dark:border-[#D4A44B]/15">
                <div>
                  <div className="opacity-70">Size</div>
                  <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                    {model.sizeBytes > 0 ? formatBytes(model.sizeBytes) : 'System AICore'}
                  </div>
                </div>
                <div>
                  <div className="opacity-70">Est. RAM</div>
                  <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                    ~{model.ramRequirementMb} MB
                  </div>
                </div>
                <div>
                  <div className="opacity-70">Context</div>
                  <div className="text-[#14121D] dark:text-[#F5EEDB] font-semibold">
                    {model.contextLength} tok
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={benchmarkingId === model.id}
                  onClick={async () => {
                    setBenchmarkingId(model.id);
                    try {
                      const res = await echoApi.benchmarkAiModel(model.id);
                      setAiNotice(res.message);
                    } finally {
                      setBenchmarkingId(null);
                    }
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Gauge className="w-3.5 h-3.5 text-[#D4A44B]" />
                  <span>{benchmarkingId === model.id ? 'Testing…' : 'Test Performance'}</span>
                </button>

                {model.status !== 'active' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await echoApi.activateAiModel(model.id);
                      await onRefresh();
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Set Active
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Isolated Background AI Analysis Queue */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-editorial text-lg font-bold">Background AI Analysis Queue</h3>
              <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                Runs independently of recording. Cancel or regenerate all insights safely anytime.
              </p>
            </div>
            <button
              type="button"
              disabled={regeneratingAll || !settings.aiEnabled}
              onClick={async () => {
                setRegeneratingAll(true);
                try {
                  const res = await echoApi.regenerateAllAi();
                  await onRefresh();
                  setAiNotice(`Processed local Gemma analysis across ${res.processed} entries.`);
                } catch (err) {
                  setAiNotice(err instanceof Error ? err.message : 'Regeneration skipped.');
                } finally {
                  setRegeneratingAll(false);
                }
              }}
              className="px-3.5 py-2 rounded-xl bg-[#6839D3] disabled:opacity-45 text-[#F5EEDB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${regeneratingAll ? 'animate-spin' : ''}`} />
              <span>{regeneratingAll ? 'Analyzing…' : 'Regenerate All Insights'}</span>
            </button>
          </div>

          {aiJobs.length === 0 ? (
            <div className="paper-card rounded-2xl p-5 text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              No background AI jobs queued yet. Analyze any entry or click “Regenerate All Insights”.
            </div>
          ) : (
            <div className="space-y-2.5">
              {aiJobs.slice(0, 8).map((job) => (
                <div
                  key={job.id}
                  className="paper-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenEntry(job.entryId)}
                      className="font-editorial font-bold text-sm hover:text-[#6839D3] dark:hover:text-[#E5B85C] cursor-pointer text-left"
                    >
                      {job.entryTitle}
                    </button>
                    <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                      {job.taskType} · {job.status} · {job.progress}%
                    </div>
                    {job.errorMessage && (
                      <p className="text-xs text-[#E27A48]">{job.errorMessage}</p>
                    )}
                  </div>
                  {(job.status === 'pending' || job.status === 'processing') && (
                    <button
                      type="button"
                      onClick={async () => {
                        await echoApi.cancelAiJob(job.id);
                        await onRefresh();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[#E27A48]/15 text-[#E27A48] text-xs font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Cross-Platform Google On-Device AI & Speech Architecture */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="font-editorial text-xl font-bold">Cross-Platform On-Device AI Architecture</h2>
          <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
            Clean provider abstraction across Android LiteRT-LM, Optional Android Gemini Nano (AICore), Windows Desktop, and offline SQLite retrieval.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {ON_DEVICE_AI_ARCHITECTURE.map((spec) => (
            <div
              key={spec.platform}
              className="p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/18 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-editorial font-bold text-sm">{spec.platform}</span>
                <span className="font-mono-meta text-[11px] text-[#B68224] dark:text-[#E5B85C]">
                  {spec.modelFormat}
                </span>
              </div>
              <div className="text-xs font-semibold text-[#6839D3] dark:text-[#BBA9FF]">
                {spec.runtime}
              </div>
              <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
                {spec.role} — {spec.notes}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Evaluated Open-Source Offline Speech References */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="font-editorial text-xl font-bold">Offline Engine Evaluation Matrix</h2>
          <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] mt-0.5">
            Comparative engineering decisions informing ECHO&apos;s 100% offline speech architecture.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {REFERENCE_ENGINE_MATRIX.map((row) => (
            <div
              key={row.project}
              className="p-4 rounded-2xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/18 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-editorial font-bold text-sm">{row.project}</span>
                <span className="font-mono-meta text-[11px] text-[#B68224] dark:text-[#E5B85C]">
                  {row.license}
                </span>
              </div>
              <div className="text-xs font-semibold text-[#6839D3] dark:text-[#BBA9FF]">
                {row.roleInEcho}
              </div>
              <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A] leading-relaxed">
                {row.strengths}
              </p>
              <p className="text-[11px] text-[#5A5248]/85 dark:text-[#B6AC9A]/85 leading-relaxed">
                Trade-off: {row.tradeoff}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
