const STORAGE_KEY = 'classroom.groupId';

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getSessionStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Holds only the tab's student group selection. The server revalidates it on every connection. */
export class StudentSelection {
  readonly #storage: SessionStorageLike | null;

  constructor(storage: SessionStorageLike | null = getSessionStorage()) {
    this.#storage = storage;
  }

  read(): string | null {
    if (this.#storage === null) return null;
    try {
      const groupId = this.#storage.getItem(STORAGE_KEY);
      if (groupId === null) return null;
      if (groupId.length === 0) {
        this.clear();
        return null;
      }
      return groupId;
    } catch {
      return null;
    }
  }

  save(groupId: string): void {
    if (groupId.length === 0) {
      this.clear();
      return;
    }
    if (this.#storage === null) return;
    try {
      this.#storage.setItem(STORAGE_KEY, groupId);
    } catch {
      // The active connection still works if browser storage is unavailable.
    }
  }

  clear(): void {
    if (this.#storage === null) return;
    try {
      this.#storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing further can be done when browser storage is unavailable.
    }
  }
}

export const STUDENT_SELECTION_STORAGE_KEY = STORAGE_KEY;
