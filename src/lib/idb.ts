// Minimal IndexedDB key-value store. Holds what this standalone app keeps in
// the browser: edits made to read-only sources (the bundled demo), and the
// comments + comment images of projects that have no daemon to store them.
// Keys are plain strings; callers namespace them ("files:<scope>:<path>").

const DB_NAME = 'od-design-preview';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }),
  );
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T>('readonly', (store) => store.get(key) as IDBRequest<T>);
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await run('readwrite', (store) => store.put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}

function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`);
}

/** All [key, value] pairs whose key starts with `prefix`. */
export async function idbEntries<T>(prefix: string): Promise<Array<[string, T]>> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: Array<[string, T]> = [];
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor(prefixRange(prefix));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      out.push([String(cursor.key), cursor.value as T]);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB cursor failed'));
  });
}

export async function idbDeletePrefix(prefix: string): Promise<void> {
  await run('readwrite', (store) => store.delete(prefixRange(prefix)));
}
