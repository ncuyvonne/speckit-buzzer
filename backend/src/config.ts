export const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_REQUEST_ID = 'x'.repeat(64);
const CONTROL_CHARACTERS = /\p{Cc}/u;

export interface AppConfig {
  readonly teacherPassword: string | null;
  readonly teacherLoginEnabled: boolean;
  readonly groups: readonly string[];
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function serializedRequestBytes(type: string, payload: Record<string, unknown>): number {
  return Buffer.byteLength(
    JSON.stringify({ type, requestId: MAX_REQUEST_ID, payload }),
    'utf8',
  );
}

function parseGroups(value: string | undefined): readonly string[] {
  if (value === undefined) {
    throw new ConfigurationError('GROUP_IDS must contain at least one group ID.');
  }

  const groups = value.split(',').map((entry) => entry.trim());
  if (groups.some((group) => group.length === 0)) {
    throw new ConfigurationError('GROUP_IDS cannot contain empty entries.');
  }

  const unique = new Set<string>();
  for (const group of groups) {
    if (CONTROL_CHARACTERS.test(group)) {
      throw new ConfigurationError('GROUP_IDS cannot contain control characters.');
    }
    if (unique.has(group)) {
      throw new ConfigurationError('GROUP_IDS contains a duplicate entry after trimming.');
    }
    unique.add(group);

    const requestBytes = serializedRequestBytes('student.join', { groupId: group });
    if (requestBytes > MAX_MESSAGE_BYTES) {
      throw new ConfigurationError('A GROUP_IDS entry exceeds the 16 KiB WebSocket message limit.');
    }
  }

  if (groups.length === 0) {
    throw new ConfigurationError('GROUP_IDS must contain at least one group ID.');
  }
  return Object.freeze(groups);
}

export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): AppConfig {
  const groups = parseGroups(env.GROUP_IDS);
  const password = env.TEACHER_PASSWORD;
  const teacherPassword =
    password !== undefined && password.trim().length > 0 &&
    serializedRequestBytes('teacher.authenticate', { password }) <= MAX_MESSAGE_BYTES
      ? password
      : null;

  return Object.freeze({
    teacherPassword,
    teacherLoginEnabled: teacherPassword !== null,
    groups,
  });
}
