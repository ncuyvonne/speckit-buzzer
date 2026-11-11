import { describe, expect, it } from 'vitest';
import { decodeClientMessage } from '../../src/realtime/protocol.js';

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

describe('buzzer results submit protocol', () => {
  it('decodes a valid submit request and returns only supported fields', () => {
    expect(decodeClientMessage(encode({
      type: 'buzzerResults.submitAnswer',
      requestId: 'submit-1',
      payload: { questionId: '1', answerText: 'answer' },
    }), false)).toEqual({
      ok: true,
      message: {
        type: 'buzzerResults.submitAnswer',
        requestId: 'submit-1',
        payload: { questionId: '1', answerText: 'answer' },
      },
    });
  });

  it.each([
    { questionId: 1, answerText: 'answer' },
    { questionId: '1', answerText: null },
    { answerText: 'answer' },
    { questionId: '1' },
    { questionId: '1', answerText: 'answer', groupId: 'A' },
    { questionId: '1', answerText: 'answer', receivedAt: 123 },
    { questionId: '1', answerText: 'answer', winningGroupId: 'A' },
  ])('rejects malformed or client-authoritative fields %#', (payload) => {
    expect(decodeClientMessage(encode({
      type: 'buzzerResults.submitAnswer',
      requestId: 'submit-2',
      payload,
    }), false)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE', requestId: 'submit-2' });
  });

  it('rejects invalid request IDs and messages over 16 KiB', () => {
    expect(decodeClientMessage(encode({
      type: 'buzzerResults.submitAnswer',
      requestId: 'bad request id',
      payload: { questionId: '1', answerText: 'answer' },
    }), false)).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });

    expect(decodeClientMessage(encode({
      type: 'buzzerResults.submitAnswer',
      requestId: 'large',
      payload: { questionId: '1', answerText: 'x'.repeat(16 * 1024) },
    }), false)).toEqual({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it.each(['buzzerResults.getTeacherProgress', 'buzzerResults.getStudentResults'])(
    'decodes an empty %s query payload and rejects extra fields',
    (type) => {
      expect(decodeClientMessage(encode({ type, requestId: 'query-1', payload: {} }), false))
        .toMatchObject({ ok: true, message: { type, requestId: 'query-1', payload: {} } });
      expect(decodeClientMessage(encode({ type, requestId: 'query-2', payload: { groupId: 'A' } }), false))
        .toMatchObject({ ok: false, code: 'INVALID_MESSAGE', requestId: 'query-2' });
    },
  );
});
