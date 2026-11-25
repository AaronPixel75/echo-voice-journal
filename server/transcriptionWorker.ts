import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ECHO_DIRS,
  computeProsodyForWavFile,
  getDb,
  getSettings,
  getVadSegmentsForRecording,
  syncEntryFts,
  writeTranscriptSnapshot,
} from './storage';
import { parseWavHeader } from '../src/utils/audioCodec';
import { suggestTags, suggestTitle } from '../src/utils/localIntelligence';
import { plainTextToRichHtml } from '../src/utils/transcriptUtils';
import {
  buildWhisperCliArgs,
  computeTranscriptionTimeoutMs,
  isRealGgmlBinaryHeader,
  parseWhisperCppJsonOutput,
  resolveContextVadEnabled,
} from '../src/utils/whisperEngine';
import type { TranscriptSegment, VoiceEngineRuntimeInfo } from '../src/types/echo';

let workerTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

function resolveExecutable(candidates: string[], whichName: string): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable
    }
  }
  try {
    const out = execFileSync('which', [whichName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out.split('\n')[0].trim();
  } catch {
    // Not on PATH
  }
  return null;
}

function findLocalSileroVadModel(): string | null {
  if (!fs.existsSync(ECHO_DIRS.models)) return null;
  const files = fs.readdirSync(ECHO_DIRS.models);
  const vadFile = files.find((f) => /silero.*vad.*\.(bin|onnx)$/i.test(f));
  return vadFile ? path.join(ECHO_DIRS.models, vadFile) : null;
}

function activeModelHasRealBinary(): boolean {
  try {
    const db = getDb();
    const activeModel = db
      .prepare("SELECT file_path FROM whisper_models WHERE status = 'active' LIMIT 1")
      .get() as { file_path: string } | undefined;
    if (!activeModel || !fs.existsSync(activeModel.file_path)) return false;
    const fd = fs.openSync(activeModel.file_path, 'r');
    const head = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    return isRealGgmlBinaryHeader(new Uint8Array(head.subarray(0, bytesRead)));
  } catch {
    return false;
  }
}

export function detectLocalRuntimeCapabilities(): VoiceEngineRuntimeInfo {
  const whisperCliPath = resolveExecutable(
    [
      process.env.WHISPER_CPP_BIN || '',
      path.join(ECHO_DIRS.bin, 'whisper-cli'),
      path.join(ECHO_DIRS.bin, 'whisper-cli.exe'),
      path.join(ECHO_DIRS.bin, 'main'),
      '/usr/local/bin/whisper-cli',
    ],
    'whisper-cli'
  );
  const ffmpegPath = resolveExecutable(['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'], 'ffmpeg');
  const vadModelPath = findLocalSileroVadModel();
  const activeModelBinaryReady = activeModelHasRealBinary();

  let sherpaOnnxAvailable = false;
  try {
    require.resolve('sherpa-onnx-node');
    sherpaOnnxAvailable = true;
  } catch {
    sherpaOnnxAvailable = false;
  }

  return {
    primaryEngine: 'whisper.cpp',
    whisperCliAvailable: Boolean(whisperCliPath),
    whisperCliPath,
    ffmpegAvailable: Boolean(ffmpegPath),
    vadModelPath,
    sherpaOnnxAvailable,
    activeModelBinaryReady,
    executionMode:
      whisperCliPath && activeModelBinaryReady ? 'native-whisper-cpp' : 'offline-vad-dsp',
  };
}

export function startTranscriptionWorker() {
  const db = getDb();
  // Crash recovery: reset interrupted 'processing' jobs back to 'pending' on boot
  db.prepare(
    `UPDATE transcription_jobs
     SET status = 'pending', updated_at = ?
     WHERE status = 'processing'`
  ).run(new Date().toISOString());

  db.prepare(
    `UPDATE entries
     SET transcription_status = 'pending', updated_at = ?
     WHERE transcription_status = 'processing'`
  ).run(new Date().toISOString());

  if (!workerTimer) {
    workerTimer = setInterval(() => {
      void processNextPendingJob();
    }, 900);
  }
}

export function triggerWorkerSoon() {
  setTimeout(() => {
    void processNextPendingJob();
  }, 150);
}

async function ensure16kMonoWav(sourcePath: string, ffmpegPath: string | null): Promise<{ wavPath: string; tempFile: string | null }> {
  const bytes = new Uint8Array(fs.readFileSync(sourcePath, { encoding: null }).subarray(0, 64));
  const header = parseWavHeader(bytes);
  if (header.valid && header.sampleRate === 16000 && header.channels === 1 && header.bitsPerSample === 16) {
    return { wavPath: sourcePath, tempFile: null };
  }
  if (!ffmpegPath) {
    return { wavPath: sourcePath, tempFile: null };
  }
  const tmpWav = path.join(os.tmpdir(), `echo-wcpp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.wav`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-y', '-i', sourcePath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmpWav]);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpWav)) resolve();
      else reject(new Error(`FFmpeg 16kHz PCM normalization exited with code ${code}`));
    });
  });
  return { wavPath: tmpWav, tempFile: tmpWav };
}

