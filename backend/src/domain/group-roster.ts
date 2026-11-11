export class GroupRoster {
  readonly #ids: readonly string[];
  readonly #lookup: ReadonlySet<string>;

  constructor(validatedIds: readonly string[]) {
    this.#ids = Object.freeze([...validatedIds]);
    this.#lookup = new Set(this.#ids);
  }

  get ids(): readonly string[] {
    return this.#ids;
  }

  has(groupId: string): boolean {
    return this.#lookup.has(groupId);
  }
}
