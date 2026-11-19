const STORAGE_KEY = 'classroom.groupId';
const HISTORY_STATE_KEY = '__speckitBuzzerStudentSelection';
const HISTORY_ORIGINAL_STATE_KEY = '__speckitBuzzerPreviousHistoryState';

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface HistoryStateLike {
  readonly state: unknown;
  replaceState(state: unknown, unused: string): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class HistoryStateStorage implements SessionStorageLike {
  readonly #history: HistoryStateLike;

  constructor(history: HistoryStateLike) {
    this.#history = history;
  }

  getItem(key: string): string | null {
    const state = this.#history.state;
    if (!isPlainObject(state)) return null;
    const values = state[HISTORY_STATE_KEY];
    if (!isPlainObject(values)) return null;
    const value = values[key];
    return typeof value === 'string' ? value : null;
  }

  setItem(key: string, value: string): void {
    if (this.getItem(key) === value) return;
    const current = this.#history.state;
    const next: Record<string, unknown> = isPlainObject(current)
      ? { ...current }
      : { [HISTORY_ORIGINAL_STATE_KEY]: current };
    const existingValues = next[HISTORY_STATE_KEY];
    const values = isPlainObject(existingValues) ? existingValues : {};
    this.#history.replaceState({
      ...next,
      [HISTORY_STATE_KEY]: { ...values, [key]: value },
    }, '');
  }

  removeItem(key: string): void {
    const current = this.#history.state;
    if (!isPlainObject(current)) return;
    const currentValues = current[HISTORY_STATE_KEY];
    if (!isPlainObject(currentValues) || !(key in currentValues)) return;

    const values = { ...currentValues };
    delete values[key];
    const next = { ...current };
    if (Object.keys(values).length > 0) next[HISTORY_STATE_KEY] = values;
    else delete next[HISTORY_STATE_KEY];

    if (Object.prototype.hasOwnProperty.call(next, HISTORY_ORIGINAL_STATE_KEY)) {
      const originalState = next[HISTORY_ORIGINAL_STATE_KEY];
      delete next[HISTORY_ORIGINAL_STATE_KEY];
      if (Object.keys(next).length === 0) {
        this.#history.replaceState(originalState, '');
        return;
      }
    }

    this.#history.replaceState(Object.keys(next).length > 0 ? next : null, '');
  }
}

function getSessionStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function getHistoryStateStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' || !window.history
      ? null
      : new HistoryStateStorage(window.history);
  } catch {
    return null;
  }
}

/** Holds the tab's student group selection; the server revalidates it on every connection. */
export class StudentSelection {
  readonly #storage: SessionStorageLike | null;
  readonly #fallbackStorage: SessionStorageLike | null;
  #storageUnavailable: boolean;
  #fallbackUnavailable: boolean;
  #memoryGroupId: string | null = null;

  constructor(storage: SessionStorageLike | null = getSessionStorage()) {
    this.#storage = storage;
    this.#fallbackStorage = getHistoryStateStorage();
    this.#storageUnavailable = storage === null;
    this.#fallbackUnavailable = this.#fallbackStorage === null;
  }

  read(): string | null {
    if (this.#storageUnavailable || this.#storage === null) return this.#readFallback();
    try {
      const groupId = this.#storage.getItem(STORAGE_KEY);
      if (groupId === null || groupId.length === 0) {
        const fallbackGroupId = this.#readFallback();
        if (fallbackGroupId !== null) {
          try {
            this.#storage.setItem(STORAGE_KEY, fallbackGroupId);
          } catch {
            this.#storageUnavailable = true;
          }
          return fallbackGroupId;
        }
        this.#memoryGroupId = null;
        this.#removeFallback();
        if (groupId === '') {
          try {
            this.#storage.removeItem(STORAGE_KEY);
          } catch {
            this.#storageUnavailable = true;
          }
        }
        return null;
      }
      this.#memoryGroupId = groupId;
      this.#writeFallback(groupId);
      return groupId;
    } catch {
      this.#storageUnavailable = true;
      return this.#readFallback();
    }
  }

  save(groupId: string): void {
    if (groupId.length === 0) {
      this.clear();
      return;
    }
    this.#memoryGroupId = groupId;
    if (!this.#storageUnavailable && this.#storage !== null) {
      try {
        this.#storage.setItem(STORAGE_KEY, groupId);
      } catch {
        this.#storageUnavailable = true;
      }
    }
    this.#writeFallback(groupId);
  }

  clear(): void {
    this.#memoryGroupId = null;
    if (!this.#storageUnavailable && this.#storage !== null) {
      try {
        this.#storage.removeItem(STORAGE_KEY);
      } catch {
        this.#storageUnavailable = true;
      }
    }
    this.#removeFallback();
  }

  #readFallback(): string | null {
    if (!this.#fallbackUnavailable && this.#fallbackStorage !== null) {
      try {
        const groupId = this.#fallbackStorage.getItem(STORAGE_KEY);
        if (groupId !== null) {
          if (groupId.length === 0) {
            this.#removeFallback();
            this.#memoryGroupId = null;
            return null;
          }
          this.#memoryGroupId = groupId;
          return groupId;
        }
      } catch {
        this.#fallbackUnavailable = true;
      }
    }
    return this.#memoryGroupId;
  }

  #writeFallback(groupId: string): void {
    if (this.#fallbackUnavailable || this.#fallbackStorage === null) return;
    try {
      this.#fallbackStorage.setItem(STORAGE_KEY, groupId);
    } catch {
      this.#fallbackUnavailable = true;
    }
  }

  #removeFallback(): void {
    if (this.#fallbackUnavailable || this.#fallbackStorage === null) return;
    try {
      this.#fallbackStorage.removeItem(STORAGE_KEY);
    } catch {
      this.#fallbackUnavailable = true;
    }
  }
}

export const STUDENT_SELECTION_STORAGE_KEY = STORAGE_KEY;
