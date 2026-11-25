import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  computeWaveformPeaks,
  decodePcm16FromWav,
  detectSpeechSegments,
  encodeWav,
  parseWavHeader,
} from '../src/utils/audioCodec';
import {
  extractHighlightsFromHtml,
  plainTextToRichHtml,
  sanitizeRichHtml,
  stripHtmlToPlainText,
} from '../src/utils/transcriptUtils';
import {
  DEFAULT_WHISPER_VAD_CONFIG,
  extractOfflineProsody,
  mergeCustomVocabulary,
  sanitizeWhisperVadConfig,
} from '../src/utils/whisperEngine';
import type {
  EchoSettings,
  EntryAiInsights,
  IncompleteRecording,
  JournalEntry,
  Notebook,
  TranscriptSegment,
  TranscriptionJob,
  VoiceProsodyMetrics,
  WhisperModelInfo,
} from '../src/types/echo';
import { buildLocalEntryInsights, computeLocalEmbedding, EMBEDDING_DIMENSIONS } from '../src/utils/onDeviceAi';

export const ECHO_ROOT = path.resolve(process.cwd(), 'ECHO');
export const ECHO_DIRS = {
  database: path.join(ECHO_ROOT, 'database'),
  recordings: path.join(ECHO_ROOT, 'recordings'),
  transcripts: path.join(ECHO_ROOT, 'transcripts'),
  images: path.join(ECHO_ROOT, 'images'),
  thumbnails: path.join(ECHO_ROOT, 'thumbnails'),
  models: path.join(ECHO_ROOT, 'models'),
  bin: path.join(ECHO_ROOT, 'bin'),
  exports: path.join(ECHO_ROOT, 'exports'),
  backups: path.join(ECHO_ROOT, 'backups'),
};

export const DEFAULT_SETTINGS: EchoSettings = {
  userName: 'Maya',
  theme: 'light',
  accentColor: 'violet',
  editorFont: 'fraunces',
  recordingQuality: 'high',
  defaultVisualization: 'orb',
  playbackSpeed: 1.0,
  autoSaveIntervalSec: 3,
  autoBackupEnabled: true,
  reducedMotion: false,
  dailyGoalMinutes: 15,
  simulateTranscriptionFailure: false,
  appLockEnabled: false,
  appLockPinHash: null,
  hasCompletedOnboarding: false,
  preferredEngine: 'whisper.cpp',
  vadEnabledForLongNotes: true,
  vadConfig: { ...DEFAULT_WHISPER_VAD_CONFIG },
  customVocabulary: ['ECHO', 'Fraunces'],
  aiEnabled: true,
  aiProviderPreference: 'litert-lm-gemma',
  aiResponseLength: 'balanced',
  aiBackgroundQueueEnabled: true,
  simulateAiLowMemory: false,
};

let dbInstance: DatabaseSync | null = null;