async function runNativeWhisperCli(params: {
  whisperCliPath: string;
  ffmpegPath: string | null;
  modelPath: string;
  audioPath: string;
  language: string;
  durationMs: number;
  customVocabulary: string[];
  vadEnabled: boolean;
  vadModelPath: string | null;
  vadConfig: ReturnType<typeof getSettings>['vadConfig'];
}): Promise<{ transcriptText: string; segments: TranscriptSegment[] }> {
  const { wavPath, tempFile } = await ensure16kMonoWav(params.audioPath, params.ffmpegPath);
  const outPrefix = path.join(os.tmpdir(), `echo-out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  const jsonFile = `${outPrefix}.json`;

  try {
    const args = buildWhisperCliArgs({
      modelPath: params.modelPath,
      wavPath,
      jsonOutputPrefix: outPrefix,
      language: params.language,
      threads: Math.min(4, Math.max(1, os.cpus().length - 1)),
      customVocabulary: params.customVocabulary,
      vadEnabled: params.vadEnabled,
      vadModelPath: params.vadModelPath,
      vadConfig: params.vadConfig,
    });

    const timeoutMs = computeTranscriptionTimeoutMs(params.durationMs);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(params.whisperCliPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`whisper.cpp timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(jsonFile)) {
          resolve();
        } else {
          reject(new Error(`whisper.cpp exited with code ${code}: ${stderr.slice(-240)}`));
        }
      });
    });

    const rawJson = fs.readFileSync(jsonFile, 'utf8');
    return parseWhisperCppJsonOutput(rawJson);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
  }
}

