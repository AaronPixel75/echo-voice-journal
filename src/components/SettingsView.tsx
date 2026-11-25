import React, { useRef, useState } from 'react';
import {
  BrainCircuit,
  Download,
  HardDrive,
  Lock,
  Moon,
  ShieldAlert,
  Sun,
  Upload,
  Wrench,
} from 'lucide-react';
import { echoApi } from '../services/echoApi';
import type { AiProviderId, AiResponseLength, EchoSettings, StorageStats } from '../types/echo';

interface SettingsViewProps {
  settings: EchoSettings;
  storageStats: StorageStats;
  onUpdateSettings: (partial: Partial<EchoSettings>) => Promise<void>;
  onRefreshBootstrap: () => Promise<void>;
  onLockVault?: () => void;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function SettingsView({
  settings,
  storageStats,
  onUpdateSettings,
  onRefreshBootstrap,
  onLockVault,
}: SettingsViewProps) {
  const [pinInput, setPinInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const handleExportBackup = async () => {
    const payload = await echoApi.exportBackup();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `echo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('Backup saved locally to ECHO/backups and downloaded.');
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await echoApi.restoreBackup(json);
      await onRefreshBootstrap();
      setStatusMessage(`Restored ${res.restoredEntries} journal entries from backup.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Invalid backup file.');
    }
  };

  const handleEnablePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim().length < 4) {
      setStatusMessage('Password must be at least 4 characters.');
      return;
    }
    const hash = await sha256Hex(pinInput.trim());
    await onUpdateSettings({ appLockEnabled: true, appLockPinHash: hash });
    setPinInput('');
    setStatusMessage('Local Vault Password enabled.');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-14 animate-paper-unfold">
      <div>
        <h1 className="font-editorial text-3xl font-bold">Settings, Privacy &amp; Storage</h1>
        <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A] mt-1">
          Personalise your workspace, inspect local ECHO storage directories, and manage offline backups.
        </p>
      </div>

      {statusMessage && (
        <div className="p-4 rounded-2xl bg-[#6839D3]/12 border border-[#D4A44B]/40 text-sm font-medium">
          {statusMessage}
        </div>
      )}

      {/* Appearance & Accessibility */}
      <section className="paper-card rounded-3xl p-6 space-y-5">
        <h2 className="font-editorial text-xl font-bold">Appearance &amp; Typography</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label htmlFor="settings-name" className="block text-xs font-medium mb-1.5">
              Personal Greeting Name
            </label>
            <input
              id="settings-name"
              type="text"
              value={settings.userName}
              onChange={(e) => void onUpdateSettings({ userName: e.target.value })}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            />
          </div>

          <div>
            <span className="block text-xs font-medium mb-1.5">Theme Mode</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void onUpdateSettings({ theme: 'light' })}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  settings.theme === 'light'
                    ? 'bg-[#D4A44B] border-[#D4A44B] text-[#14121D]'
                    : 'bg-[#F5EEDB] dark:bg-[#0D0C14] border-black/12 dark:border-[#D4A44B]/20'
                }`}
              >
                <Sun className="w-4 h-4" />
                <span>Warm Parchment</span>
              </button>
              <button
                type="button"
                onClick={() => void onUpdateSettings({ theme: 'dark' })}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  settings.theme === 'dark'
                    ? 'bg-[#6839D3] border-[#D4A44B]/50 text-[#F5EEDB]'
                    : 'bg-[#F5EEDB] dark:bg-[#0D0C14] border-black/12 dark:border-[#D4A44B]/20'
                }`}
              >
                <Moon className="w-4 h-4" />
                <span>Midnight Ink</span>
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="settings-font" className="block text-xs font-medium mb-1.5">
              Default Editor Font
            </label>
            <select
              id="settings-font"
              value={settings.editorFont}
              onChange={(e) =>
                void onUpdateSettings({
                  editorFont: e.target.value as EchoSettings['editorFont'],
                })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            >
              <option value="fraunces">Fraunces (Editorial Serif)</option>
              <option value="inter">Inter (Interface Sans)</option>
              <option value="space-grotesk">Space Grotesk (Geometric)</option>
              <option value="jetbrains-mono">JetBrains Mono</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-viz" className="block text-xs font-medium mb-1.5">
              Default Recording Visualisation
            </label>
            <select
              id="settings-viz"
              value={settings.defaultVisualization}
              onChange={(e) =>
                void onUpdateSettings({
                  defaultVisualization: e.target.value as EchoSettings['defaultVisualization'],
                })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            >
              <option value="orb">Orb Mode</option>
              <option value="wave">Wave Mode</option>
              <option value="spectrum">Spectrum Mode</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-quality" className="block text-xs font-medium mb-1.5">
              Audio Capture Quality
            </label>
            <select
              id="settings-quality"
              value={settings.recordingQuality}
              onChange={(e) =>
                void onUpdateSettings({
                  recordingQuality: e.target.value as EchoSettings['recordingQuality'],
                })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            >
              <option value="standard">Standard (16 kHz Mono WAV)</option>
              <option value="high">High (24 kHz Voice Clarity)</option>
              <option value="studio">Studio (44.1 kHz Uncompressed)</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-goal" className="block text-xs font-medium mb-1.5">
              Daily Reflection Goal (minutes)
            </label>
            <input
              id="settings-goal"
              type="number"
              min={1}
              max={180}
              value={settings.dailyGoalMinutes}
              onChange={(e) =>
                void onUpdateSettings({ dailyGoalMinutes: Math.max(1, Number(e.target.value) || 10) })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 pt-3 border-t border-black/8 dark:border-[#D4A44B]/15 cursor-pointer">
          <div>
            <div className="text-sm font-semibold">Reduced Motion Accessibility</div>
            <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Minimise parallax, transitions, and animated effects across ECHO.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.reducedMotion}
            onChange={(e) => void onUpdateSettings({ reducedMotion: e.target.checked })}
            className="w-5 h-5 accent-[#6839D3]"
          />
        </label>
      </section>

      {/* Privacy & App Lock */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-[#D4A44B]" />
          <h2 className="font-editorial text-xl font-bold">Privacy &amp; Local Vault Password</h2>
        </div>

        {settings.appLockEnabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#5A5248] dark:text-[#B6AC9A]">
              Local password protection is active. Your notes require login on startup.
            </p>
            <div className="flex items-center gap-2.5">
              {onLockVault && (
                <button
                  type="button"
                  onClick={onLockVault}
                  className="px-4 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  Lock Vault Now
                </button>
              )}
              <button
                type="button"
                onClick={() => void onUpdateSettings({ appLockEnabled: false, appLockPinHash: null })}
                className="px-4 py-2 rounded-xl bg-[#E27A48]/15 text-[#E27A48] text-xs font-semibold cursor-pointer whitespace-nowrap"
              >
                Disable Password
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleEnablePin} className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              aria-label="New Vault Password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="Enter 4+ character vault password"
              className="flex-1 min-w-[180px] px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Enable Password Lock
            </button>
          </form>
        )}
      </section>

      {/* Storage Usage & Backup */}
      <section className="paper-card rounded-3xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C]" />
            <h2 className="font-editorial text-xl font-bold">Local Storage &amp; Backups</h2>
          </div>
          <span className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
            Total ECHO vault: {formatBytes(storageStats.totalBytes)}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {storageStats.directories.map((dir) => (
            <div
              key={dir.name}
              className="p-3 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/8 dark:border-[#D4A44B]/15"
            >
              <div className="font-mono-meta text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                ECHO/{dir.name}
              </div>
              <div className="font-mono-meta text-sm font-bold mt-1">
                {formatBytes(dir.bytes)}
              </div>
              <div className="text-[11px] opacity-70">{dir.fileCount} files</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => void handleExportBackup()}
            className="px-4 py-2.5 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#E5B85C]" />
            <span>Export Full Backup (.json)</span>
          </button>
          <button
            type="button"
            onClick={() => restoreInputRef.current?.click()}
            className="px-4 py-2.5 rounded-xl bg-[#EFE4C9] dark:bg-[#211E31] text-xs font-semibold flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>Restore Backup</span>
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".json"
            onChange={handleRestoreFile}
            className="hidden"
          />

          {storageStats.orphanFiles.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                const res = await echoApi.recoverOrphans();
                await onRefreshBootstrap();
                setStatusMessage(`Recovered ${res.recoveredCount} orphan audio file(s).`);
              }}
              className="px-4 py-2.5 rounded-xl bg-[#E27A48] text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
            >
              <Wrench className="w-4 h-4" />
              <span>Recover {storageStats.orphanFiles.length} Orphan Audio File(s)</span>
            </button>
          )}
        </div>
      </section>

      {/* Google On-Device AI & Privacy Controls */}
      <section className="paper-card rounded-3xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-[#6839D3] dark:text-[#E5B85C]" />
            <h2 className="font-editorial text-xl font-bold">On-Device AI &amp; Memory Privacy</h2>
          </div>
          <span className="font-mono-meta text-xs text-[#6839D3] dark:text-[#E5B85C]">
            Zero Cloud APIs · Optional Local Engine
          </span>
        </div>

        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-sm font-semibold">Enable Local On-Device AI (Gemma / LiteRT-LM)</div>
            <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Powers entry summaries, topic tags, reflections, semantic search, and Ask My Memories 100% offline. Turn off anytime — recording and FTS5 search stay fully functional.
            </div>
          </div>
          <input
            type="checkbox"
            aria-label="Enable Local On-Device AI"
            checked={settings.aiEnabled}
            onChange={(e) => void onUpdateSettings({ aiEnabled: e.target.checked })}
            className="w-5 h-5 accent-[#6839D3]"
          />
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-black/8 dark:border-[#D4A44B]/15">
          <div>
            <label htmlFor="settings-ai-provider" className="block text-xs font-medium mb-1.5">
              Preferred Local AI Provider
            </label>
            <select
              id="settings-ai-provider"
              value={settings.aiProviderPreference}
              onChange={(e) =>
                void onUpdateSettings({ aiProviderPreference: e.target.value as AiProviderId })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            >
              <option value="litert-lm-gemma">Google Gemma via LiteRT-LM (Primary)</option>
              <option value="android-gemini-nano">Android Gemini Nano (AICore / ML Kit GenAI)</option>
              <option value="offline-compact">Offline Compact Engine (Zero-Model Heuristic)</option>
            </select>
          </div>

          <div>
            <label htmlFor="settings-ai-length" className="block text-xs font-medium mb-1.5">
              Default Answer &amp; Summary Length
            </label>
            <select
              id="settings-ai-length"
              value={settings.aiResponseLength}
              onChange={(e) =>
                void onUpdateSettings({ aiResponseLength: e.target.value as AiResponseLength })
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5EEDB] dark:bg-[#0D0C14] border border-black/12 dark:border-[#D4A44B]/20 text-sm"
            >
              <option value="concise">Concise (1 sentence / top 2 citations)</option>
              <option value="balanced">Balanced (2 sentences / top 3 citations)</option>
              <option value="detailed">Detailed (3+ sentences / up to 5 citations)</option>
            </select>
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 pt-2 border-t border-black/8 dark:border-[#D4A44B]/15 cursor-pointer">
          <div>
            <div className="text-sm font-semibold">Auto-Analyze Saved Entries in Background</div>
            <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Run local embeddings &amp; insights after transcription completes, isolated from audio capture.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.aiBackgroundQueueEnabled}
            onChange={(e) => void onUpdateSettings({ aiBackgroundQueueEnabled: e.target.checked })}
            className="w-5 h-5 accent-[#6839D3]"
          />
        </label>
      </section>

      {/* Recording-First Reliability Diagnostics */}
      <section className="paper-card rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-[#E27A48]" />
          <h2 className="font-editorial text-xl font-bold">Reliability Diagnostics</h2>
        </div>
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-sm font-semibold">Simulate Transcription Engine Failure</div>
            <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Verify that ECHO always commits and plays original audio even when transcription fails, with persistent Retry support.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.simulateTranscriptionFailure}
            onChange={(e) => void onUpdateSettings({ simulateTranscriptionFailure: e.target.checked })}
            className="w-5 h-5 accent-[#E27A48]"
          />
        </label>

        <label className="flex items-center justify-between gap-4 pt-3 border-t border-black/8 dark:border-[#D4A44B]/15 cursor-pointer">
          <div>
            <div className="text-sm font-semibold">Simulate AI Insufficient-Memory Condition</div>
            <div className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
              Verify that local Gemma inference pauses cleanly under memory pressure without interrupting recordings or Whisper transcription.
            </div>
          </div>
          <input
            type="checkbox"
            aria-label="Simulate AI Insufficient-Memory Condition"
            checked={settings.simulateAiLowMemory}
            onChange={(e) => void onUpdateSettings({ simulateAiLowMemory: e.target.checked })}
            className="w-5 h-5 accent-[#E27A48]"
          />
        </label>
      </section>
    </div>
  );
}