export function ensureEchoDirectories() {
  for (const dir of Object.values(ECHO_DIRS)) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  ensureEchoDirectories();
  const dbPath = path.join(ECHO_DIRS.database, 'echo.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  seedInitialData(db);
  dbInstance = db;
  return db;
}

function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null };
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#8557F6',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'audio/wav',
        byte_size INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        sample_rate INTEGER NOT NULL DEFAULT 16000,
        waveform_peaks_json TEXT NOT NULL DEFAULT '[]',
        sha256 TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        notebook_id TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Reflections',
        tags_json TEXT NOT NULL DEFAULT '[]',
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        cover_image TEXT,
        recording_id TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        transcript_text TEXT NOT NULL DEFAULT '',
        rich_html TEXT NOT NULL DEFAULT '',
        segments_json TEXT NOT NULL DEFAULT '[]',
        bookmarks_json TEXT NOT NULL DEFAULT '[]',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        transcription_status TEXT NOT NULL DEFAULT 'none',
        transcription_error TEXT,
        transcription_progress INTEGER NOT NULL DEFAULT 0,
        entry_type TEXT NOT NULL DEFAULT 'voice'
      );

      CREATE TABLE IF NOT EXISTS transcription_jobs (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        model_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_job_per_recording
      ON transcription_jobs(recording_id)
      WHERE status IN ('pending', 'processing', 'paused', 'waiting_for_model');

      CREATE TABLE IF NOT EXISTS whisper_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        format TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        ram_requirement_mb INTEGER NOT NULL,
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'installed',
        imported_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incomplete_recordings (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        byte_size INTEGER NOT NULL DEFAULT 0,
        draft_transcript TEXT NOT NULL DEFAULT '',
        title_hint TEXT NOT NULL DEFAULT '',
        temp_file_path TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        entry_id UNINDEXED,
        title,
        transcript_text,
        tags_text,
        highlights_text,
        date_text
      );
    `);

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      1,
      new Date().toISOString()
    );
  }

  if (currentVersion < 2) {
    // Upgrade seeded cover artwork to the permanent anime-inked editorial illustrations
    const coverMap: Array<[string, string]> = [
      ['entry-fresh-perspective', '/src/assets/images/anime_hero_listener_1795560481028.jpg'],
      ['entry-ideas-future', '/src/assets/images/anime_campus_courtyard_1795560482032.jpg'],
      ['entry-reading-notes', '/src/assets/images/anime_study_horizon_1795560483169.jpg'],
      ['entry-crossroads-trail', '/src/assets/images/anime_sakura_pagoda_1795560482281.jpg'],
    ];
    for (const [entryId, coverPath] of coverMap) {
      db.prepare('UPDATE entries SET cover_image = ? WHERE id = ?').run(coverPath, entryId);
    }

    const existingSettings = db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('app_settings') as { value_json: string } | undefined;
    if (existingSettings) {
      const parsed = safeJsonParse<Partial<EchoSettings>>(existingSettings.value_json, {});
      parsed.theme = 'light';
      parsed.editorFont = 'fraunces';
      db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run(
        'app_settings',
        JSON.stringify({ ...DEFAULT_SETTINGS, ...parsed })
      );
    }

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      2,
      new Date().toISOString()
    );
  }

  if (currentVersion < 3) {
    const cols = db.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'prosody_json')) {
      db.exec('ALTER TABLE entries ADD COLUMN prosody_json TEXT;');
    }

    const existingVoiceRows = db
      .prepare(
        `SELECT e.id, e.transcript_text, r.file_path
         FROM entries e
         JOIN recordings r ON r.id = e.recording_id
         WHERE e.prosody_json IS NULL`
      )
      .all() as Array<{ id: string; transcript_text: string; file_path: string }>;

    for (const vr of existingVoiceRows) {
      const prosody = computeProsodyForWavFile(vr.file_path, vr.transcript_text);
      if (prosody) {
        db.prepare('UPDATE entries SET prosody_json = ? WHERE id = ?').run(
          JSON.stringify(prosody),
          vr.id
        );
      }
    }

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      3,
      new Date().toISOString()
    );
  }

  if (currentVersion < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_models (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        format TEXT NOT NULL,
        family TEXT NOT NULL,
        quantisation TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        ram_requirement_mb INTEGER NOT NULL,
        context_length INTEGER NOT NULL DEFAULT 4096,
        backend TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'installed',
        supports_device INTEGER NOT NULL DEFAULT 1,
        hardware_note TEXT NOT NULL DEFAULT '',
        imported_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entry_embeddings (
        entry_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        dimensions INTEGER NOT NULL DEFAULT 64,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_jobs (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        provider TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const cols = db.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'ai_insights_json')) {
      db.exec('ALTER TABLE entries ADD COLUMN ai_insights_json TEXT;');
    }

    const now = new Date().toISOString();
    const seedAiModels = [
      {
        id: 'gemma-3-1b-it-q4',
        name: 'Gemma 3 1B Instruct (Q4)',
        fileName: 'gemma-3-1b-it-q4.litertlm',
        filePath: path.join(ECHO_DIRS.models, 'gemma-3-1b-it-q4.litertlm'),
        format: 'litertlm',
        family: 'gemma',
        quantisation: '4-bit QAT',
        sizeBytes: 740 * 1024 * 1024,
        ramRequirementMb: 1180,
        contextLength: 8192,
        backend: 'cross-platform-litert',
        status: 'active',
        supportsDevice: 1,
        hardwareNote: 'Recommended balanced model for Android (8GB+) & Windows',
        checksum: 'litert:gemma3-1b-q4',
      },
      {
        id: 'embeddinggemma-300m-q8',
        name: 'EmbeddingGemma 300M (Matryoshka)',
        fileName: 'embeddinggemma-300m-q8.litertlm',
        filePath: path.join(ECHO_DIRS.models, 'embeddinggemma-300m-q8.litertlm'),
        format: 'litertlm',
        family: 'embedding-gemma',
        quantisation: 'INT8 Matryoshka',
        sizeBytes: 215 * 1024 * 1024,
        ramRequirementMb: 380,
        contextLength: 2048,
        backend: 'cross-platform-litert',
        status: 'active',
        supportsDevice: 1,
        hardwareNote: 'On-device semantic vector indexer paired with SQLite FTS5',
        checksum: 'litert:emb-gemma-300m',
      },
      {
        id: 'gemma-3-270m-it-q8',
        name: 'Gemma 3 270M Ultra-Compact',
        fileName: 'gemma-3-270m-it-q8.litertlm',
        filePath: path.join(ECHO_DIRS.models, 'gemma-3-270m-it-q8.litertlm'),
        format: 'litertlm',
        family: 'gemma',
        quantisation: '8-bit Dynamic',
        sizeBytes: 290 * 1024 * 1024,
        ramRequirementMb: 460,
        contextLength: 4096,
        backend: 'android-litert-lm',
        status: 'installed',
        supportsDevice: 1,
        hardwareNote: 'Low-memory Android tier optimized for constrained phones',
        checksum: 'litert:gemma3-270m-q8',
      },
      {
        id: 'gemini-nano-aicore',
        name: 'Gemini Nano (Android AICore)',
        fileName: 'aicore-gemini-nano.aicore',
        filePath: 'android://aicore/gemini-nano',
        format: 'aicore',
        family: 'gemini-nano',
        quantisation: 'Device Hardware Managed',
        sizeBytes: 0,
        ramRequirementMb: 900,
        contextLength: 4096,
        backend: 'android-aicore',
        status: 'installed',
        supportsDevice: process.platform === 'android' ? 1 : 0,
        hardwareNote: 'Optional Android-only ML Kit GenAI / AICore provider (non-compulsory)',
        checksum: 'aicore:system',
      },
    ];

    const insertAiModel = db.prepare(
      `INSERT OR IGNORE INTO ai_models (
        id, name, file_name, file_path, format, family, quantisation,
        size_bytes, ram_requirement_mb, context_length, backend, status,
        supports_device, hardware_note, imported_at, checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const m of seedAiModels) {
      insertAiModel.run(
        m.id,
        m.name,
        m.fileName,
        m.filePath,
        m.format,
        m.family,
        m.quantisation,
        m.sizeBytes,
        m.ramRequirementMb,
        m.contextLength,
        m.backend,
        m.status,
        m.supportsDevice,
        m.hardwareNote,
        now,
        m.checksum
      );
    }

    // Backfill embeddings & insights cleanly for any existing entries
    const existingRows = db
      .prepare('SELECT id, title, transcript_text, tags_json, ai_insights_json FROM entries')
      .all() as Array<{
      id: string;
      title: string;
      transcript_text: string;
      tags_json: string;
      ai_insights_json: string | null;
    }>;

    for (const row of existingRows) {
      const tags = safeJsonParse<string[]>(row.tags_json, []);
      const vec = computeLocalEmbedding(`${row.title}\n${tags.join(' ')}\n${row.transcript_text}`, EMBEDDING_DIMENSIONS);
      db.prepare(
        `INSERT OR REPLACE INTO entry_embeddings (entry_id, model_id, vector_json, dimensions, updated_at)
         VALUES (?, 'embeddinggemma-300m-q8', ?, ?, ?)`
      ).run(row.id, JSON.stringify(vec), EMBEDDING_DIMENSIONS, now);

      if (!row.ai_insights_json && row.transcript_text.trim()) {
        const insights = buildLocalEntryInsights(
          { title: row.title, transcriptText: row.transcript_text, tags },
          { modelId: 'gemma-3-1b-it-q4', providerLabel: 'Google Gemma 3 1B (LiteRT-LM Offline)' }
        );
        db.prepare('UPDATE entries SET ai_insights_json = ? WHERE id = ?').run(
          JSON.stringify(insights),
          row.id
        );
      }
    }

    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      4,
      now
    );
  }
}

