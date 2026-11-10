import { describe, expect, it } from 'vitest';
import { decodeClientMessage, errorMessage, isValidRequestId } from '../../src/realtime/protocol.js';

const asBuffer = (value: string) => Buffer.from(value, 'utf8');

describe('request envelope protocol', () => {
  it('decodes a valid teacher login envelope', () => {
    expect(
      decodeClientMessage(
        asBuffer(JSON.stringify({
          type: 'teacher.authenticate',
          requestId: 'r_1-abc',
          payload: { password: 'secret' },
        })),
        false,
      ),
    ).toEqual({
      ok: true,
      message: { type: 'teacher.authenticate', requestId: 'r_1-abc', payload: { password: 'secret' } },
    });
  });

  it('accepts request IDs at both supported length boundaries', () => {
    expect(isValidRequestId('a')).toBe(true);
    expect(isValidRequestId('a'.repeat(64))).toBe(true);
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('a'.repeat(65))).toBe(false);
  });

  it.each(['with space', 'slash/', 'unicode-老師'])('rejects non-ASCII or unsupported request ID %j', (requestId) => {
    expect(isValidRequestId(requestId)).toBe(false);
  });

  it('rejects malformed JSON, binary frames, unknown types and invalid payload shapes', () => {
    expect(decodeClientMessage(asBuffer('{'), false)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(decodeClientMessage(asBuffer('{}'), true)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(
      decodeClientMessage(asBuffer(JSON.stringify({ type: 'unknown', requestId: 'r1', payload: {} })), false),
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', requestId: 'r1' });
    expect(
      decodeClientMessage(
        asBuffer(JSON.stringify({ type: 'student.join', requestId: 'r2', payload: { groupId: 3 } })),
        false,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', requestId: 'r2' });
  });

  it('omits an invalid request ID from the protocol error', () => {
    expect(
      decodeClientMessage(
        asBuffer(JSON.stringify({ type: 'student.join', requestId: 'bad id', payload: { groupId: '1' } })),
        false,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
    expect(
      decodeClientMessage(
        asBuffer(JSON.stringify({ type: 'student.join', requestId: 'bad id', payload: { groupId: '1' } })),
        false,
      ),
    ).not.toHaveProperty('requestId');
  });

  it('provides fixed actionable errors without reflecting supplied secrets', () => {
    expect(errorMessage('AUTH_INVALID')).toMatch(/密碼|設定/);
    expect(errorMessage('INVALID_MESSAGE')).toMatch(/訊息/);
    expect(errorMessage('AUTH_REQUIRED')).toMatch(/老師/);
    expect(errorMessage('GROUP_INVALID')).toMatch(/組別/);
    expect(errorMessage('STAGE_CONFLICT')).toMatch(/階段/);
    expect(errorMessage('AUTH_INVALID')).not.toContain('secret');
  });
});
