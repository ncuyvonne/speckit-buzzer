export type ActivityStage = 'PREPARING' | 'BUZZING' | 'ENDED';

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'AUTH_INVALID'
  | 'AUTH_REQUIRED'
  | 'GROUP_INVALID'
  | 'STAGE_CONFLICT';

export type ClientMessage =
  | { type: 'teacher.authenticate'; requestId: string; payload: { password: string } }
  | { type: 'student.join'; requestId: string; payload: { groupId: string } }
  | { type: 'activity.advance'; requestId: string; payload: { from: ActivityStage; to: ActivityStage } };

export type ServerMessage =
  | { type: 'activity.snapshot'; payload: { stage: ActivityStage; groups: string[] } }
  | { type: 'teacher.authenticated'; requestId: string; payload: { ok: true } }
  | { type: 'student.joined'; requestId: string; payload: { ok: true; groupId: string } }
  | { type: 'activity.phaseChanged'; payload: { stage: ActivityStage } }
  | { type: 'error'; requestId?: string; payload: { code: ErrorCode; message: string } };