function generateWarmVocalAudio(durationSec: number, baseFreq = 165): { wavBytes: Uint8Array; peaks: number[] } {
  const sampleRate = 16000;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Create realistic speech-like syllable envelopes separated by natural pauses
    const phraseMod = Math.sin(2 * Math.PI * 0.28 * t);
    const syllableMod = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t + Math.sin(t * 1.4)));
    const envelope = phraseMod > -0.25 ? syllableMod * 0.42 : 0.015;
    const pitch = baseFreq + Math.sin(2 * Math.PI * 0.7 * t) * 28;
    const harmonic =
      0.65 * Math.sin(2 * Math.PI * pitch * t) +
      0.25 * Math.sin(2 * Math.PI * pitch * 2 * t) +
      0.1 * Math.sin(2 * Math.PI * pitch * 3 * t);
    samples[i] = harmonic * envelope;
  }

  return {
    wavBytes: encodeWav(samples, sampleRate),
    peaks: computeWaveformPeaks(samples, 56),
  };
}

function writeAudioFileAtomically(fileName: string, buffer: Uint8Array) {
  const targetPath = path.join(ECHO_DIRS.recordings, fileName);
  const tmpPath = path.join(ECHO_DIRS.recordings, `.tmp_${fileName}_${Date.now()}`);
  fs.writeFileSync(tmpPath, buffer);
  const stat = fs.statSync(tmpPath);
  if (stat.size < 44) {
    fs.unlinkSync(tmpPath);
    throw new Error('Recorded audio buffer failed minimum size verification.');
  }
  fs.renameSync(tmpPath, targetPath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { targetPath, byteSize: stat.size, sha256 };
}

function seedInitialData(db: DatabaseSync) {
  const existingEntries = db.prepare('SELECT COUNT(*) as c FROM entries').get() as { c: number };
  if (existingEntries.c > 0) return;

  const now = new Date();
  const daysAgo = (d: number, hour = 9, min = 15) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    dt.setHours(hour, min, 0, 0);
    return dt.toISOString();
  };

  // Seed notebooks
  const notebooks: Notebook[] = [
    {
      id: 'nb-daily',
      name: 'Morning Clarity',
      description: 'Quiet reflections before the noise of the day begins.',
      color: '#8557F6',
      createdAt: daysAgo(14),
    },
    {
      id: 'nb-ideas',
      name: 'Studio & Craft',
      description: 'Product sketches, design notes, and creative experiments.',
      color: '#FF7849',
      createdAt: daysAgo(12),
    },
    {
      id: 'nb-reading',
      name: 'Field & Reading Notes',
      description: 'Passages from books, walks, and long-form thinking.',
      color: '#91DCC1',
      createdAt: daysAgo(10),
    },
  ];

  const insertNb = db.prepare(
    'INSERT INTO notebooks (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const nb of notebooks) {
    insertNb.run(nb.id, nb.name, nb.description, nb.color, nb.createdAt);
  }

  // Seed settings
  db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run(
    'app_settings',
    JSON.stringify(DEFAULT_SETTINGS)
  );

  // Seed built-in offline acoustic + Whisper model slot
  const builtInModelPath = path.join(ECHO_DIRS.models, 'ggml-base.en-q5_1.bin');
  if (!fs.existsSync(builtInModelPath)) {
    fs.writeFileSync(builtInModelPath, Buffer.from('GGML_OFFLINE_MANIFEST_BASE_EN_Q5_1'));
  }
  db.prepare(
    `INSERT INTO whisper_models (id, name, file_name, file_path, format, size_bytes, ram_requirement_mb, language, status, imported_at, checksum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'model-base-en',
    'Whisper Base English (Local Offline)',
    'ggml-base.en-q5_1.bin',
    builtInModelPath,
    'built-in',
    59700000,
    210,
    'en',
    'active',
    daysAgo(14),
    'sha256:local-base-en-q5'
  );

  // Seed rich editorial entries with real local WAV files
  const seedSpecs = [
    {
      id: 'entry-fresh-perspective',
      title: 'A fresh perspective',
      createdAt: daysAgo(0, 8, 42),
      notebookId: 'nb-daily',
      category: 'Reflections',
      tags: ['clarity', 'morning', 'craft'],
      isFavorite: true,
      isPinned: true,
      coverImage: '/src/assets/images/anime_hero_listener_1795560481028.jpg',
      durationSec: 18,
      baseFreq: 168,
      richHtml:
        '<p>Walking past the reservoir before sunrise always resets my pacing. <mark data-highlight="yellow">This is a beautiful day to build something meaningful</mark>, especially when the first hour belongs to thinking rather than reacting.</p><blockquote>“Clarity rarely arrives in a crowded room; it waits patiently on the ridge where you finally stop checking the clock.”</blockquote><p>I want to keep the studio notebook <mark data-highlight="purple">calm, tactile, and fiercely private</mark>—a place where spoken thoughts feel worth revisiting months later.</p>',
      segments: [
        {
          id: 'seg-1',
          startMs: 0,
          endMs: 5600,
          text: 'Walking past the reservoir before sunrise always resets my pacing.',
        },
        {
          id: 'seg-2',
          startMs: 5600,
          endMs: 11800,
          text: 'This is a beautiful day to build something meaningful, especially when the first hour belongs to thinking rather than reacting.',
        },
        {
          id: 'seg-3',
          startMs: 11800,
          endMs: 18000,
          text: 'I want to keep the studio notebook calm, tactile, and fiercely private—a place where spoken thoughts feel worth revisiting months later.',
        },
      ],
      bookmarks: [
        { id: 'bm-1', timeMs: 5800, label: 'Core intention for today', createdAt: daysAgo(0, 8, 42) },
        { id: 'bm-2', timeMs: 12200, label: 'Notebook design note', createdAt: daysAgo(0, 8, 43) },
      ],
    },
    {
      id: 'entry-ideas-future',
      title: 'Ideas for the future',
      createdAt: daysAgo(1, 19, 15),
      notebookId: 'nb-ideas',
      category: 'Ideas',
      tags: ['architecture', 'voice', 'offline'],
      isFavorite: true,
      isPinned: false,
      coverImage: '/src/assets/images/anime_campus_courtyard_1795560482032.jpg',
      durationSec: 16,
      baseFreq: 185,
      richHtml:
        '<h2>Big idea: Recording-first memory safety</h2><p>Whenever software handles personal voice notes, <mark data-highlight="orange">the original audio must be treated as sacred</mark>. Never wait on transcription before committing audio to disk.</p><ul><li>Write raw PCM chunks continuously so a crash never erases a thought.</li><li>Keep a persistent SQLite queue that survives restarts and retries cleanly.</li><li>Let <mark data-highlight="mint">word-level highlighting</mark> turn fleeting speech into lasting editorial notes.</li></ul>',
      segments: [
        {
          id: 'seg-21',
          startMs: 0,
          endMs: 5400,
          text: 'Whenever software handles personal voice notes, the original audio must be treated as sacred.',
        },
        {
          id: 'seg-22',
          startMs: 5400,
          endMs: 10800,
          text: 'Never wait on transcription before committing audio to disk. Write raw chunks continuously so a crash never erases a thought.',
        },
        {
          id: 'seg-23',
          startMs: 10800,
          endMs: 16000,
          text: 'Let word-level highlighting turn fleeting speech into lasting editorial notes.',
        },
      ],
      bookmarks: [{ id: 'bm-21', timeMs: 5500, label: 'Crash safety principle', createdAt: daysAgo(1, 19, 15) }],
    },
    {
      id: 'entry-reading-notes',
      title: 'Notes on slow reading',
      createdAt: daysAgo(3, 14, 20),
      notebookId: 'nb-reading',
      category: 'Reading',
      tags: ['books', 'typography', 'focus'],
      isFavorite: false,
      isPinned: false,
      coverImage: '/src/assets/images/anime_study_horizon_1795560483169.jpg',
      durationSec: 14,
      baseFreq: 152,
      richHtml:
        '<p>Finished chapter four with a warm cup of coffee beside the window. <mark data-highlight="pink">Physical paper remembers where your attention lingered</mark>—a dog-eared corner, a yellow highlight, a margin note in pencil.</p><p>Digital journals usually flatten everything into uniform rows. Giving quotes real breathing room changes how you remember your own life.</p>',
      segments: [
        {
          id: 'seg-31',
          startMs: 0,
          endMs: 7200,
          text: 'Finished chapter four with a warm cup of coffee beside the window. Physical paper remembers where your attention lingered.',
        },
        {
          id: 'seg-32',
          startMs: 7200,
          endMs: 14000,
          text: 'Digital journals usually flatten everything into uniform rows. Giving quotes real breathing room changes how you remember your own life.',
        },
      ],
      bookmarks: [],
    },
    {
      id: 'entry-crossroads-trail',
      title: 'Evening walk by the pagoda',
      createdAt: daysAgo(6, 17, 50),
      notebookId: 'nb-daily',
      category: 'Nature',
      tags: ['sakura', 'perspective', 'evening'],
      isFavorite: false,
      isPinned: false,
      coverImage: '/src/assets/images/anime_sakura_pagoda_1795560482281.jpg',
      durationSec: 15,
      baseFreq: 174,
      richHtml:
        '<p>Stopped at the wooden signpost above the valley as the light turned amber. <mark data-highlight="mint">Not every fork in the road needs an immediate answer</mark>; sometimes naming the two paths out loud is enough to calm the noise.</p>',
      segments: [
        {
          id: 'seg-41',
          startMs: 0,
          endMs: 7500,
          text: 'Stopped at the wooden signpost above the valley as the light turned amber.',
        },
        {
          id: 'seg-42',
          startMs: 7500,
          endMs: 15000,
          text: 'Not every fork in the road needs an immediate answer; sometimes naming the two paths out loud is enough to calm the noise.',
        },
      ],
      bookmarks: [{ id: 'bm-41', timeMs: 7800, label: 'Sunset pause', createdAt: daysAgo(6, 17, 50) }],
    },
  ];

  const insertRec = db.prepare(
    `INSERT INTO recordings (id, file_name, file_path, mime_type, byte_size, duration_ms, sample_rate, waveform_peaks_json, sha256, verified, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );
  const insertEntry = db.prepare(
    `INSERT INTO entries (
      id, title, created_at, updated_at, notebook_id, category, tags_json,
      is_favorite, is_pinned, is_archived, cover_image, recording_id, duration_ms,
      transcript_text, rich_html, segments_json, bookmarks_json, attachments_json,
      transcription_status, transcription_error, transcription_progress, entry_type, prosody_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, '[]', 'completed', NULL, 100, 'voice', ?)`
  );

  for (const spec of seedSpecs) {
    const recId = `rec-${spec.id}`;
    const fileName = `${recId}.wav`;
    const { wavBytes, peaks } = generateWarmVocalAudio(spec.durationSec, spec.baseFreq);
    const { targetPath, byteSize, sha256 } = writeAudioFileAtomically(fileName, wavBytes);
    const durationMs = spec.durationSec * 1000;
    const plainText = stripHtmlToPlainText(spec.richHtml);
    const prosody = computeProsodyForWavFile(targetPath, plainText);

    insertRec.run(
      recId,
      fileName,
      targetPath,
      'audio/wav',
      byteSize,
      durationMs,
      16000,
      JSON.stringify(peaks),
      sha256,
      spec.createdAt
    );

    insertEntry.run(
      spec.id,
      spec.title,
      spec.createdAt,
      spec.createdAt,
      spec.notebookId,
      spec.category,
      JSON.stringify(spec.tags),
      spec.isFavorite ? 1 : 0,
      spec.isPinned ? 1 : 0,
      spec.coverImage,
      recId,
      durationMs,
      plainText,
      spec.richHtml,
      JSON.stringify(spec.segments),
      JSON.stringify(spec.bookmarks),
      prosody ? JSON.stringify(prosody) : null
    );

    syncEntryFts(db, spec.id);
    const seedVec = computeLocalEmbedding(`${spec.title}\n${spec.tags.join(' ')}\n${plainText}`, EMBEDDING_DIMENSIONS);
    db.prepare(
      `INSERT OR REPLACE INTO entry_embeddings (entry_id, model_id, vector_json, dimensions, updated_at)
       VALUES (?, 'embeddinggemma-300m-q8', ?, ?, ?)`
    ).run(spec.id, JSON.stringify(seedVec), EMBEDDING_DIMENSIONS, spec.createdAt);
    const seedInsights = buildLocalEntryInsights(
      { title: spec.title, transcriptText: plainText, tags: spec.tags },
      { modelId: 'gemma-3-1b-it-q4', providerLabel: 'Google Gemma 3 1B (LiteRT-LM Offline)' }
    );
    db.prepare('UPDATE entries SET ai_insights_json = ? WHERE id = ?').run(
      JSON.stringify(seedInsights),
      spec.id
    );
    writeTranscriptSnapshot(spec.id, {
      entryId: spec.id,
      title: spec.title,
      transcriptText: plainText,
      segments: spec.segments,
      updatedAt: spec.createdAt,
    });
  }
}

export function writeTranscriptSnapshot(entryId: string, data: unknown) {
  const filePath = path.join(ECHO_DIRS.transcripts, `${entryId}.json`);
  const tmpPath = path.join(ECHO_DIRS.transcripts, `.tmp_${entryId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

export function syncEntryFts(db: DatabaseSync, entryId: string) {
  const row = db
    .prepare(
      'SELECT id, title, transcript_text, rich_html, tags_json, created_at, is_archived FROM entries WHERE id = ?'
    )
    .get(entryId) as
    | {
        id: string;
        title: string;
        transcript_text: string;
        rich_html: string;
        tags_json: string;
        created_at: string;
        is_archived: number;
      }
    | undefined;

  db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(entryId);
  if (!row) return;

  const tags = safeJsonParse<string[]>(row.tags_json, []);
  const highlights = extractHighlightsFromHtml(row.rich_html).map((h) => h.text);
  const dateLabel = new Date(row.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  db.prepare(
    `INSERT INTO entries_fts (entry_id, title, transcript_text, tags_text, highlights_text, date_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.title,
    row.transcript_text,
    tags.join(' '),
    highlights.join(' '),
    `${dateLabel} ${row.created_at.slice(0, 10)}`
  );
}

export function mapEntryRow(row: Record<string, unknown>): JournalEntry {
  const recordingId = (row.recording_id as string | null) ?? null;
  return {
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    notebookId: String(row.notebook_id),
    category: String(row.category),
    tags: safeJsonParse<string[]>(String(row.tags_json || '[]'), []),
    isFavorite: Boolean(row.is_favorite),
    isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived),
    coverImage: (row.cover_image as string | null) ?? null,
    recordingId,
    audioUrl: recordingId ? `/api/audio/${recordingId}` : null,
    durationMs: Number(row.duration_ms || 0),
    waveformPeaks: safeJsonParse<number[]>(String(row.waveform_peaks_json || '[]'), []),
    transcriptText: String(row.transcript_text || ''),
    richHtml: String(row.rich_html || ''),
    segments: safeJsonParse<TranscriptSegment[]>(String(row.segments_json || '[]'), []),
    bookmarks: safeJsonParse(String(row.bookmarks_json || '[]'), []),
    attachments: safeJsonParse(String(row.attachments_json || '[]'), []),
    transcriptionStatus: (row.transcription_status as JournalEntry['transcriptionStatus']) || 'none',
    transcriptionError: (row.transcription_error as string | null) ?? null,
    transcriptionProgress: Number(row.transcription_progress || 0),
    entryType: (row.entry_type as 'voice' | 'text') || 'voice',
    prosody: row.prosody_json
      ? safeJsonParse<VoiceProsodyMetrics | null>(String(row.prosody_json), null)
      : null,
    aiInsights: row.ai_insights_json
      ? safeJsonParse<EntryAiInsights | null>(String(row.ai_insights_json), null)
      : null,
  };
}

export function listEntries(db: DatabaseSync): JournalEntry[] {
  const rows = db
    .prepare(
      `SELECT e.*, r.waveform_peaks_json
       FROM entries e
       LEFT JOIN recordings r ON r.id = e.recording_id
       ORDER BY e.is_pinned DESC, e.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapEntryRow);
}

export function getEntryById(db: DatabaseSync, entryId: string): JournalEntry | null {
  const row = db
    .prepare(
      `SELECT e.*, r.waveform_peaks_json
       FROM entries e
       LEFT JOIN recordings r ON r.id = e.recording_id
       WHERE e.id = ?`
    )
    .get(entryId) as Record<string, unknown> | undefined;
  return row ? mapEntryRow(row) : null;
}

export function listNotebooks(db: DatabaseSync): Notebook[] {
  return db
    .prepare('SELECT id, name, description, color, created_at as createdAt FROM notebooks ORDER BY created_at ASC')
    .all() as unknown as Notebook[];
}

export function listJobs(db: DatabaseSync): TranscriptionJob[] {
  const rows = db
    .prepare(
      `SELECT j.*, e.title as entry_title
       FROM transcription_jobs j
       LEFT JOIN entries e ON e.id = j.entry_id
       ORDER BY j.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    recordingId: String(r.recording_id),
    entryId: String(r.entry_id),
    entryTitle: String(r.entry_title || 'Voice Note'),
    status: r.status as TranscriptionJob['status'],
    progress: Number(r.progress || 0),
    modelId: (r.model_id as string | null) ?? null,
    attempts: Number(r.attempts || 0),
    errorMessage: (r.error_message as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export function listModels(db: DatabaseSync): WhisperModelInfo[] {
  const rows = db
    .prepare(
      `SELECT id, name, file_name as fileName, format, size_bytes as sizeBytes,
              ram_requirement_mb as ramRequirementMb, language, status,
              imported_at as importedAt, checksum
       FROM whisper_models ORDER BY imported_at DESC`
    )
    .all() as unknown as WhisperModelInfo[];
  return rows;
}

export function getSettings(db: DatabaseSync): EchoSettings {
  const row = db.prepare('SELECT value_json FROM settings WHERE key = ?').get('app_settings') as
    | { value_json: string }
    | undefined;
  const merged = row
    ? { ...DEFAULT_SETTINGS, ...safeJsonParse<Partial<EchoSettings>>(row.value_json, {}) }
    : { ...DEFAULT_SETTINGS };
  merged.vadConfig = sanitizeWhisperVadConfig(merged.vadConfig);
  merged.customVocabulary = mergeCustomVocabulary([], merged.customVocabulary || []);
  return merged;
}

export function saveSettings(db: DatabaseSync, partial: Partial<EchoSettings>): EchoSettings {
  const current = getSettings(db);
  const next: EchoSettings = {
    ...current,
    ...partial,
    vadConfig: sanitizeWhisperVadConfig(partial.vadConfig ?? current.vadConfig),
    customVocabulary: mergeCustomVocabulary(
      [],
      partial.customVocabulary !== undefined ? partial.customVocabulary : current.customVocabulary
    ),
  };
  db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run(
    'app_settings',
    JSON.stringify(next)
  );
  return next;
}

export function listIncompleteRecordings(db: DatabaseSync): IncompleteRecording[] {
  const rows = db
    .prepare(
      `SELECT id, started_at as startedAt, updated_at as updatedAt, duration_ms as durationMs,
              chunk_count as chunkCount, byte_size as byteSize, draft_transcript as draftTranscript,
              title_hint as titleHint
       FROM incomplete_recordings ORDER BY updated_at DESC`
    )
    .all() as unknown as IncompleteRecording[];
  return rows;
}

export function commitAudioRecordingTransaction(
  db: DatabaseSync,
  params: {
    recordingId: string;
    entryId: string;
    title: string;
    audioBuffer: Uint8Array;
    mimeType: string;
    durationMs: number;
    draftTranscript: string;
    notebookId: string;
    category: string;
    tags: string[];
    bookmarks: JournalEntry['bookmarks'];
    coverImage: string | null;
  }
): { entry: JournalEntry; job: TranscriptionJob } {
  const ext = params.mimeType.includes('webm') ? 'webm' : 'wav';
  const fileName = `${params.recordingId}.${ext}`;
  const { targetPath, byteSize, sha256 } = writeAudioFileAtomically(fileName, params.audioBuffer);

  let sampleRate = 16000;
  let durationMs = params.durationMs;
  let peaks: number[] = [];

  if (ext === 'wav') {
    const header = parseWavHeader(params.audioBuffer);
    if (!header.valid) {
      throw new Error('Committed WAV audio failed header verification.');
    }
    sampleRate = header.sampleRate;
    if (header.durationSec > 0 && durationMs <= 0) {
      durationMs = Math.round(header.durationSec * 1000);
    }
    const decoded = decodePcm16FromWav(params.audioBuffer);
    peaks = computeWaveformPeaks(decoded.samples, 56);
  } else {
    peaks = Array.from({ length: 56 }, (_, i) => Number((0.25 + 0.55 * Math.abs(Math.sin(i * 0.45))).toFixed(2)));
  }

  const nowIso = new Date().toISOString();
  const activeModel = db
    .prepare("SELECT id FROM whisper_models WHERE status = 'active' LIMIT 1")
    .get() as { id: string } | undefined;

  const initialJobStatus = activeModel ? 'pending' : 'waiting_for_model';
  const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
  const cleanTranscript = params.draftTranscript.trim();
  const richHtml = cleanTranscript ? plainTextToRichHtml(cleanTranscript) : '';
  const initialSegments: TranscriptSegment[] = cleanTranscript
    ? [
        {
          id: `seg-${crypto.randomUUID().slice(0, 6)}`,
          startMs: 0,
          endMs: Math.max(1000, durationMs),
          text: cleanTranscript,
        },
      ]
    : [];

  const prosody =
    ext === 'wav' ? computeProsodyForWavFile(targetPath, cleanTranscript) : null;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO recordings (id, file_name, file_path, mime_type, byte_size, duration_ms, sample_rate, waveform_peaks_json, sha256, verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      params.recordingId,
      fileName,
      targetPath,
      params.mimeType,
      byteSize,
      durationMs,
      sampleRate,
      JSON.stringify(peaks),
      sha256,
      nowIso
    );

    db.prepare(
      `INSERT INTO entries (
        id, title, created_at, updated_at, notebook_id, category, tags_json,
        is_favorite, is_pinned, is_archived, cover_image, recording_id, duration_ms,
        transcript_text, rich_html, segments_json, bookmarks_json, attachments_json,
        transcription_status, transcription_error, transcription_progress, entry_type, prosody_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, '[]', ?, NULL, 0, 'voice', ?)`
    ).run(
      params.entryId,
      params.title,
      nowIso,
      nowIso,
      params.notebookId,
      params.category,
      JSON.stringify(params.tags),
      params.coverImage,
      params.recordingId,
      durationMs,
      cleanTranscript,
      richHtml,
      JSON.stringify(initialSegments),
      JSON.stringify(params.bookmarks),
      initialJobStatus,
      prosody ? JSON.stringify(prosody) : null
    );

    db.prepare(
      `INSERT INTO transcription_jobs (id, recording_id, entry_id, status, progress, model_id, attempts, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 0, NULL, ?, ?)`
    ).run(
      jobId,
      params.recordingId,
      params.entryId,
      initialJobStatus,
      activeModel?.id ?? null,
      nowIso,
      nowIso
    );

    syncEntryFts(db, params.entryId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const entry = getEntryById(db, params.entryId)!;
  const job = listJobs(db).find((j) => j.id === jobId)!;
  return { entry, job };
}

export function getStorageStats(db: DatabaseSync) {
  const dirEntries = Object.entries(ECHO_DIRS).map(([name, dirPath]) => {
    let bytes = 0;
    let fileCount = 0;
    if (fs.existsSync(dirPath)) {
      for (const file of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, file);
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          bytes += stat.size;
          fileCount += 1;
        }
      }
    }
    return { name, bytes, fileCount };
  });

  const totalBytes = dirEntries.reduce((s, d) => s + d.bytes, 0);
  const entryCount = (db.prepare('SELECT COUNT(*) as c FROM entries').get() as { c: number }).c;
  const recordingCount = (db.prepare('SELECT COUNT(*) as c FROM recordings').get() as { c: number }).c;

  // Orphan audio file detection
  const knownFiles = new Set(
    (db.prepare('SELECT file_name FROM recordings').all() as Array<{ file_name: string }>).map(
      (r) => r.file_name
    )
  );
  const orphanFiles: string[] = [];
  if (fs.existsSync(ECHO_DIRS.recordings)) {
    for (const file of fs.readdirSync(ECHO_DIRS.recordings)) {
      if (!file.startsWith('incomplete_') && !file.startsWith('.tmp_') && !knownFiles.has(file)) {
        orphanFiles.push(file);
      }
    }
  }

  return { totalBytes, directories: dirEntries, entryCount, recordingCount, orphanFiles };
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeAndSyncHtml(html: string) {
  const cleanHtml = sanitizeRichHtml(html);
  const plainText = stripHtmlToPlainText(cleanHtml);
  return { cleanHtml, plainText };
}

export function computeProsodyForWavFile(
  filePath: string,
  transcriptText = ''
): VoiceProsodyMetrics | null {
  if (!fs.existsSync(filePath)) return null;
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const header = parseWavHeader(bytes);
  if (!header.valid) return null;
  const { samples, sampleRate } = decodePcm16FromWav(bytes);
  const words = transcriptText.trim() ? transcriptText.trim().split(/\s+/).length : 0;
  return extractOfflineProsody(samples, sampleRate, words);
}

export function getVadSegmentsForRecording(filePath: string): Array<{ startMs: number; endMs: number; energy: number }> {
  if (!fs.existsSync(filePath)) return [];
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const { samples, sampleRate } = decodePcm16FromWav(bytes);
  if (samples.length === 0) return [];
  return detectSpeechSegments(samples, sampleRate, 0.02);
}
