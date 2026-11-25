import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  Calendar,
  Cpu,
  Home,
  Lock,
  Mic,
  Moon,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { SplashScreen } from './components/SplashScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { HomeDashboard } from './components/HomeDashboard';
import { RecordingStudio } from './components/RecordingStudio';
import { EntryDetailView } from './components/EntryDetailView';
import { JournalTimeline } from './components/JournalTimeline';
import { CalendarView } from './components/CalendarView';
import { SearchView } from './components/SearchView';
import { AskMemoriesView } from './components/AskMemoriesView';
import { ModelsAndQueueView } from './components/ModelsAndQueueView';
import { SettingsView } from './components/SettingsView';
import { EchoCrownMark } from './components/EditorialIllustrations';
import { echoApi } from './services/echoApi';
import { resolveStartupDestination } from './utils/startupAuth';
import type {
  AiAnalysisJob,
  AiModelInfo,
  AiRuntimeInfo,
  EchoSettings,
  IncompleteRecording,
  JournalEntry,
  Notebook,
  StorageStats,
  TranscriptionJob,
  VoiceEngineRuntimeInfo,
  WhisperModelInfo,
} from './types/echo';

type ActiveTab =
  | 'home'
  | 'journal'
  | 'calendar'
  | 'memories'
  | 'search'
  | 'models'
  | 'settings'
  | 'record'
  | 'entry';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [aiJobs, setAiJobs] = useState<AiAnalysisJob[]>([]);
  const [aiRuntime, setAiRuntime] = useState<AiRuntimeInfo>({
    aiEnabled: true,
    activeProvider: 'litert-lm-gemma',
    litertCliAvailable: false,
    litertCliPath: null,
    androidGeminiNanoSupported: false,
    deviceTotalRamMb: 0,
    deviceFreeRamMb: 0,
    embeddingCount: 0,
    cloudRequestsMade: 0,
  });
  const [settings, setSettings] = useState<EchoSettings | null>(null);
  const [incompleteRecordings, setIncompleteRecordings] = useState<IncompleteRecording[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats>({
    totalBytes: 0,
    directories: [],
    entryCount: 0,
    recordingCount: 0,
    orphanFiles: [],
  });
  const [engineRuntime, setEngineRuntime] = useState<VoiceEngineRuntimeInfo>({
    primaryEngine: 'whisper.cpp',
    whisperCliAvailable: false,
    whisperCliPath: null,
    ffmpegAvailable: false,
    vadModelPath: null,
    sherpaOnnxAvailable: false,
    activeModelBinaryReady: false,
    executionMode: 'offline-vad-dsp',
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [journalNotebookRequest, setJournalNotebookRequest] = useState<{
    notebookId: string;
    seq: number;
  } | null>(null);
  const [calendarDayRequest, setCalendarDayRequest] = useState<{
    dayKey: string;
    seq: number;
  } | null>(null);
  const autostartSkip =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('autostart') === '1';

  const [splashDone, setSplashDone] = useState(autostartSkip);
  const [sessionUnlocked, setSessionUnlocked] = useState(autostartSkip);
  const [manualLoginRequested, setManualLoginRequested] = useState(false);

  const refreshBootstrap = useCallback(async () => {
    const data = await echoApi.bootstrap();
    setEntries(data.entries);
    setNotebooks(data.notebooks);
    setJobs(data.jobs);
    setModels(data.models);
    setSettings(data.settings);
    setIncompleteRecordings(data.incompleteRecordings);
    setStorageStats(data.storageStats);
    if (data.engineRuntime) setEngineRuntime(data.engineRuntime);
    if (data.aiModels) setAiModels(data.aiModels);
    if (data.aiJobs) setAiJobs(data.aiJobs);
    if (data.aiRuntime) setAiRuntime(data.aiRuntime);
  }, []);

  useEffect(() => {
    void refreshBootstrap()
      .then(() => {
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [refreshBootstrap]);

  // Sync Tailwind v4 `.dark` and `.reduced-motion` classes on <html>
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    if (settings.reducedMotion) {
      root.classList.add('reduced-motion');
    } else {
      root.classList.remove('reduced-motion');
    }
  }, [settings?.theme, settings?.reducedMotion]);

  // Poll gently while any background transcription job is pending or processing
  useEffect(() => {
    const hasActiveJob = jobs.some((j) => j.status === 'pending' || j.status === 'processing');
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      void refreshBootstrap();
    }, 1200);
    return () => clearInterval(timer);
  }, [jobs, refreshBootstrap]);

  const handleUpdateSettings = async (partial: Partial<EchoSettings>) => {
    const next = await echoApi.updateSettings(partial);
    setSettings(next);
  };

  const handleToggleFavorite = async (entry: JournalEntry) => {
    const updated = await echoApi.updateEntry(entry.id, { isFavorite: !entry.isFavorite });
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleCreateTextNote = async () => {
    const created = await echoApi.createTextEntry({
      title: `Written Reflection · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      richHtml: '<p></p>',
      notebookId: notebooks[0]?.id || 'nb-daily',
    });
    setEntries((prev) => [created, ...prev]);
    setSelectedEntryId(created.id);
    setActiveTab('entry');
  };

  const destination = resolveStartupDestination({
    loading,
    splashDone,
    autostartSkip,
    sessionUnlocked,
    manualLoginRequested,
    settings,
  });

  if (destination === 'splash') {
    return (
      <SplashScreen
        resourcesReady={!loading && Boolean(settings)}
        reducedMotion={Boolean(settings?.reducedMotion)}
        onComplete={() => setSplashDone(true)}
      />
    );
  }

  if (destination === 'welcome-login' && settings) {
    return (
      <WelcomeScreen
        settings={settings}
        onEnterApp={async (updates, unlocked) => {
          if (Object.keys(updates).length > 0) {
            await handleUpdateSettings(updates);
          }
          setManualLoginRequested(false);
          setSessionUnlocked(unlocked);
        }}
      />
    );
  }

  if (!settings) {
    return null;
  }

  const selectedEntry = entries.find((e) => e.id === selectedEntryId) || null;
  const activeNavTab = activeTab === 'entry' ? 'journal' : activeTab;

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'journal', label: 'Journal', icon: BookOpen },
    { id: 'memories', label: 'Ask Memories', icon: BrainCircuit },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'models', label: 'Engine & AI', icon: Cpu },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen parchment-canvas text-[#14121D] dark:text-[#F5EEDB] transition-colors flex flex-col lg:flex-row">
      {/* Desktop Luxury Midnight Ink Left Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:justify-between bg-[#0D0C14] text-[#F5EEDB] border-r border-[#D4A44B]/20 p-5 sticky top-0 h-screen">
        <div className="space-y-7">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="w-full text-left flex items-center gap-2.5 px-2 py-1 cursor-pointer group"
          >
            <EchoCrownMark className="w-7 h-5 shrink-0" />
            <div>
              <div className="font-editorial text-2xl font-bold tracking-wider leading-none text-[#F5EEDB]">
                ECHO
              </div>
              <div className="text-[10px] font-mono-meta text-[#D4A44B] mt-0.5">
                Voice Journal
              </div>
            </div>
          </button>

          <nav aria-label="Primary Navigation" className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeNavTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3 transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-gradient-to-r from-[#6839D3] to-[#522AA8] text-[#F5EEDB] border border-[#D4A44B]/40 shadow-md shadow-[#6839D3]/25'
                      : 'text-[#B6AC9A] hover:text-[#F5EEDB] hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#E5B85C]' : ''}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 pt-4 border-t border-[#D4A44B]/15">
          <button
            type="button"
            onClick={() => setActiveTab('record')}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#D4A44B] to-[#C28D30] hover:from-[#DFB05A] hover:to-[#CE993C] text-[#14121D] text-xs font-bold flex items-center justify-center gap-2 shadow-lg cursor-pointer"
          >
            <Mic className="w-4 h-4" />
            <span>New Recording</span>
          </button>

          <button
            type="button"
            aria-label={settings.theme === 'dark' ? 'Switch to Warm Parchment theme' : 'Switch to Midnight Ink theme'}
            onClick={() =>
              void handleUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
            }
            className="w-full py-2.5 px-3 rounded-xl bg-[#161421] hover:bg-[#221E33] border border-[#D4A44B]/20 text-xs font-medium text-[#DED4BE] flex items-center justify-center gap-2 cursor-pointer"
          >
            {settings.theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-[#E5B85C]" />
                <span>Warm Parchment</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-[#BBA9FF]" />
                <span>Midnight Ink</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setSessionUnlocked(false);
              setManualLoginRequested(true);
            }}
            className="w-full py-2 px-3 rounded-xl bg-transparent hover:bg-white/5 border border-white/10 text-xs font-medium text-[#B6AC9A] hover:text-[#F5EEDB] flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Lock className="w-3.5 h-3.5 text-[#E5B85C]" />
            <span>{settings.appLockEnabled ? 'Lock Vault' : 'Welcome & Login'}</span>
          </button>
        </div>
      </aside>

      {/* Mobile & Tablet Top Bar (compact <= 15% height cap) */}
      <header className="no-print lg:hidden sticky top-0 z-30 bg-[#0D0C14]/95 text-[#F5EEDB] backdrop-blur-md border-b border-[#D4A44B]/25">
        <div className="px-4 h-14 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2 font-editorial text-lg font-bold tracking-wider whitespace-nowrap shrink-0 cursor-pointer"
          >
            <EchoCrownMark className="w-5 h-4" />
            <span>ECHO</span>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              aria-label="Open Ask Memories"
              onClick={() => setActiveTab('memories')}
              className={`min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer ${
                activeTab === 'memories' ? 'text-[#E5B85C]' : ''
              }`}
            >
              <BrainCircuit className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label="Open Search"
              onClick={() => setActiveTab('search')}
              className={`min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer ${
                activeTab === 'search' ? 'text-[#E5B85C]' : ''
              }`}
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              type="button"
              aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() =>
                void handleUpdateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })
              }
              className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer"
            >
              {settings.theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#E5B85C]" />
              ) : (
                <Moon className="w-4 h-4 text-[#BBA9FF]" />
              )}
            </button>

            <button
              type="button"
              aria-label="Open Settings"
              onClick={() => setActiveTab('settings')}
              className={`min-w-[40px] min-h-[40px] rounded-xl hover:bg-white/10 flex items-center justify-center cursor-pointer ${
                activeTab === 'settings' ? 'text-[#E5B85C]' : ''
              }`}
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('record')}
              className="px-3.5 py-2 rounded-xl bg-[#D4A44B] text-[#14121D] text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>Record</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Column */}
      <div className="flex-1 min-w-0">
        {/* Interrupted Recording Crash Recovery Banner */}
        {incompleteRecordings.length > 0 && activeTab !== 'record' && (
          <div className="no-print max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-5">
            <div className="p-4 rounded-2xl bg-[#E27A48]/15 border border-[#E27A48]/45 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-[#E27A48] shrink-0" />
                <div>
                  <div className="text-sm font-bold">
                    Interrupted recording detected ({incompleteRecordings.length})
                  </div>
                  <p className="text-xs text-[#5A5248] dark:text-[#B6AC9A]">
                    ECHO preserved your audio checkpoints before the session ended. Recover or discard safely.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {incompleteRecordings.map((inc) => (
                  <React.Fragment key={inc.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await echoApi.recoverIncomplete(inc.id);
                        await refreshBootstrap();
                        setSelectedEntryId(res.entry.id);
                        setActiveTab('entry');
                      }}
                      className="px-3.5 py-2 rounded-xl bg-[#6839D3] text-[#F5EEDB] text-xs font-semibold cursor-pointer"
                    >
                      Recover Audio
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await echoApi.discardIncomplete(inc.id);
                        await refreshBootstrap();
                      }}
                      className="px-3 py-2 rounded-xl bg-black/10 dark:bg-white/10 text-xs font-medium cursor-pointer"
                    >
                      Discard
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Canvas */}
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-7 pb-24 lg:pb-12">
        {activeTab === 'home' && (
          <HomeDashboard
            entries={entries}
            notebooks={notebooks}
            settings={settings}
            onStartRecording={() => setActiveTab('record')}
            onCreateTextNote={() => void handleCreateTextNote()}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
            onToggleFavorite={(entry) => void handleToggleFavorite(entry)}
            onNavigate={(tab) => setActiveTab(tab)}
          />
        )}

        {activeTab === 'record' && (
          <RecordingStudio
            settings={settings}
            notebooks={notebooks}
            onSaved={async (entry) => {
              await refreshBootstrap();
              setSelectedEntryId(entry.id);
              setActiveTab('entry');
            }}
            onCancel={() => setActiveTab('home')}
          />
        )}

        {activeTab === 'entry' && selectedEntry && (
          <EntryDetailView
            entry={selectedEntry}
            notebooks={notebooks}
            settings={settings}
            onBack={() => setActiveTab('journal')}
            onNavigateToJournal={(notebookId) => {
              setJournalNotebookRequest({ notebookId: notebookId || 'all', seq: Date.now() });
              setActiveTab('journal');
            }}
            onNavigateToCalendarDay={(dayKey) => {
              setCalendarDayRequest({ dayKey, seq: Date.now() });
              setActiveTab('calendar');
            }}
            onUpdated={(updated) => {
              setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
            }}
            onDeleted={(deletedId) => {
              setEntries((prev) => prev.filter((e) => e.id !== deletedId));
              setSelectedEntryId(null);
              setActiveTab('journal');
            }}
            onRefreshBootstrap={refreshBootstrap}
          />
        )}

        {activeTab === 'journal' && (
          <JournalTimeline
            entries={entries}
            notebooks={notebooks}
            initialNotebookRequest={journalNotebookRequest}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
            onToggleFavorite={(entry) => void handleToggleFavorite(entry)}
            onCreateNotebook={async (payload) => {
              await echoApi.createNotebook(payload);
              await refreshBootstrap();
            }}
            onDeleteNotebook={async (id) => {
              await echoApi.deleteNotebook(id);
              await refreshBootstrap();
            }}
            onStartRecording={() => setActiveTab('record')}
            onCreateTextNote={() => void handleCreateTextNote()}
          />
        )}

        {activeTab === 'calendar' && (
          <CalendarView
            entries={entries}
            initialDayRequest={calendarDayRequest}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
            onStartRecording={() => setActiveTab('record')}
          />
        )}

        {activeTab === 'memories' && (
          <AskMemoriesView
            settings={settings}
            aiModels={aiModels}
            aiRuntime={aiRuntime}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
            onNavigateSettings={() => setActiveTab('settings')}
            onNavigateSearch={() => setActiveTab('search')}
          />
        )}

        {activeTab === 'search' && (
          <SearchView
            settings={settings}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
          />
        )}

        {activeTab === 'models' && (
          <ModelsAndQueueView
            models={models}
            jobs={jobs}
            aiModels={aiModels}
            aiJobs={aiJobs}
            aiRuntime={aiRuntime}
            settings={settings}
            engineRuntime={engineRuntime}
            onUpdateSettings={handleUpdateSettings}
            onRefresh={refreshBootstrap}
            onOpenEntry={(id) => {
              setSelectedEntryId(id);
              setActiveTab('entry');
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            storageStats={storageStats}
            onUpdateSettings={handleUpdateSettings}
            onRefreshBootstrap={refreshBootstrap}
            onLockVault={() => {
              setSessionUnlocked(false);
              setManualLoginRequested(true);
            }}
          />
        )}
        </main>
      </div>

      {/* Mobile Bottom Thumb Navigation (<= 15% sticky height cap) */}
      <nav
        aria-label="Mobile Navigation"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#0D0C14]/95 text-[#F5EEDB] backdrop-blur-md border-t border-[#D4A44B]/25 grid grid-cols-5 items-center"
      >
        {(
          [
            { id: 'home', label: 'Home', icon: Home },
            { id: 'journal', label: 'Journal', icon: BookOpen },
            { id: 'record', label: 'Record', icon: Mic },
            { id: 'calendar', label: 'Calendar', icon: Calendar },
            { id: 'models', label: 'Engine', icon: Cpu },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeNavTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium cursor-pointer ${
                tab.id === 'record'
                  ? 'text-[#E5B85C] font-bold'
                  : active
                    ? 'text-[#BBA9FF]'
                    : 'text-[#B6AC9A]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
