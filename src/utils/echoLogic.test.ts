import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWaveformPeaks,
  decodePcm16FromWav,
  detectSpeechSegments,
  encodeWav,
  parseWavHeader,
} from './audioCodec';
import {
  alignWordsToSegments,
  computeReadingMetrics,
  extractHighlightsFromHtml,
  findActiveWordAtTime,
  formatTimestamp,
} from './transcriptUtils';
import { computeWeeklyDigest, extractKeyIdeas, suggestTags, suggestTitle } from './localIntelligence';
import { formatEntryAsMarkdown, formatEntryAsTxt } from './exportFormatters';
import type { JournalEntry } from '../types/echo';

test('encodeWav and parseWavHeader roundtrip PCM samples accurately', () => {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate); // 1 second
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
  }

  const wavBytes = encodeWav(samples, sampleRate);
  const header = parseWavHeader(wavBytes);

  assert.equal(header.valid, true);
  assert.equal(header.sampleRate, 16000);
  assert.equal(header.channels, 1);
  assert.equal(header.bitsPerSample, 16);
  assert.equal(Math.round(header.durationSec * 10) / 10, 1);

  const decoded = decodePcm16FromWav(wavBytes);
  assert.equal(decoded.samples.length, sampleRate);
  assert.ok(Math.abs(decoded.samples[10] - samples[10]) < 0.001);
});

test('computeWaveformPeaks and detectSpeechSegments identify active voice regions', () => {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 2); // 2 seconds
  // Speech burst from 0.2s to 0.8s, silence, then burst from 1.2s to 1.7s
  for (let i = Math.floor(sampleRate * 0.2); i < Math.floor(sampleRate * 0.8); i++) {
    samples[i] = Math.sin((2 * Math.PI * 180 * i) / sampleRate) * 0.4;
  }
  for (let i = Math.floor(sampleRate * 1.2); i < Math.floor(sampleRate * 1.7); i++) {
    samples[i] = Math.sin((2 * Math.PI * 240 * i) / sampleRate) * 0.35;
  }

  const peaks = computeWaveformPeaks(samples, 20);
  assert.equal(peaks.length, 20);
  assert.ok(peaks[4] > 0.3);

  const segments = detectSpeechSegments(samples, sampleRate, 0.05);
  assert.equal(segments.length, 2);
  assert.ok(segments[0].startMs >= 150 && segments[0].endMs <= 900);
  assert.ok(segments[1].startMs >= 1100 && segments[1].endMs <= 1800);
});

test('alignWordsToSegments interpolates word timings and finds active word index', () => {
  const words = alignWordsToSegments([
    { id: 's1', startMs: 0, endMs: 2000, text: 'This is a beautiful day' },
    { id: 's2', startMs: 2500, endMs: 4500, text: 'to build something meaningful' },
  ]);

  assert.equal(words.length, 9);
  assert.equal(words[0].precision, 'segment-interpolated');
  assert.equal(findActiveWordAtTime(words, 100), 0);
  const lateIdx = findActiveWordAtTime(words, 3800);
  assert.ok(lateIdx >= 5 && lateIdx <= 8);
});

test('formatTimestamp formats mm:ss and hh:mm:ss cleanly', () => {
  assert.equal(formatTimestamp(23000), '00:23');
  assert.equal(formatTimestamp(134000), '02:14');
  assert.equal(formatTimestamp(3665000, true), '01:01:05');
});

test('extractHighlightsFromHtml extracts colored highlights accurately', () => {
  const html =
    '<p>This is a <mark data-highlight="yellow">beautiful</mark> day to build <mark data-highlight="purple">something</mark> meaningful.</p>';
  const highlights = extractHighlightsFromHtml(html);
  assert.deepEqual(highlights, [
    { text: 'beautiful', color: 'yellow' },
    { text: 'something', color: 'purple' },
  ]);
});

test('localIntelligence generates title, tags, key ideas, and weekly digest offline', () => {
  const text =
    'I walked up to the mountain lake this morning. The quiet air gave me a fresh perspective on our creative project. Remember that clarity comes from cutting away distractions.';
  const title = suggestTitle(text);
  assert.ok(title.length > 5);

  const tags = suggestTags(text);
  assert.ok(tags.includes('reflection') || tags.includes('nature'));

  const ideas = extractKeyIdeas(text, 2);
  assert.ok(ideas.length >= 1);

  const digest = computeWeeklyDigest([
    { title, transcriptText: text, durationMs: 92000, createdAt: '2026-11-24T10:00:00Z', tags },
  ]);
  assert.equal(digest.entryCount, 1);
  assert.equal(digest.totalMinutes, 2);
});

