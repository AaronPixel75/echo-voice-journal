import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encodeWav } from '../src/utils/audioCodec';
import {
  ECHO_DIRS,
  commitAudioRecordingTransaction,
  getDb,
  getEntryById,
  listJobs,
  syncEntryFts,
} from './storage';

test('recording-first commit saves audio atomically and prevents duplicate active jobs', () => {
  const db = getDb();
  const samples = new Float32Array(16000);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 200 * i) / 16000) * 0.25;
  }
  const wavBytes = encodeWav(samples, 16000);
  const recordingId = `rec-test-${crypto.randomUUID().slice(0, 6)}`;
  const entryId = `entry-test-${crypto.randomUUID().slice(0, 6)}`;

  const { entry, job } = commitAudioRecordingTransaction(db, {
    recordingId,
    entryId,
    title: 'Reliability Test Entry',
    audioBuffer: wavBytes,
    mimeType: 'audio/wav',
    durationMs: 1000,
    draftTranscript: 'Testing local recording-first persistence.',
    notebookId: 'nb-daily',
    category: 'Reflections',
    tags: ['reliability'],
    bookmarks: [],
    coverImage: null,
  });

  assert.equal(entry.id, entryId);
  assert.ok(fs.existsSync(path.join(ECHO_DIRS.recordings, `${recordingId}.wav`)));
  assert.equal(job.recordingId, recordingId);

  // Attempting to insert a second active job for the same recording must fail via unique index
  assert.throws(() => {
    db.prepare(
      `INSERT INTO transcription_jobs (id, recording_id, entry_id, status, progress, model_id, attempts, error_message, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', 0, NULL, 0, NULL, ?, ?)`
    ).run(
      `job-dup-${Date.now()}`,
      recordingId,
      entryId,
      new Date().toISOString(),
      new Date().toISOString()
    );
  });

  // FTS5 search finds the committed entry
  syncEntryFts(db, entryId);
  const ftsHits = db
    .prepare('SELECT entry_id FROM entries_fts WHERE entries_fts MATCH ?')
    .all('"reliability"*') as Array<{ entry_id: string }>;
  assert.ok(ftsHits.some((h) => h.entry_id === entryId));

  // Cleanup test rows & audio file
  db.prepare('DELETE FROM transcription_jobs WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
  db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM recordings WHERE id = ?').run(recordingId);
  const audioFile = path.join(ECHO_DIRS.recordings, `${recordingId}.wav`);
  if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);

  assert.equal(getEntryById(db, entryId), null);
  assert.equal(listJobs(db).some((j) => j.entryId === entryId), false);
});

import { getSettings, saveSettings } from './storage';
import {
  getAiRuntimeInfo,
  getAllEntryEmbeddings,
  listAiModels,
  runLocalEntryAiAnalysis,
  upsertEntryEmbedding,
} from './aiEngine';

test('on-device AI runtime reports zero cloud calls, persists embeddings, and respects low-memory pause safely', async () => {
  const db = getDb();
  const prevSettings = getSettings(db);
  const runtime = getAiRuntimeInfo(db);
  assert.equal(runtime.cloudRequestsMade, 0);

  const models = listAiModels(db);
  assert.ok(models.some((m) => m.family === 'gemma'));
  assert.ok(models.some((m) => m.family === 'embedding-gemma'));

  // Create a recording entry and verify AI low-memory simulation pauses AI without losing recording or FTS5
  const samples = new Float32Array(16000);
  const wavBytes = encodeWav(samples, 16000);
  const recordingId = `rec-ai-${crypto.randomUUID().slice(0, 6)}`;
  const entryId = `entry-ai-${crypto.randomUUID().slice(0, 6)}`;

  commitAudioRecordingTransaction(db, {
    recordingId,
    entryId,
    title: 'AI Guardrail Test',
    audioBuffer: wavBytes,
    mimeType: 'audio/wav',
    durationMs: 1000,
    draftTranscript: 'Checking offline Google Gemma embedding resilience.',
    notebookId: 'nb-daily',
    category: 'Reflections',
    tags: ['gemma'],
    bookmarks: [],
    coverImage: null,
  });

  upsertEntryEmbedding(db, entryId);
  const embeddings = getAllEntryEmbeddings(db);
  assert.ok(embeddings.has(entryId));

  saveSettings(db, { simulateAiLowMemory: true });
  const lowMemResult = await runLocalEntryAiAnalysis(db, entryId);
  assert.equal(lowMemResult.job.status, 'paused_low_memory');
  assert.ok(getEntryById(db, entryId) !== null);

  saveSettings(db, { simulateAiLowMemory: false });
  const okResult = await runLocalEntryAiAnalysis(db, entryId);
  assert.equal(okResult.job.status, 'completed');
  assert.ok(okResult.insights && okResult.insights.summary.length > 5);

  // Restore original settings & clean up test entry
  saveSettings(db, {
    aiEnabled: prevSettings.aiEnabled,
    simulateAiLowMemory: prevSettings.simulateAiLowMemory,
  });
  db.prepare('DELETE FROM ai_jobs WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM entry_embeddings WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM transcription_jobs WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
  db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(entryId);
  db.prepare('DELETE FROM recordings WHERE id = ?').run(recordingId);
  const audioFile = path.join(ECHO_DIRS.recordings, `${recordingId}.wav`);
  if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
});

