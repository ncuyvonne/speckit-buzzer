const STORAGE_KEY = 'classroom.groupId';

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Holds only the tab's student group selection. The server revalidates it on every connection. */
export class StudentSelection {
  readonly #storage: SessionStorageLike;

  constructor(storage: SessionStorageLike = window.sessionStorage) {
    this.#storage = storage;
  }

  read(): string | null {
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
    try {
      this.#storage.setItem(STORAGE_KEY, groupId);
    } catch {
      // The active connection still works if browser storage is unavailable.
    }
  }

  clear(): void {
    try {
      this.#storage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing further can be done when browser storage is unavailable.
    }
  }
}

export const STUDENT_SELECTION_STORAGE_KEY = STORAGE_KEY;