test('exportFormatters produce valid TXT and Markdown output', () => {
  const entry: JournalEntry = {
    id: 'e1',
    title: 'A fresh perspective',
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:05:00.000Z',
    notebookId: 'nb-daily',
    category: 'Reflections',
    tags: ['clarity', 'morning'],
    isFavorite: true,
    isPinned: false,
    isArchived: false,
    coverImage: null,
    recordingId: null,
    audioUrl: null,
    durationMs: 134000,
    waveformPeaks: [],
    transcriptText: 'This is a beautiful day to build something meaningful.',
    richHtml: '<p>This is a <mark data-highlight="yellow">beautiful</mark> day.</p>',
    segments: [],
    bookmarks: [{ id: 'b1', timeMs: 32000, label: 'Key moment', createdAt: '2026-11-24T09:01:00.000Z' }],
    attachments: [],
    transcriptionStatus: 'completed',
    transcriptionError: null,
    transcriptionProgress: 100,
    entryType: 'voice',
  };

  const txt = formatEntryAsTxt(entry);
  assert.ok(txt.includes('A fresh perspective'));
  assert.ok(txt.includes('[yellow] beautiful'));

  const md = formatEntryAsMarkdown(entry);
  assert.ok(md.includes('# A fresh perspective'));
  assert.ok(md.includes('`00:32` Key moment'));
});

import {
  buildWhisperCliArgs,
  computeTranscriptionTimeoutMs,
  extractOfflineProsody,
  isRealGgmlBinaryHeader,
  mergeCustomVocabulary,
  parseWhisperCppJsonOutput,
  resolveContextVadEnabled,
  sanitizeWhisperVadConfig,
} from './whisperEngine';

test('whisperEngine clamps VAD settings, enforces hallucination-safe dictation gating, and scales timeouts', () => {
  const clamped = sanitizeWhisperVadConfig({
    threshold: 1.5,
    minSilenceDurationMs: 10,
    speechPadMs: 2500,
  });
  assert.equal(clamped.threshold, 0.95);
  assert.equal(clamped.minSilenceDurationMs, 50);
  assert.equal(clamped.speechPadMs, 1000);

  assert.equal(resolveContextVadEnabled({ vadEnabledForLongNotes: true }, 'shortDictation'), false);
  assert.equal(resolveContextVadEnabled({ vadEnabledForLongNotes: true }, 'journalNote'), true);

  assert.equal(computeTranscriptionTimeoutMs(5000), 300000);
  assert.equal(computeTranscriptionTimeoutMs(120000), 1200000);
});

test('whisperEngine builds CLI args with custom vocabulary prompt and parses whisper.cpp JSON output', () => {
  const vocab = mergeCustomVocabulary(['Kyoto', 'ECHO'], ['echo', 'Fraunces', 'whisper.cpp']);
  assert.deepEqual(vocab, ['echo', 'Fraunces', 'whisper.cpp', 'Kyoto']);

  const args = buildWhisperCliArgs({
    modelPath: '/models/ggml-base.en.bin',
    wavPath: '/recordings/rec-1.wav',
    jsonOutputPrefix: '/tmp/out',
    language: 'en',
    customVocabulary: vocab,
    vadEnabled: true,
    vadModelPath: '/models/silero_vad.bin',
  });

  assert.ok(args.includes('--max-len'));
  assert.ok(!args.includes('--no-timestamps'));
  assert.ok(args.includes('--output-json-full'));
  assert.ok(args.includes('--vad-model'));
  assert.ok(args.some((a) => a.includes('Personal vocabulary: echo, Fraunces')));

  const parsed = parseWhisperCppJsonOutput(
    JSON.stringify({
      transcription: [
        {
          offsets: { from: 120, to: 1840 },
          text: ' [_BEG_] Hello Fraunces journal.',
          tokens: [{ p: 0.96 }, { p: 0.92 }],
        },
        {
          offsets: { from: 1900, to: 3100 },
          text: '[BLANK_AUDIO]',
        },
      ],
    })
  );

  assert.equal(parsed.transcriptText, 'Hello Fraunces journal.');
  assert.equal(parsed.segments.length, 1);
  assert.equal(parsed.segments[0].startMs, 120);
  assert.equal(parsed.segments[0].endMs, 1840);
  assert.equal(parsed.segments[0].confidence, 0.94);

  assert.equal(isRealGgmlBinaryHeader(new Uint8Array([0x47, 0x47, 0x55, 0x46, 1, 0, 0, 0])), true);
  assert.equal(isRealGgmlBinaryHeader(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])), false);
});

