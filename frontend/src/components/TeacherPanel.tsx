import { useState, type FormEvent } from 'react';
import type { ActivityStage } from '../realtime/messages';
import type { ConnectionRole } from '../state/activity';
import { TeacherResultsPanel } from './TeacherResultsPanel';
import type { TeacherProgress } from '../realtime/messages';

export interface TeacherPanelProps {
  readonly role: ConnectionRole;
  readonly stage: ActivityStage | null;
  readonly connected: boolean;
  readonly error: string | null;
  readonly onLogin: (password: string) => void;
  readonly onAdvance: (from: ActivityStage, to: ActivityStage) => void;
  readonly resultsProgress?: TeacherProgress | null;
}

const NEXT_STAGE: Partial<Record<ActivityStage, ActivityStage>> = {
  PREPARING: 'BUZZING',
  BUZZING: 'ENDED',
};

const NEXT_ACTION: Partial<Record<ActivityStage, string>> = {
  PREPARING: '開始搶答',
  BUZZING: '結束活動',
};

export function TeacherPanel({ role, stage, connected, error, onLogin, onAdvance, resultsProgress = null }: TeacherPanelProps) {
  const [password, setPassword] = useState('');

  if (role === 'TEACHER') {
    const nextStage = stage ? NEXT_STAGE[stage] : undefined;
    return (
      <section aria-labelledby="teacher-panel-title">
        <h2 id="teacher-panel-title">老師控制台</h2>
        {error && <p role="alert">{error}</p>}
        {nextStage && stage && (
          <button type="button" disabled={!connected} onClick={() => onAdvance(stage, nextStage)}>
            {NEXT_ACTION[stage]}
          </button>
        )}
        {stage === 'ENDED' && <p>活動已結束。</p>}
        <TeacherResultsPanel progress={resultsProgress} />
      </section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedPassword = password;
    setPassword('');
    onLogin(submittedPassword);
  }

  return (
    <section aria-labelledby="teacher-login-title">
      <h2 id="teacher-login-title">老師登入</h2>
      <form onSubmit={submit}>
        <label htmlFor="teacher-password">老師密碼</label>
        <input
          id="teacher-password"
          name="teacherPassword"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <button type="submit" disabled={!connected}>老師登入</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
