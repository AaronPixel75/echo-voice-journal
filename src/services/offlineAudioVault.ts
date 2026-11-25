import type { IncompleteRecording } from '../types/echo';

const DB_NAME = 'echo_offline_vault';
const DB_VERSION = 1;
const STORE_RECOVERY = 'recovery_chunks';

interface VaultRecord {
  id: string;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  draftTranscript: string;
  titleHint: string;
  audioBuffer: ArrayBuffer;
}

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RECOVERY)) {
        db.createObjectStore(STORE_RECOVERY, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecoveryCheckpoint(record: VaultRecord): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECOVERY, 'readwrite');
      tx.objectStore(STORE_RECOVERY).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-fatal fallback: server chunk checkpointing also persists to ECHO/recordings
  }
}

export async function deleteRecoveryCheckpoint(id: string): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_RECOVERY, 'readwrite');
      tx.objectStore(STORE_RECOVERY).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // ignore
  }
}

export async function listVaultRecoveries(): Promise<
  Array<IncompleteRecording & { audioBuffer: ArrayBuffer }>
> {
  try {
    const db = await openVault();
    const items = await new Promise<VaultRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_RECOVERY, 'readonly');
      const req = tx.objectStore(STORE_RECOVERY).getAll();
      req.onsuccess = () => resolve((req.result as VaultRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.map((item) => ({
      id: item.id,
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      durationMs: item.durationMs,
      chunkCount: 1,
      byteSize: item.audioBuffer?.byteLength || 0,
      draftTranscript: item.draftTranscript,
      titleHint: item.titleHint,
      audioBuffer: item.audioBuffer,
    }));
  } catch {
    return [];
  }
}