test('extractOfflineProsody estimates pitch, energy, and cadence from PCM samples offline', () => {
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate * 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 180 * i) / sampleRate) * 0.25;
  }
  const prosody = extractOfflineProsody(samples, sampleRate, 4);
  assert.ok(prosody);
  assert.equal(prosody.speechDensityPct, 100);
  assert.equal(prosody.wordsPerMinute, 120);
  assert.ok(prosody.estimatedPitchHz && Math.abs(prosody.estimatedPitchHz - 180) <= 10);
});

test('computeReadingMetrics computes accurate word count and estimated reading time', () => {
  assert.deepEqual(computeReadingMetrics('   '), {
    wordCount: 0,
    readingMinutes: 0,
    readingTimeLabel: '0 min read',
  });

  const shortNote = computeReadingMetrics('Quiet morning walk above the reservoir before sunrise.');
  assert.equal(shortNote.wordCount, 8);
  assert.equal(shortNote.readingTimeLabel, '< 1 min read');

  const longNote = computeReadingMetrics(Array.from({ length: 420 }, (_, i) => `word${i}`).join(' '));
  assert.equal(longNote.wordCount, 420);
  assert.equal(longNote.readingMinutes, 3);
  assert.equal(longNote.readingTimeLabel, '3 min read');
});

import { createHash } from 'node:crypto';
import {
  computePasswordStrength,
  resolveStartupDestination,
  tokenizeKineticHeadline,
  validateVaultPassword,
  verifyPasswordHash,
} from './startupAuth';

test('tokenizeKineticHeadline produces staggered character tokens preserving spaces', () => {
  const tokens = tokenizeKineticHeadline('ECHO VAULT', 50, 25);
  assert.equal(tokens.length, 10);
  assert.equal(tokens[0].char, 'E');
  assert.equal(tokens[0].delayMs, 50);
  assert.equal(tokens[4].isSpace, true);
  assert.equal(tokens[9].char, 'T');
  assert.equal(tokens[9].delayMs, 275);
});

test('validateVaultPassword and verifyPasswordHash enforce offline vault security cleanly', async () => {
  assert.equal(validateVaultPassword('', { required: true }).valid, false);
  assert.equal(validateVaultPassword('', { required: false }).valid, true);
  assert.equal(validateVaultPassword('123', { required: true }).valid, false);
  assert.equal(
    validateVaultPassword('EchoVault99', { confirmPassword: 'Different' }).valid,
    false
  );
  assert.equal(computePasswordStrength('EchoVault!99'), 'strong');

  const nodeSha256 = async (val: string) =>
    createHash('sha256').update(val, 'utf8').digest('hex');

  const storedHash = await nodeSha256('MidnightInk2026');
  assert.equal(await verifyPasswordHash('MidnightInk2026', storedHash, nodeSha256), true);
  assert.equal(await verifyPasswordHash('wrong-pass', storedHash, nodeSha256), false);
  assert.equal(await verifyPasswordHash('   ', storedHash, nodeSha256), false);
});

test('resolveStartupDestination holds splash until loaded and enforces persisted vault lock', () => {
  assert.equal(
    resolveStartupDestination({
      loading: true,
      splashDone: true,
      autostartSkip: false,
      sessionUnlocked: false,
      manualLoginRequested: false,
      settings: null,
    }),
    'splash'
  );

  assert.equal(
    resolveStartupDestination({
      loading: false,
      splashDone: false,
      autostartSkip: false,
      sessionUnlocked: false,
      manualLoginRequested: false,
      settings: { hasCompletedOnboarding: true, appLockEnabled: false, appLockPinHash: null },
    }),
    'splash'
  );

  assert.equal(
    resolveStartupDestination({
      loading: false,
      splashDone: true,
      autostartSkip: false,
      sessionUnlocked: false,
      manualLoginRequested: false,
      settings: { hasCompletedOnboarding: true, appLockEnabled: true, appLockPinHash: 'abc' },
    }),
    'welcome-login'
  );

  assert.equal(
    resolveStartupDestination({
      loading: false,
      splashDone: true,
      autostartSkip: false,
      sessionUnlocked: true,
      manualLoginRequested: false,
      settings: { hasCompletedOnboarding: true, appLockEnabled: true, appLockPinHash: 'abc' },
    }),
    'app'
  );

  assert.equal(
    resolveStartupDestination({
      loading: false,
      splashDone: true,
      autostartSkip: false,
      sessionUnlocked: false,
      manualLoginRequested: false,
      settings: { hasCompletedOnboarding: true, appLockEnabled: false, appLockPinHash: null },
    }),
    'app'
  );
});