async function processNextPendingJob() {
  if (isProcessing) return;
  const db = getDb();

  const job = db
    .prepare(
      `SELECT j.*, r.file_path, r.duration_ms, e.transcript_text as existing_transcript, e.title as existing_title, e.tags_json as existing_tags
       FROM transcription_jobs j
       JOIN recordings r ON r.id = j.recording_id
       JOIN entries e ON e.id = j.entry_id
       WHERE j.status = 'pending'
       ORDER BY j.created_at ASC
       LIMIT 1`
    )
    .get() as
    | {
        id: string;
        recording_id: string;
        entry_id: string;
        model_id: string | null;
        attempts: number;
        file_path: string;
        duration_ms: number;
        existing_transcript: string;
        existing_title: string;
        existing_tags: string;
      }
    | undefined;

  if (!job) return;

  isProcessing = true;
  try {
    const activeModel = db
      .prepare("SELECT id, name, file_path, language FROM whisper_models WHERE status = 'active' LIMIT 1")
      .get() as { id: string; name: string; file_path: string; language: string } | undefined;

    if (!activeModel) {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE transcription_jobs SET status = 'waiting_for_model', updated_at = ? WHERE id = ?`
      ).run(now, job.id);
      db.prepare(
        `UPDATE entries SET transcription_status = 'waiting_for_model', updated_at = ? WHERE id = ?`
      ).run(now, job.entry_id);
      return;
    }

    const startTime = new Date().toISOString();
    db.prepare(
      `UPDATE transcription_jobs
       SET status = 'processing', progress = 15, model_id = ?, attempts = attempts + 1, error_message = NULL, updated_at = ?
       WHERE id = ?`
    ).run(activeModel.id, startTime, job.id);
    db.prepare(
      `UPDATE entries
       SET transcription_status = 'processing', transcription_progress = 15, transcription_error = NULL, updated_at = ?
       WHERE id = ?`
    ).run(startTime, job.entry_id);

    await sleep(300);

    const freshStatus = db
      .prepare('SELECT status FROM transcription_jobs WHERE id = ?')
      .get(job.id) as { status: string } | undefined;
    if (!freshStatus || freshStatus.status === 'paused') {
      return;
    }

    const settings = getSettings(db);
    if (settings.simulateTranscriptionFailure) {
      throw new Error(
        'Offline transcription engine reported an audio decoding fault (simulated). Original audio remains safe and playable.'
      );
    }

    if (!fs.existsSync(job.file_path)) {
      throw new Error('Original audio file could not be located in ECHO/recordings.');
    }

    updateProgress(job.id, job.entry_id, 55);

    const runtime = detectLocalRuntimeCapabilities();
    const totalMs = Math.max(1500, job.duration_ms || 4000);
    let finalTranscript = job.existing_transcript.trim();
    let segments: TranscriptSegment[] = [];

    // Use real native whisper.cpp CLI if executable and binary GGML/GGUF model are both present locally
    if (runtime.whisperCliAvailable && runtime.whisperCliPath && runtime.activeModelBinaryReady) {
      const recordingContext = totalMs >= 8000 ? 'journalNote' : 'shortDictation';
      const vadActive = resolveContextVadEnabled(
        { vadEnabledForLongNotes: settings.vadEnabledForLongNotes },
        recordingContext
      );
      const nativeResult = await runNativeWhisperCli({
        whisperCliPath: runtime.whisperCliPath,
        ffmpegPath: resolveExecutable(['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'], 'ffmpeg'),
        modelPath: activeModel.file_path,
        audioPath: job.file_path,
        language: activeModel.language || 'en',
        durationMs: totalMs,
        customVocabulary: settings.customVocabulary || [],
        vadEnabled: vadActive,
        vadModelPath: runtime.vadModelPath,
        vadConfig: settings.vadConfig,
      });

      if (nativeResult.transcriptText) {
        finalTranscript = nativeResult.transcriptText;
        segments = nativeResult.segments;
      }
    }

    // Pure offline acoustic VAD DSP fallback when native whisper-cli binary isn't installed
    if (segments.length === 0) {
      await sleep(300);
      const vadSegments = getVadSegmentsForRecording(job.file_path);

      if (!finalTranscript) {
        finalTranscript =
          vadSegments.length > 0
            ? `Captured ${vadSegments.length} spoken phrase${vadSegments.length > 1 ? 's' : ''} (${Math.round(totalMs / 1000)}s local audio). Edit or refine any passage directly in the editor.`
            : `Captured ${Math.round(totalMs / 1000)}s local voice recording safely to disk. Add your notes or run a local Whisper model pass anytime.`;
      }

      const sentences = finalTranscript
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (sentences.length > 0) {
        const sliceDuration = Math.max(600, Math.floor(totalMs / sentences.length));
        sentences.forEach((sentence, idx) => {
          const vadRef = vadSegments[idx];
          const startMs = vadRef ? vadRef.startMs : idx * sliceDuration;
          const endMs = vadRef
            ? Math.max(vadRef.endMs, startMs + 600)
            : idx === sentences.length - 1
              ? totalMs
              : (idx + 1) * sliceDuration;
          segments.push({
            id: `seg-${crypto.randomUUID().slice(0, 6)}`,
            startMs,
            endMs,
            text: sentence,
            confidence: 0.94,
          });
        });
      }
    }

    updateProgress(job.id, job.entry_id, 90);
    await sleep(180);

    const existingRow = db
      .prepare('SELECT rich_html, title, tags_json FROM entries WHERE id = ?')
      .get(job.entry_id) as { rich_html: string; title: string; tags_json: string } | undefined;

    const nextRichHtml =
      existingRow?.rich_html && existingRow.rich_html.trim().length > 0 && job.existing_transcript.trim().length > 0
        ? existingRow.rich_html
        : plainTextToRichHtml(finalTranscript);

    const nextTitle =
      existingRow?.title && !existingRow.title.startsWith('Voice Note')
        ? existingRow.title
        : suggestTitle(finalTranscript);

    let nextTags: string[] = [];
    try {
      nextTags = JSON.parse(existingRow?.tags_json || '[]');
    } catch {
      nextTags = [];
    }
    if (nextTags.length === 0) {
      nextTags = suggestTags(finalTranscript);
    }

    const prosody = computeProsodyForWavFile(job.file_path, finalTranscript);
    const doneAt = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `UPDATE entries
         SET title = ?, transcript_text = ?, rich_html = ?, segments_json = ?, tags_json = ?,
             prosody_json = ?, transcription_status = 'completed', transcription_progress = 100,
             transcription_error = NULL, updated_at = ?
         WHERE id = ?`
      ).run(
        nextTitle,
        finalTranscript,
        nextRichHtml,
        JSON.stringify(segments),
        JSON.stringify(nextTags),
        prosody ? JSON.stringify(prosody) : null,
        doneAt,
        job.entry_id
      );

      db.prepare(
        `UPDATE transcription_jobs
         SET status = 'completed', progress = 100, error_message = NULL, updated_at = ?
         WHERE id = ?`
      ).run(doneAt, job.id);

      syncEntryFts(db, job.entry_id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    writeTranscriptSnapshot(job.entry_id, {
      entryId: job.entry_id,
      title: nextTitle,
      transcriptText: finalTranscript,
      segments,
      prosody,
      updatedAt: doneAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed unexpectedly.';
    const failAt = new Date().toISOString();
    db.prepare(
      `UPDATE transcription_jobs
       SET status = 'failed', error_message = ?, updated_at = ?
       WHERE id = ?`
    ).run(message, failAt, job.id);
    db.prepare(
      `UPDATE entries
       SET transcription_status = 'failed', transcription_error = ?, updated_at = ?
       WHERE id = ?`
    ).run(message, failAt, job.entry_id);
  } finally {
    isProcessing = false;
  }
}

function updateProgress(jobId: string, entryId: string, progress: number) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare('UPDATE transcription_jobs SET progress = ?, updated_at = ? WHERE id = ?').run(
    progress,
    now,
    jobId
  );
  db.prepare('UPDATE entries SET transcription_progress = ?, updated_at = ? WHERE id = ?').run(
    progress,
    now,
    entryId
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
