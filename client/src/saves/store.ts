/** Player save slots (spec 19 §5.2). */
import type { SaveFile, SlotId } from "./saveFile";

export interface SaveSummary {
  id: SlotId;
  name: string;
  mapId: string;
  savedAt: string;
  tick: number;
}

export interface SaveStore {
  /** Occupied slots, ascending slot number. */
  list(): Promise<SaveSummary[]>;
  get(id: SlotId): Promise<SaveFile | null>;
  put(id: SlotId, save: SaveFile): Promise<void>;
  rename(id: SlotId, name: string): Promise<void>;
  remove(id: SlotId): Promise<void>;
}

const DB_NAME = "redline";
const DB_VERSION = 1;
const STORE = "saves";

/** One IndexedDB record: the slot id and its save file. */
interface SlotRecord {
  id: SlotId;
  save: SaveFile;
}

const slotNumber = (id: SlotId): number => Number(id.slice("slot-".length));

const summary = (id: SlotId, save: SaveFile): SaveSummary => ({
  id,
  name: save.name,
  mapId: save.match.mapId,
  savedAt: save.savedAt,
  tick: save.tick,
});

const bySlot = (a: SaveSummary, b: SaveSummary): number =>
  slotNumber(a.id) - slotNumber(b.id);

/** Same contract in memory, for unit tests. */
export function createMemorySaveStore(): SaveStore {
  const slots = new Map<SlotId, SaveFile>();
  return {
    list: () =>
      Promise.resolve(
        [...slots].map(([id, save]) => summary(id, save)).sort(bySlot),
      ),
    get: (id) => {
      const save = slots.get(id);
      return Promise.resolve(save === undefined ? null : structuredClone(save));
    },
    put: (id, save) => {
      slots.set(id, structuredClone(save));
      return Promise.resolve();
    },
    rename: (id, name) => {
      const save = slots.get(id);
      if (save !== undefined) save.name = name.trim();
      return Promise.resolve();
    },
    remove: (id) => {
      slots.delete(id);
      return Promise.resolve();
    },
  };
}

/** Resolves an IndexedDB request. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** IndexedDB database "redline" v1, object store "saves" keyed by "id".
 *  Every method rejects with `Error("storage unavailable")` when IndexedDB is
 *  missing or blocked. */
export function createIndexedDbSaveStore(): SaveStore {
  let opening: Promise<IDBDatabase> | null = null;
  const unavailable = () => new Error("storage unavailable");

  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        reject(unavailable());
        return;
      }
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(unavailable());
      request.onblocked = () => reject(unavailable());
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  }

  async function objects(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await open();
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function read(id: SlotId): Promise<SaveFile | null> {
    const record = (await done((await objects("readonly")).get(id))) as
      | SlotRecord
      | undefined;
    return record?.save ?? null;
  }

  return {
    async list() {
      const records = (await done(
        (await objects("readonly")).getAll(),
      )) as SlotRecord[];
      return records
        .map((record) => summary(record.id, record.save))
        .sort(bySlot);
    },
    get: read,
    async put(id, save) {
      await done((await objects("readwrite")).put({ id, save }));
    },
    async rename(id, name) {
      const save = await read(id);
      if (save === null) return;
      await done(
        (await objects("readwrite")).put({
          id,
          save: { ...save, name: name.trim() },
        }),
      );
    },
    async remove(id) {
      await done((await objects("readwrite")).delete(id));
    },
  };
}