import {
  askMyMemoriesOffline,
  buildLocalEntryInsights,
  buildPeriodicReflectionOffline,
  computeLocalEmbedding,
  cosineSimilarity,
  evaluateDeviceAiCompatibility,
  proofreadTranscriptOffline,
} from './onDeviceAi';

test('onDeviceAi computes normalized local embeddings and ranks semantic similarity', () => {
  const vecA = computeLocalEmbedding('Building an offline voice journal app with Google Gemma');
  const vecB = computeLocalEmbedding('Developing local LiteRT-LM AI model architecture for our app');
  const vecC = computeLocalEmbedding('Baking sourdough cinnamon bread in the kitchen oven');

  assert.equal(vecA.length, 64);
  const simAB = cosineSimilarity(vecA, vecB);
  const simAC = cosineSimilarity(vecA, vecC);
  assert.ok(simAB > simAC, `Expected semantic similarity (${simAB}) > unrelated (${simAC})`);
});

test('onDeviceAi evaluates RAM compatibility and pauses safely under low-memory simulation', () => {
  const optimal = evaluateDeviceAiCompatibility({
    ramRequirementMb: 512,
    deviceFreeRamMb: 2048,
    deviceTotalRamMb: 4096,
  });
  assert.equal(optimal.compatible, true);
  assert.equal(optimal.tier, 'optimal');

  const simulated = evaluateDeviceAiCompatibility({
    ramRequirementMb: 512,
    deviceFreeRamMb: 4096,
    deviceTotalRamMb: 8192,
    simulateLowMemory: true,
  });
  assert.equal(simulated.compatible, false);
  assert.equal(simulated.tier, 'insufficient-memory');

  const tooBig = evaluateDeviceAiCompatibility({
    ramRequirementMb: 4096,
    deviceFreeRamMb: 1024,
    deviceTotalRamMb: 2048,
  });
  assert.equal(tooBig.compatible, false);
});

test('onDeviceAi builds local insights, proofreads safely, and grounds Ask My Memories citations without inventing facts', () => {
  const proofread = proofreadTranscriptOffline('um, today I focused on, uh, shipping ECHO offline');
  assert.equal(proofread, 'Today I focused on shipping ECHO offline.');

  const entries: JournalEntry[] = [
    {
      id: 'e-ai-1',
      title: 'Mountain Clarity Walk',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notebookId: 'nb-daily',
      category: 'Reflections',
      tags: ['clarity', 'projects'],
      isFavorite: false,
      isPinned: false,
      isArchived: false,
      coverImage: null,
      recordingId: null,
      audioUrl: null,
      durationMs: 75000,
      waveformPeaks: [],
      transcriptText: 'My main project goal is building ECHO with offline Gemma and LiteRT-LM.',
      richHtml: '<p>My main project goal is building ECHO with offline Gemma and LiteRT-LM.</p>',
      segments: [
        {
          id: 'seg-1',
          startMs: 14000,
          endMs: 28000,
          text: 'My main project goal is building ECHO with offline Gemma and LiteRT-LM.',
        },
      ],
      bookmarks: [],
      attachments: [],
      transcriptionStatus: 'completed',
      transcriptionError: null,
      transcriptionProgress: 100,
      entryType: 'voice',
    },
  ];

  const insights = buildLocalEntryInsights(entries[0], { responseLength: 'balanced' });
  assert.ok(insights.summary.length > 10);
  assert.ok(insights.reflectionQuestions.length >= 2);
  assert.equal(insights.topic, 'Projects & Building');

  const grounded = askMyMemoriesOffline({
    question: 'What project goal did I mention?',
    entries,
  });
  assert.equal(grounded.insufficientEvidence, false);
  assert.equal(grounded.citations.length, 1);
  assert.equal(grounded.citations[0].entryId, 'e-ai-1');
  assert.equal(grounded.citations[0].timestampLabel, '00:14');

  const ungrounded = askMyMemoriesOffline({
    question: 'What did I say about scuba diving in Antarctica?',
    entries,
  });
  assert.equal(ungrounded.insufficientEvidence, true);
  assert.equal(ungrounded.citations.length, 0);

  const weekly = buildPeriodicReflectionOffline({ period: 'weekly', entries });
  assert.equal(weekly.entryCount, 1);
  assert.ok(weekly.topTopics.length >= 1);
});

