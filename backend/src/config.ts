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

export interface GoogleServiceAccountCredentials {
  readonly type: 'service_account';
  readonly project_id?: string;
  readonly client_email: string;
  readonly private_key: string;
}

/**
 * Parse the backend-only service-account environment value without ever
 * echoing the credential or JSON parser details in an error message.
 */
export function parseGoogleServiceAccountCredentials(
  serialized: string | undefined,
): GoogleServiceAccountCredentials {
  if (serialized === undefined || serialized.trim().length === 0) {
    throw new ConfigurationError('GOOGLE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new ConfigurationError('GOOGLE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.');
  }

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new ConfigurationError('GOOGLE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.');
  }

  const record = candidate as Record<string, unknown>;
  const clientEmail = record.client_email;
  const privateKey = record.private_key;
  const projectId = record.project_id;
  const validPrivateKey = typeof privateKey === 'string'
    && privateKey.includes('-----BEGIN PRIVATE KEY-----')
    && privateKey.includes('-----END PRIVATE KEY-----');

  if (
    record.type !== 'service_account'
    || typeof clientEmail !== 'string'
    || clientEmail.trim().length === 0
    || !validPrivateKey
    || (projectId !== undefined && (typeof projectId !== 'string' || projectId.trim().length === 0))
  ) {
    throw new ConfigurationError('GOOGLE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.');
  }

  return Object.freeze({
    type: 'service_account',
    ...(typeof projectId === 'string' ? { project_id: projectId } : {}),
    client_email: clientEmail,
    private_key: privateKey,
  });
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
