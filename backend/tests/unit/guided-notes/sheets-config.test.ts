import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  parseGoogleServiceAccountCredentials,
} from '../../../src/config.js';

describe('parseGoogleServiceAccountCredentials', () => {
  it('rejects an absent credential without affecting the caller with raw values', () => {
    expect(() => parseGoogleServiceAccountCredentials(undefined)).toThrow(ConfigurationError);
    expect(() => parseGoogleServiceAccountCredentials('  ')).toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/i);
  });

  it('rejects malformed JSON without including its contents in the error', () => {
    const malformed = '{"private_key":"PRIVATE_KEY_SENTINEL_DO_NOT_LEAK"';
    let thrown: unknown;

    try {
      parseGoogleServiceAccountCredentials(malformed);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect((thrown as Error).message).not.toContain('PRIVATE_KEY_SENTINEL_DO_NOT_LEAK');
    expect((thrown as Error).message).not.toContain(malformed);
  });

  it('rejects JSON that is not a complete service-account credential', () => {
    expect(() => parseGoogleServiceAccountCredentials(JSON.stringify({ type: 'authorized_user' })))
      .toThrow(/GOOGLE_SERVICE_ACCOUNT_JSON/i);
    expect(() => parseGoogleServiceAccountCredentials(JSON.stringify({
      type: 'service_account',
      client_email: 'service@example.test',
      private_key: '',
    }))).toThrow(ConfigurationError);
  });

  it('accepts the required service-account fields and returns only safe authentication fields', () => {
    const parsed = parseGoogleServiceAccountCredentials(JSON.stringify({
      type: 'service_account',
      project_id: 'example-project',
      client_email: 'service@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\nFAKE_TEST_KEY\n-----END PRIVATE KEY-----\n',
      private_key_id: 'extra-private-field',
    }));

    expect(parsed).toEqual({
      type: 'service_account',
      project_id: 'example-project',
      client_email: 'service@example.test',
      private_key: '-----BEGIN PRIVATE KEY-----\nFAKE_TEST_KEY\n-----END PRIVATE KEY-----\n',
    });
    expect(parsed).not.toHaveProperty('private_key_id');
  });
});
