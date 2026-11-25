/**
 * Pure PCM <-> RIFF WAV audio codec and acoustic energy utilities.
 * Zero DOM or Node FS dependencies so it runs in browser, Node, and unit tests.
 */

export interface WavHeaderInfo {
  valid: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataLength: number;
  durationSec: number;
}

export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const pcm16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(pcm16), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function parseWavHeader(bytes: Uint8Array): WavHeaderInfo {
  if (bytes.byteLength < 44) {
    return { valid: false, sampleRate: 0, channels: 0, bitsPerSample: 0, dataLength: 0, durationSec: 0 };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = readAscii(view, 0, 4);
  const wave = readAscii(view, 8, 4);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    return { valid: false, sampleRate: 0, channels: 0, bitsPerSample: 0, dataLength: 0, durationSec: 0 };
  }
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const byteRate = view.getUint32(28, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataLength = view.getUint32(40, true);
  const durationSec = byteRate > 0 ? dataLength / byteRate : 0;

  return {
    valid: sampleRate > 0 && channels > 0 && bitsPerSample > 0,
    sampleRate,
    channels,
    bitsPerSample,
    dataLength,
    durationSec,
  };
}

export function computeWaveformPeaks(samples: Float32Array, barCount = 48): number[] {
  if (samples.length === 0 || barCount <= 0) {
    return Array.from({ length: Math.max(0, barCount) }, () => 0.12);
  }
  const blockSize = Math.max(1, Math.floor(samples.length / barCount));
  const peaks: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = Math.min(samples.length, start + blockSize);
    let maxAmp = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j]);
      if (abs > maxAmp) maxAmp = abs;
    }
    peaks.push(Number(Math.max(0.08, Math.min(1, maxAmp)).toFixed(3)));
  }
  return peaks;
}

export function detectSpeechSegments(
  samples: Float32Array,
  sampleRate = 16000,
  threshold = 0.025
): Array<{ startMs: number; endMs: number; energy: number }> {
  if (samples.length === 0 || sampleRate <= 0) return [];
  const windowSamples = Math.max(1, Math.floor(sampleRate * 0.1)); // 100ms frames
  const segments: Array<{ startMs: number; endMs: number; energy: number }> = [];
  let inSpeech = false;
  let segStartMs = 0;
  let energySum = 0;
  let frameCount = 0;

  for (let i = 0; i < samples.length; i += windowSamples) {
    const end = Math.min(samples.length, i + windowSamples);
    let sumSq = 0;
    for (let j = i; j < end; j++) {
      sumSq += samples[j] * samples[j];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - i));
    const currentMs = Math.round((i / sampleRate) * 1000);

    if (rms >= threshold) {
      if (!inSpeech) {
        inSpeech = true;
        segStartMs = currentMs;
        energySum = rms;
        frameCount = 1;
      } else {
        energySum += rms;
        frameCount += 1;
      }
    } else if (inSpeech) {
      segments.push({
        startMs: segStartMs,
        endMs: currentMs,
        energy: Number((energySum / frameCount).toFixed(3)),
      });
      inSpeech = false;
    }
  }

  if (inSpeech) {
    const totalMs = Math.round((samples.length / sampleRate) * 1000);
    segments.push({
      startMs: segStartMs,
      endMs: Math.max(segStartMs + 100, totalMs),
      energy: Number((energySum / Math.max(1, frameCount)).toFixed(3)),
    });
  }

  return segments;
}

export function decodePcm16FromWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const info = parseWavHeader(bytes);
  if (!info.valid) {
    return { samples: new Float32Array(0), sampleRate: 16000 };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const availableBytes = Math.min(info.dataLength, bytes.byteLength - 44);
  const sampleCount = Math.floor(availableBytes / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  }
  return { samples, sampleRate: info.sampleRate };
}

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(view.getUint8(offset + i));
  }
  return result;
}
