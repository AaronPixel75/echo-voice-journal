import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  ECHO_DIRS,
  commitAudioRecordingTransaction,
  getDb,
  getEntryById,
  getSettings,
  getStorageStats,
  listEntries,
  listIncompleteRecordings,
  listJobs,
  listModels,
  listNotebooks,
  sanitizeAndSyncHtml,
  saveSettings,
  syncEntryFts,
  writeTranscriptSnapshot,
} from './server/storage';
import {
  detectLocalRuntimeCapabilities,
  startTranscriptionWorker,
  triggerWorkerSoon,
} from './server/transcriptionWorker';
import {
  benchmarkLocalAiModel,
  getAiRuntimeInfo,
  getAllEntryEmbeddings,
  listAiJobs,
  listAiModels,
  runLocalEntryAiAnalysis,
  upsertEntryEmbedding,
} from './server/aiEngine';
import {
  askMyMemoriesOffline,
  buildPeriodicReflectionOffline,
  computeLocalEmbedding,
  cosineSimilarity,
  describeProviderLabel,
} from './src/utils/onDeviceAi';
import { plainTextToRichHtml } from './src/utils/transcriptUtils';
import type { AiResponseLength, SearchMode, SearchResultItem } from './src/types/echo';

const PORT = 3000;

async function createAppServer() {
  const db = getDb();
  startTranscriptionWorker();

  const app = express();
  app.use(express.json({ limit: '60mb' }));
  app.use('/echo-images', express.static(ECHO_DIRS.images));

  // Bootstrap all local state in one offline call
  app.get('/api/bootstrap', (_req, res) => {
    res.json({
      entries: listEntries(db),
      notebooks: listNotebooks(db),
      jobs: listJobs(db),
      models: listModels(db),
      settings: getSettings(db),
      incompleteRecordings: listIncompleteRecordings(db),
      storageStats: getStorageStats(db),
      engineRuntime: detectLocalRuntimeCapabilities(),
      aiModels: listAiModels(db),
      aiJobs: listAiJobs(db),
      aiRuntime: getAiRuntimeInfo(db),
    });
  });

  // Stream audio with Range support for instant waveform scrubbing
  app.get('/api/audio/:recordingId', (req, res) => {
    const rec = db
      .prepare('SELECT file_path, mime_type, byte_size FROM recordings WHERE id = ?')
      .get(req.params.recordingId) as
      | { file_path: string; mime_type: string; byte_size: number }
      | undefined;

    if (!rec || !fs.existsSync(rec.file_path)) {
      res.status(404).json({ error: 'Audio recording not found on local disk.' });
      return;
    }

    const stat = fs.statSync(rec.file_path);
    const total = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': rec.mime_type || 'audio/wav',
      });
      fs.createReadStream(rec.file_path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': rec.mime_type || 'audio/wav',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(rec.file_path).pipe(res);
    }
  });

  // Crash-recovery continuous chunk checkpointing
  app.post('/api/recordings/chunk', (req, res) => {
    try {
      const { id, audioBase64, durationMs, draftTranscript, titleHint, isInitial } = req.body as {
        id: string;
        audioBase64: string;
        durationMs: number;
        draftTranscript?: string;
        titleHint?: string;
        isInitial?: boolean;
      };
      if (!id || !audioBase64) {
        res.status(400).json({ error: 'Missing recording id or chunk data.' });
        return;
      }

      const tempPath = path.join(ECHO_DIRS.recordings, `incomplete_${id}.wav`);
      const buf = Buffer.from(audioBase64, 'base64');
      fs.writeFileSync(tempPath, buf);

      const now = new Date().toISOString();
      const existing = db
        .prepare('SELECT id, chunk_count FROM incomplete_recordings WHERE id = ?')
        .get(id) as { id: string; chunk_count: number } | undefined;

      if (existing && !isInitial) {
        db.prepare(
          `UPDATE incomplete_recordings
           SET updated_at = ?, duration_ms = ?, chunk_count = chunk_count + 1,
               byte_size = ?, draft_transcript = ?, title_hint = ?
           WHERE id = ?`
        ).run(now, durationMs || 0, buf.byteLength, draftTranscript || '', titleHint || '', id);
      } else {
        db.prepare(
          `INSERT OR REPLACE INTO incomplete_recordings
           (id, started_at, updated_at, duration_ms, chunk_count, byte_size, draft_transcript, title_hint, temp_file_path)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
        ).run(
          id,
          now,
          now,
          durationMs || 0,
          buf.byteLength,
          draftTranscript || '',
          titleHint || 'Interrupted recording',
          tempPath
        );
      }

      res.json({ ok: true, byteSize: buf.byteLength });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Chunk checkpoint failed.' });
    }
  });

  // Recover an interrupted recording into a full journal entry
  app.post('/api/recordings/incomplete/:id/recover', (req, res) => {
    try {
      const inc = db
        .prepare('SELECT * FROM incomplete_recordings WHERE id = ?')
        .get(req.params.id) as
        | {
            id: string;
            duration_ms: number;
            draft_transcript: string;
            title_hint: string;
            temp_file_path: string;
          }
        | undefined;

      if (!inc || !fs.existsSync(inc.temp_file_path)) {
        res.status(404).json({ error: 'Incomplete recording buffer not found on disk.' });
        return;
      }

      const audioBuffer = new Uint8Array(fs.readFileSync(inc.temp_file_path));
      const recordingId = `rec-${crypto.randomUUID().slice(0, 8)}`;
      const entryId = `entry-${crypto.randomUUID().slice(0, 8)}`;

      const result = commitAudioRecordingTransaction(db, {
        recordingId,
        entryId,
        title: inc.title_hint || 'Recovered Voice Recording',
        audioBuffer,
        mimeType: 'audio/wav',
        durationMs: inc.duration_ms || 0,
        draftTranscript: inc.draft_transcript || '',
        notebookId: 'nb-daily',
        category: 'Reflections',
        tags: ['recovered'],
        bookmarks: [],
        coverImage: null,
      });

      fs.unlinkSync(inc.temp_file_path);
      db.prepare('DELETE FROM incomplete_recordings WHERE id = ?').run(inc.id);
      triggerWorkerSoon();

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Recovery failed.' });
    }
  });

  app.delete('/api/recordings/incomplete/:id', (req, res) => {
    const inc = db
      .prepare('SELECT temp_file_path FROM incomplete_recordings WHERE id = ?')
      .get(req.params.id) as { temp_file_path: string } | undefined;
    if (inc && fs.existsSync(inc.temp_file_path)) {
      fs.unlinkSync(inc.temp_file_path);
    }
    db.prepare('DELETE FROM incomplete_recordings WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Recording-first atomic commit: audio saved & verified BEFORE transcription runs
  app.post('/api/recordings/commit', (req, res) => {
    try {
      const {
        incompleteId,
        title,
        audioBase64,
        mimeType,
        durationMs,
        draftTranscript,
        notebookId,
        category,
        tags,
        bookmarks,
        coverImage,
      } = req.body as {
        incompleteId?: string;
        title?: string;
        audioBase64: string;
        mimeType?: string;
        durationMs: number;
        draftTranscript?: string;
        notebookId?: string;
        category?: string;
        tags?: string[];
        bookmarks?: Array<{ id: string; timeMs: number; label: string; createdAt: string }>;
        coverImage?: string | null;
      };

      if (!audioBase64) {
        res.status(400).json({ error: 'Audio payload is required to commit a recording.' });
        return;
      }

      const audioBuffer = new Uint8Array(Buffer.from(audioBase64, 'base64'));
      const recordingId = `rec-${crypto.randomUUID().slice(0, 8)}`;
      const entryId = `entry-${crypto.randomUUID().slice(0, 8)}`;

      const result = commitAudioRecordingTransaction(db, {
        recordingId,
        entryId,
        title: title?.trim() || `Voice Note · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        audioBuffer,
        mimeType: mimeType || 'audio/wav',
        durationMs: durationMs || 0,
        draftTranscript: draftTranscript || '',
        notebookId: notebookId || 'nb-daily',
        category: category || 'Reflections',
        tags: Array.isArray(tags) ? tags : [],
        bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
        coverImage: coverImage ?? null,
      });

      // Remove crash recovery temp file now that final audio is safely committed
      if (incompleteId) {
        const inc = db
          .prepare('SELECT temp_file_path FROM incomplete_recordings WHERE id = ?')
          .get(incompleteId) as { temp_file_path: string } | undefined;
        if (inc && fs.existsSync(inc.temp_file_path)) {
          fs.unlinkSync(inc.temp_file_path);
        }
        db.prepare('DELETE FROM incomplete_recordings WHERE id = ?').run(incompleteId);
      }

      try {
        upsertEntryEmbedding(db, result.entry.id);
      } catch {
        // AI indexing failure must never block or fail a committed recording
      }

      triggerWorkerSoon();
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save recording.' });
    }
  });

  // Create text-only journal entry
  app.post('/api/entries', (req, res) => {
    const { title, richHtml, transcriptText, notebookId, category, tags, coverImage } = req.body as {
      title: string;
      richHtml?: string;
      transcriptText?: string;
      notebookId?: string;
      category?: string;
      tags?: string[];
      coverImage?: string | null;
    };

    const id = `entry-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const { cleanHtml, plainText } = sanitizeAndSyncHtml(
      richHtml || plainTextToRichHtml(transcriptText || '')
    );

    db.prepare(
      `INSERT INTO entries (
        id, title, created_at, updated_at, notebook_id, category, tags_json,
        is_favorite, is_pinned, is_archived, cover_image, recording_id, duration_ms,
        transcript_text, rich_html, segments_json, bookmarks_json, attachments_json,
        transcription_status, transcription_error, transcription_progress, entry_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, NULL, 0, ?, ?, '[]', '[]', '[]', 'none', NULL, 100, 'text')`
    ).run(
      id,
      title?.trim() || 'Untitled Note',
      now,
      now,
      notebookId || 'nb-daily',
      category || 'Reflections',
      JSON.stringify(Array.isArray(tags) ? tags : []),
      coverImage ?? null,
      plainText || transcriptText || '',
      cleanHtml
    );

    syncEntryFts(db, id);
    try {
      upsertEntryEmbedding(db, id);
    } catch {
      // Optional AI vector indexing failure never blocks text entry creation
    }
    res.status(201).json(getEntryById(db, id));
  });

  // Update entry content, rich formatting, highlights, tags, favorite/pin/archive, bookmarks
  app.patch('/api/entries/:id', (req, res) => {
    const existing = getEntryById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Journal entry not found.' });
      return;
    }

    const body = req.body as Partial<{
      title: string;
      richHtml: string;
      transcriptText: string;
      notebookId: string;
      category: string;
      tags: string[];
      isFavorite: boolean;
      isPinned: boolean;
      isArchived: boolean;
      coverImage: string | null;
      bookmarks: typeof existing.bookmarks;
      attachments: typeof existing.attachments;
      segments: typeof existing.segments;
    }>;

    let nextHtml = existing.richHtml;
    let nextPlain = existing.transcriptText;
    if (typeof body.richHtml === 'string') {
      const synced = sanitizeAndSyncHtml(body.richHtml);
      nextHtml = synced.cleanHtml;
      nextPlain = synced.plainText || body.transcriptText || existing.transcriptText;
    } else if (typeof body.transcriptText === 'string') {
      nextPlain = body.transcriptText;
      nextHtml = plainTextToRichHtml(body.transcriptText);
    }

    const updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE entries
       SET title = ?, updated_at = ?, notebook_id = ?, category = ?, tags_json = ?,
           is_favorite = ?, is_pinned = ?, is_archived = ?, cover_image = ?,
           transcript_text = ?, rich_html = ?, segments_json = ?, bookmarks_json = ?, attachments_json = ?
       WHERE id = ?`
    ).run(
      body.title ?? existing.title,
      updatedAt,
      body.notebookId ?? existing.notebookId,
      body.category ?? existing.category,
      JSON.stringify(body.tags ?? existing.tags),
      (body.isFavorite ?? existing.isFavorite) ? 1 : 0,
      (body.isPinned ?? existing.isPinned) ? 1 : 0,
      (body.isArchived ?? existing.isArchived) ? 1 : 0,
      body.coverImage !== undefined ? body.coverImage : existing.coverImage,
      nextPlain,
      nextHtml,
      JSON.stringify(body.segments ?? existing.segments),
      JSON.stringify(body.bookmarks ?? existing.bookmarks),
      JSON.stringify(body.attachments ?? existing.attachments),
      existing.id
    );

    syncEntryFts(db, existing.id);
    try {
      upsertEntryEmbedding(db, existing.id);
    } catch {
      // Optional embedding sync failure never blocks saving user edits
    }
    writeTranscriptSnapshot(existing.id, {
      entryId: existing.id,
      title: body.title ?? existing.title,
      transcriptText: nextPlain,
      segments: body.segments ?? existing.segments,
      updatedAt,
    });

    res.json(getEntryById(db, existing.id));
  });

  // Attach a local image file to an entry (stored in ECHO/images)
  app.post('/api/entries/:id/attach-image', (req, res) => {
    const existing = getEntryById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Entry not found.' });
      return;
    }
    const { dataUrl, caption } = req.body as { dataUrl: string; caption?: string };
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl || '');
    if (!match) {
      res.status(400).json({ error: 'Invalid image payload.' });
      return;
    }
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const fileName = `img-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    fs.writeFileSync(path.join(ECHO_DIRS.images, fileName), Buffer.from(match[2], 'base64'));

    const attachment = {
      id: `att-${crypto.randomUUID().slice(0, 6)}`,
      url: `/echo-images/${fileName}`,
      caption: caption || '',
      createdAt: new Date().toISOString(),
    };
    const nextAttachments = [...existing.attachments, attachment];
    db.prepare('UPDATE entries SET attachments_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(nextAttachments),
      new Date().toISOString(),
      existing.id
    );

    res.json(getEntryById(db, existing.id));
  });

  // Safe deletion (preserves audio unless explicitly requested)
  app.delete('/api/entries/:id', (req, res) => {
    const deleteAudio = req.query.deleteAudio === 'true';
    const existing = getEntryById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Entry not found.' });
      return;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM transcription_jobs WHERE entry_id = ?').run(existing.id);
      db.prepare('DELETE FROM ai_jobs WHERE entry_id = ?').run(existing.id);
      db.prepare('DELETE FROM entry_embeddings WHERE entry_id = ?').run(existing.id);
      db.prepare('DELETE FROM entries WHERE id = ?').run(existing.id);
      db.prepare('DELETE FROM entries_fts WHERE entry_id = ?').run(existing.id);

      if (deleteAudio && existing.recordingId) {
        const rec = db
          .prepare('SELECT file_path FROM recordings WHERE id = ?')
          .get(existing.recordingId) as { file_path: string } | undefined;
        if (rec && fs.existsSync(rec.file_path)) {
          fs.unlinkSync(rec.file_path);
        }
        db.prepare('DELETE FROM recordings WHERE id = ?').run(existing.recordingId);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({ ok: true });
  });

  // Retranscribe an existing voice entry without creating duplicates
  app.post('/api/entries/:id/retranscribe', (req, res) => {
    const existing = getEntryById(db, req.params.id);
    if (!existing || !existing.recordingId) {
      res.status(404).json({ error: 'Voice recording not found for this entry.' });
      return;
    }

    const activeJob = db
      .prepare(
        `SELECT * FROM transcription_jobs
         WHERE recording_id = ? AND status IN ('pending', 'processing', 'paused', 'waiting_for_model')`
      )
      .get(existing.recordingId);

    if (activeJob) {
      res.status(409).json({ error: 'A transcription job is already active for this recording.' });
      return;
    }

    const activeModel = db
      .prepare("SELECT id FROM whisper_models WHERE status = 'active' LIMIT 1")
      .get() as { id: string } | undefined;
    const status = activeModel ? 'pending' : 'waiting_for_model';
    const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO transcription_jobs (id, recording_id, entry_id, status, progress, model_id, attempts, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 0, NULL, ?, ?)`
    ).run(jobId, existing.recordingId, existing.id, status, activeModel?.id ?? null, now, now);

    db.prepare(
      `UPDATE entries SET transcription_status = ?, transcription_progress = 0, transcription_error = NULL, updated_at = ? WHERE id = ?`
    ).run(status, now, existing.id);

    triggerWorkerSoon();
    res.json({ ok: true, jobId, status });
  });

  // Transcription job controls: retry / pause / resume
  app.post('/api/jobs/:id/retry', (req, res) => {
    const job = db.prepare('SELECT * FROM transcription_jobs WHERE id = ?').get(req.params.id) as
      | { id: string; entry_id: string }
      | undefined;
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE transcription_jobs SET status = 'pending', progress = 0, error_message = NULL, updated_at = ? WHERE id = ?`
    ).run(now, job.id);
    db.prepare(
      `UPDATE entries SET transcription_status = 'pending', transcription_progress = 0, transcription_error = NULL, updated_at = ? WHERE id = ?`
    ).run(now, job.entry_id);
    triggerWorkerSoon();
    res.json({ ok: true });
  });

  app.post('/api/jobs/:id/pause', (req, res) => {
    const now = new Date().toISOString();
    const job = db.prepare('SELECT id, entry_id FROM transcription_jobs WHERE id = ?').get(req.params.id) as
      | { id: string; entry_id: string }
      | undefined;
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    db.prepare(`UPDATE transcription_jobs SET status = 'paused', updated_at = ? WHERE id = ?`).run(now, job.id);
    db.prepare(`UPDATE entries SET transcription_status = 'paused', updated_at = ? WHERE id = ?`).run(now, job.entry_id);
    res.json({ ok: true });
  });

  app.post('/api/jobs/:id/resume', (req, res) => {
    const now = new Date().toISOString();
    const job = db.prepare('SELECT id, entry_id FROM transcription_jobs WHERE id = ?').get(req.params.id) as
      | { id: string; entry_id: string }
      | undefined;
    if (!job) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    db.prepare(`UPDATE transcription_jobs SET status = 'pending', updated_at = ? WHERE id = ?`).run(now, job.id);
    db.prepare(`UPDATE entries SET transcription_status = 'pending', updated_at = ? WHERE id = ?`).run(now, job.entry_id);
    triggerWorkerSoon();
    res.json({ ok: true });
  });

  // Hybrid Offline Search: SQLite FTS5 + Local EmbeddingGemma Vector Index
  app.get('/api/search', (req, res) => {
    const rawQuery = String(req.query.q || '').trim();
    const requestedMode = String(req.query.mode || 'hybrid') as SearchMode;
    if (!rawQuery) {
      res.json([]);
      return;
    }

    const settings = getSettings(db);
    const effectiveMode: SearchMode = !settings.aiEnabled ? 'fts' : requestedMode;

    // 1) FTS5 keyword matches
    const ftsMap = new Map<string, { item: SearchResultItem; rankIdx: number }>();
    const tokens = rawQuery
      .replace(/["'*^(){}[\]:]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t}"*`);

    const lowerQ = rawQuery.toLowerCase();

    if (effectiveMode !== 'semantic' && tokens.length > 0) {
      try {
        const ftsQuery = tokens.join(' AND ');
        const rows = db
          .prepare(
            `SELECT e.*, r.waveform_peaks_json,
                    snippet(entries_fts, 2, '<mark>', '</mark>', ' … ', 18) as body_snippet,
                    snippet(entries_fts, 1, '<mark>', '</mark>', ' … ', 10) as title_snippet
             FROM entries_fts
             JOIN entries e ON e.id = entries_fts.entry_id
             LEFT JOIN recordings r ON r.id = e.recording_id
             WHERE entries_fts MATCH ?
             ORDER BY bm25(entries_fts) ASC
             LIMIT 40`
          )
          .all(ftsQuery) as Array<Record<string, unknown>>;

        rows.forEach((r, idx) => {
          const entry = getEntryById(db, String(r.id))!;
          const matchedIn: string[] = [];
          if (entry.title.toLowerCase().includes(lowerQ)) matchedIn.push('Title');
          if (entry.transcriptText.toLowerCase().includes(lowerQ)) matchedIn.push('Transcript');
          if (entry.tags.some((t) => t.toLowerCase().includes(lowerQ))) matchedIn.push('Tags');
          if (entry.richHtml.toLowerCase().includes(lowerQ) && entry.richHtml.includes('data-highlight')) {
            matchedIn.push('Highlights');
          }
          ftsMap.set(entry.id, {
            item: {
              entry,
              snippetHtml: String(r.body_snippet || r.title_snippet || entry.transcriptText.slice(0, 140)),
              matchedIn: matchedIn.length > 0 ? matchedIn : ['FTS5 Keyword'],
            },
            rankIdx: idx,
          });
        });
      } catch {
        // Fallback to semantic/empty below cleanly
      }
    }

    if (effectiveMode === 'fts') {
      res.json(Array.from(ftsMap.values()).map((x) => x.item));
      return;
    }

    // 2) On-device EmbeddingGemma semantic vector similarity
    const queryVec = computeLocalEmbedding(rawQuery);
    const storedEmbeddings = getAllEntryEmbeddings(db);
    const allEntries = listEntries(db).filter((e) => !e.isArchived);

    const combined: Array<{ item: SearchResultItem; score: number }> = [];
    for (const entry of allEntries) {
      const ftsMatch = ftsMap.get(entry.id);
      const entryVec =
        storedEmbeddings.get(entry.id) ||
        computeLocalEmbedding(`${entry.title} ${entry.tags.join(' ')} ${entry.transcriptText}`);
      const semSim = cosineSimilarity(queryVec, entryVec);

      const includeSemantic =
        effectiveMode === 'semantic' ? semSim >= 0.16 : semSim >= 0.22;
      if (!ftsMatch && !includeSemantic) continue;

      const ftsBoost = ftsMatch ? Math.max(0.35, 1.0 - ftsMatch.rankIdx * 0.04) : 0;
      const totalScore = ftsBoost * 0.65 + semSim * 0.85;

      const matchedIn = ftsMatch ? [...ftsMatch.item.matchedIn] : [];
      if (semSim >= 0.2 && !matchedIn.includes('Semantic Meaning')) {
        matchedIn.push('Semantic Meaning');
      }

      combined.push({
        score: totalScore,
        item: {
          entry,
          snippetHtml:
            ftsMatch?.item.snippetHtml ||
            entry.transcriptText.slice(0, 165) ||
            entry.title,
          matchedIn: matchedIn.length > 0 ? matchedIn : ['Semantic Meaning'],
          semanticScore: semSim,
        },
      });
    }

    combined.sort((a, b) => b.score - a.score);
    res.json(combined.slice(0, 30).map((c) => c.item));
  });

  // Google On-Device AI (Gemma / LiteRT-LM / EmbeddingGemma / Gemini Nano) Endpoints
  app.post('/api/ai/models/import', (req, res) => {
    try {
      const { fileName, sizeBytes, base64Head, quantisation } = req.body as {
        fileName: string;
        sizeBytes: number;
        base64Head?: string;
        quantisation?: string;
      };
      if (!fileName) {
        res.status(400).json({ error: 'Local AI model file name is required.' });
        return;
      }

      const lower = fileName.toLowerCase();
      const format = lower.endsWith('.litertlm')
        ? 'litertlm'
        : lower.endsWith('.task')
          ? 'task'
          : 'tflite';
      const family = lower.includes('embed')
        ? 'embedding-gemma'
        : lower.includes('nano')
          ? 'gemini-nano'
          : 'gemma';
      const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetPath = path.join(ECHO_DIRS.models, safeName);
      const buf = base64Head ? Buffer.from(base64Head, 'base64') : Buffer.from('LITERTLM_LOCAL_MODEL');
      fs.writeFileSync(targetPath, buf);

      const checksum = `sha256:${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}`;
      const modelId = `ai-${crypto.randomUUID().slice(0, 8)}`;
      const resolvedSize = sizeBytes || buf.byteLength;
      const ramReq = Math.max(256, Math.round((resolvedSize / (1024 * 1024)) * 1.45));
      const cleanName = safeName.replace(/\.(litertlm|task|tflite)$/i, '').replace(/[-_]/g, ' ');
      const now = new Date().toISOString();

      db.exec('BEGIN IMMEDIATE');
      try {
        if (family !== 'embedding-gemma') {
          db.prepare("UPDATE ai_models SET status = 'installed' WHERE family != 'embedding-gemma'").run();
        } else {
          db.prepare("UPDATE ai_models SET status = 'installed' WHERE family = 'embedding-gemma'").run();
        }
        db.prepare(
          `INSERT INTO ai_models (
            id, name, file_name, file_path, format, family, quantisation,
            size_bytes, ram_requirement_mb, context_length, backend, status,
            supports_device, hardware_note, imported_at, checksum
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 8192, ?, 'active', 1, ?, ?, ?)`
        ).run(
          modelId,
          cleanName,
          safeName,
          targetPath,
          format,
          family,
          quantisation || (lower.includes('q8') ? 'INT8' : '4-bit QAT'),
          resolvedSize,
          ramReq,
          process.platform === 'win32' ? 'windows-litert-lm' : 'cross-platform-litert',
          'Imported locally into ECHO/models (100% offline)',
          now,
          checksum
        );
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      res.status(201).json(listAiModels(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'AI model import failed.' });
    }
  });

  app.post('/api/ai/models/:id/activate', (req, res) => {
    const target = db.prepare('SELECT family FROM ai_models WHERE id = ?').get(req.params.id) as
      | { family: string }
      | undefined;
    if (!target) {
      res.status(404).json({ error: 'AI model not found.' });
      return;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      if (target.family === 'embedding-gemma') {
        db.prepare("UPDATE ai_models SET status = 'installed' WHERE family = 'embedding-gemma'").run();
      } else {
        db.prepare("UPDATE ai_models SET status = 'installed' WHERE family != 'embedding-gemma'").run();
      }
      db.prepare("UPDATE ai_models SET status = 'active' WHERE id = ?").run(req.params.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json(listAiModels(db));
  });

  app.delete('/api/ai/models/:id', (req, res) => {
    const model = db.prepare('SELECT file_path FROM ai_models WHERE id = ?').get(req.params.id) as
      | { file_path: string }
      | undefined;
    if (model && model.file_path && !model.file_path.startsWith('android://') && fs.existsSync(model.file_path)) {
      fs.unlinkSync(model.file_path);
    }
    db.prepare('DELETE FROM ai_models WHERE id = ?').run(req.params.id);
    res.json(listAiModels(db));
  });

  app.post('/api/ai/models/:id/benchmark', async (req, res) => {
    try {
      const result = await benchmarkLocalAiModel(db, req.params.id);
      res.json(result);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Benchmark failed.' });
    }
  });

  app.post('/api/ai/entries/:id/analyze', async (req, res) => {
    try {
      const result = await runLocalEntryAiAnalysis(db, req.params.id, 'full-analysis');
      const updatedEntry = getEntryById(db, req.params.id);
      res.json({ ...result, entry: updatedEntry });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Local AI analysis failed.' });
    }
  });

  app.post('/api/ai/entries/:id/regenerate', async (req, res) => {
    try {
      const result = await runLocalEntryAiAnalysis(db, req.params.id, 'full-analysis');
      const updatedEntry = getEntryById(db, req.params.id);
      res.json({ ...result, entry: updatedEntry });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Regeneration failed.' });
    }
  });

  app.post('/api/ai/regenerate-all', async (_req, res) => {
    const settings = getSettings(db);
    if (!settings.aiEnabled) {
      res.status(400).json({ error: 'Local AI is currently disabled in Settings.' });
      return;
    }
    const entries = listEntries(db).filter((e) => !e.isArchived);
    let processed = 0;
    for (const entry of entries) {
      const r = await runLocalEntryAiAnalysis(db, entry.id, 'full-analysis');
      if (r.job.status === 'paused_low_memory') break;
      processed += 1;
    }
    res.json({ processed, aiJobs: listAiJobs(db) });
  });

  app.post('/api/ai/jobs/:id/cancel', (req, res) => {
    const now = new Date().toISOString();
    db.prepare(`UPDATE ai_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(
      now,
      req.params.id
    );
    res.json({ ok: true, aiJobs: listAiJobs(db) });
  });

  app.post('/api/ai/ask', (req, res) => {
    const settings = getSettings(db);
    if (!settings.aiEnabled) {
      res.status(400).json({
        error: 'Local On-Device AI is disabled. Re-enable it in Settings or use Keyword Search.',
      });
      return;
    }
    const { question, responseLength } = req.body as {
      question: string;
      responseLength?: AiResponseLength;
    };
    const entries = listEntries(db);
    const embeddingsByEntryId = getAllEntryEmbeddings(db);
    const models = listAiModels(db);
    const activeLlm = models.find((m) => m.family !== 'embedding-gemma' && m.status === 'active');
    const providerLabel = describeProviderLabel(settings.aiProviderPreference, activeLlm?.name);

    const result = askMyMemoriesOffline({
      question: question || '',
      entries,
      embeddingsByEntryId,
      responseLength: responseLength || settings.aiResponseLength,
      providerLabel,
    });
    res.json(result);
  });

  app.post('/api/ai/reflections', (req, res) => {
    const settings = getSettings(db);
    if (!settings.aiEnabled) {
      res.status(400).json({ error: 'Local On-Device AI is disabled in Settings.' });
      return;
    }
    const { period } = req.body as { period?: 'daily' | 'weekly' | 'monthly' };
    const entries = listEntries(db);
    const models = listAiModels(db);
    const activeLlm = models.find((m) => m.family !== 'embedding-gemma' && m.status === 'active');
    const providerLabel = describeProviderLabel(settings.aiProviderPreference, activeLlm?.name);

    res.json(
      buildPeriodicReflectionOffline({
        period: period || 'weekly',
        entries,
        providerLabel,
      })
    );
  });

  // Notebooks
  app.post('/api/notebooks', (req, res) => {
    const { name, description, color } = req.body as { name: string; description?: string; color?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Notebook name is required.' });
      return;
    }
    const nb = {
      id: `nb-${crypto.randomUUID().slice(0, 6)}`,
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#8557F6',
      createdAt: new Date().toISOString(),
    };
    db.prepare('INSERT INTO notebooks (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)').run(
      nb.id,
      nb.name,
      nb.description,
      nb.color,
      nb.createdAt
    );
    res.status(201).json(nb);
  });

  app.delete('/api/notebooks/:id', (req, res) => {
    if (req.params.id === 'nb-daily') {
      res.status(400).json({ error: 'Default notebook cannot be deleted.' });
      return;
    }
    db.prepare("UPDATE entries SET notebook_id = 'nb-daily' WHERE notebook_id = ?").run(req.params.id);
    db.prepare('DELETE FROM notebooks WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Local Whisper model import (no internet required)
  app.post('/api/models/import', (req, res) => {
    try {
      const { fileName, sizeBytes, base64Head, language } = req.body as {
        fileName: string;
        sizeBytes: number;
        base64Head?: string;
        language?: string;
      };
      if (!fileName) {
        res.status(400).json({ error: 'Model file name is required.' });
        return;
      }

      const lower = fileName.toLowerCase();
      const format = lower.endsWith('.gguf') ? 'gguf' : 'bin';
      const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const targetPath = path.join(ECHO_DIRS.models, safeName);
      const buf = base64Head ? Buffer.from(base64Head, 'base64') : Buffer.from('GGML_LOCAL_IMPORT');
      fs.writeFileSync(targetPath, buf);

      const checksum = `sha256:${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}`;
      const modelId = `model-${crypto.randomUUID().slice(0, 8)}`;
      const estimatedRamMb = Math.max(120, Math.round(((sizeBytes || buf.byteLength) / (1024 * 1024)) * 1.45));
      const cleanTitle = safeName.replace(/\.(bin|gguf)$/i, '').replace(/[-_]/g, ' ');
      const now = new Date().toISOString();

      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE whisper_models SET status = 'installed'").run();
        db.prepare(
          `INSERT INTO whisper_models (id, name, file_name, file_path, format, size_bytes, ram_requirement_mb, language, status, imported_at, checksum)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        ).run(
          modelId,
          cleanTitle,
          safeName,
          targetPath,
          format,
          sizeBytes || buf.byteLength,
          estimatedRamMb,
          language || 'en',
          now,
          checksum
        );

        // Resume any jobs that were waiting for a model
        db.prepare(
          `UPDATE transcription_jobs SET status = 'pending', model_id = ?, updated_at = ? WHERE status = 'waiting_for_model'`
        ).run(modelId, now);
        db.prepare(
          `UPDATE entries SET transcription_status = 'pending', updated_at = ? WHERE transcription_status = 'waiting_for_model'`
        ).run(now);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }

      triggerWorkerSoon();
      res.status(201).json(listModels(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Model import failed.' });
    }
  });

  app.post('/api/models/:id/activate', (req, res) => {
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE whisper_models SET status = 'installed'").run();
      db.prepare("UPDATE whisper_models SET status = 'active' WHERE id = ?").run(req.params.id);
      db.prepare(
        `UPDATE transcription_jobs SET status = 'pending', model_id = ?, updated_at = ? WHERE status = 'waiting_for_model'`
      ).run(req.params.id, now);
      db.prepare(
        `UPDATE entries SET transcription_status = 'pending', updated_at = ? WHERE transcription_status = 'waiting_for_model'`
      ).run(now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    triggerWorkerSoon();
    res.json(listModels(db));
  });

  app.delete('/api/models/:id', (req, res) => {
    const model = db
      .prepare('SELECT file_path FROM whisper_models WHERE id = ?')
      .get(req.params.id) as { file_path: string } | undefined;
    if (model && fs.existsSync(model.file_path)) {
      fs.unlinkSync(model.file_path);
    }
    db.prepare('DELETE FROM whisper_models WHERE id = ?').run(req.params.id);
    res.json(listModels(db));
  });

  // Settings
  app.patch('/api/settings', (req, res) => {
    const next = saveSettings(db, req.body);
    res.json(next);
  });

  // Storage diagnostics & orphan recovery
  app.get('/api/storage/stats', (_req, res) => {
    res.json(getStorageStats(db));
  });

  app.post('/api/storage/recover-orphans', (_req, res) => {
    const stats = getStorageStats(db);
    let recoveredCount = 0;
    for (const fileName of stats.orphanFiles) {
      const fullPath = path.join(ECHO_DIRS.recordings, fileName);
      if (!fs.existsSync(fullPath)) continue;
      const buf = new Uint8Array(fs.readFileSync(fullPath));
      const recId = `rec-${crypto.randomUUID().slice(0, 8)}`;
      const entryId = `entry-${crypto.randomUUID().slice(0, 8)}`;
      commitAudioRecordingTransaction(db, {
        recordingId: recId,
        entryId,
        title: `Recovered Orphan Audio · ${fileName}`,
        audioBuffer: buf,
        mimeType: fileName.endsWith('.webm') ? 'audio/webm' : 'audio/wav',
        durationMs: 0,
        draftTranscript: '',
        notebookId: 'nb-daily',
        category: 'Reflections',
        tags: ['recovered'],
        bookmarks: [],
        coverImage: null,
      });
      fs.unlinkSync(fullPath);
      recoveredCount++;
    }
    if (recoveredCount > 0) triggerWorkerSoon();
    res.json({ recoveredCount, storageStats: getStorageStats(db) });
  });

  // Full offline JSON backup & restore
  app.get('/api/backup/export', (_req, res) => {
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      entries: listEntries(db),
      notebooks: listNotebooks(db),
      settings: getSettings(db),
    };
    const backupFile = `echo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(path.join(ECHO_DIRS.backups, backupFile), JSON.stringify(payload, null, 2));
    res.json(payload);
  });

  app.post('/api/backup/restore', (req, res) => {
    const payload = req.body as {
      entries?: ReturnType<typeof listEntries>;
      notebooks?: ReturnType<typeof listNotebooks>;
      settings?: ReturnType<typeof getSettings>;
    };
    if (!payload || !Array.isArray(payload.entries)) {
      res.status(400).json({ error: 'Invalid ECHO backup archive.' });
      return;
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      if (Array.isArray(payload.notebooks)) {
        for (const nb of payload.notebooks) {
          db.prepare(
            `INSERT OR REPLACE INTO notebooks (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)`
          ).run(nb.id, nb.name, nb.description, nb.color, nb.createdAt);
        }
      }
      for (const e of payload.entries) {
        db.prepare(
          `INSERT OR REPLACE INTO entries (
            id, title, created_at, updated_at, notebook_id, category, tags_json,
            is_favorite, is_pinned, is_archived, cover_image, recording_id, duration_ms,
            transcript_text, rich_html, segments_json, bookmarks_json, attachments_json,
            transcription_status, transcription_error, transcription_progress, entry_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          e.id,
          e.title,
          e.createdAt,
          e.updatedAt,
          e.notebookId,
          e.category,
          JSON.stringify(e.tags || []),
          e.isFavorite ? 1 : 0,
          e.isPinned ? 1 : 0,
          e.isArchived ? 1 : 0,
          e.coverImage ?? null,
          e.recordingId ?? null,
          e.durationMs || 0,
          e.transcriptText || '',
          e.richHtml || '',
          JSON.stringify(e.segments || []),
          JSON.stringify(e.bookmarks || []),
          JSON.stringify(e.attachments || []),
          e.transcriptionStatus || 'completed',
          e.transcriptionError ?? null,
          e.transcriptionProgress ?? 100,
          e.entryType || 'text'
        );
        syncEntryFts(db, e.id);
      }
      if (payload.settings) {
        saveSettings(db, payload.settings);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: err instanceof Error ? err.message : 'Restore failed.' });
      return;
    }
    res.json({ ok: true, restoredEntries: payload.entries.length });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ECHO offline server running on http://0.0.0.0:${PORT}`);
  });
}

void createAppServer();
