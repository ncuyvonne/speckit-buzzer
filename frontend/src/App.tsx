import { useEffect, useState, useSyncExternalStore } from 'react';
import { StudentJoin } from './components/StudentJoin';
import { GuidedNotesPanel } from './components/GuidedNotesPanel';
import { TeacherPanel } from './components/TeacherPanel';
import { BuzzerAnswerPanel } from './components/BuzzerAnswerPanel';
import { StudentResultsPanel } from './components/StudentResultsPanel';
import { RealtimeClient } from './realtime/client';

const STAGE_LABELS = {
  PREPARING: '準備中',
  BUZZING: '搶答中',
  ENDED: '已結束',
} as const;

export default function App() {
  const [client] = useState(() => new RealtimeClient());
  const state = useSyncExternalStore(client.store.subscribe, client.store.getSnapshot);
  const buzzerState = useSyncExternalStore(client.buzzerResults.subscribe, client.buzzerResults.getSnapshot);
  const teacherError = state.serverError &&
    ['AUTH_INVALID', 'STAGE_CONFLICT'].includes(state.serverError.code)
    ? state.serverError.message
    : null;
  const authorizationError = state.serverError?.code === 'AUTH_REQUIRED'
    ? state.serverError.message
    : null;

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  return (
    <main>
      <h1>課堂搶答系統</h1>
      <p role="status">
        {state.connection === 'connected' ? '已連線' : state.connection === 'reconnecting' ? '正在重新連線' : '連線準備中'}
      </p>
      <p>活動階段：{state.stage ? STAGE_LABELS[state.stage] : '等待伺服器快照'}</p>
      {state.role !== 'STUDENT' && (
        <TeacherPanel
          role={state.role}
          stage={state.stage}
          connected={state.connection === 'connected'}
          error={teacherError}
          onLogin={(password) => client.authenticate(password)}
          onAdvance={(from, to) => client.advance(from, to)}
          resultsProgress={buzzerState.teacherProgress}
        />
      )}
      {state.role === 'TEACHER' && (
        <GuidedNotesPanel
          stage={state.stage}
          connected={state.connection === 'connected'}
          worksheetTitle={state.worksheetTitle}
          questionIds={state.questionIds}
          questionCount={state.questionCount}
          busy={state.guidedNotesBusy}
          error={state.guidedNotesError}
          exportResult={state.guidedNotesExportResult}
          onImport={(spreadsheetUrl, worksheetTitle) => client.importWorksheet(spreadsheetUrl, worksheetTitle)}
          onExport={() => client.exportAnswers()}
        />
      )}
      {state.role === 'STUDENT' && (
        <BuzzerAnswerPanel
          groupId={state.selectedGroupId}
          stage={state.stage}
          connected={state.connection === 'connected'}
          state={buzzerState}
          onSubmit={(questionId, answerText) => client.submitAnswer(questionId, answerText)}
          onClearError={() => client.buzzerResults.clearError()}
        />
      )}
      {state.role === 'STUDENT' && state.stage === 'ENDED' && (
        <StudentResultsPanel results={buzzerState.studentResults} />
      )}
      {state.role !== 'TEACHER' && (
        <StudentJoin
          role={state.role}
          groups={state.groups}
          selectedGroupId={state.selectedGroupId}
          connected={state.connection === 'connected'}
          error={state.serverError?.code === 'GROUP_INVALID' ? state.serverError.message : null}
          onJoin={(groupId) => client.join(groupId)}
        />
      )}
      {authorizationError && <p role="alert">{authorizationError}</p>}
      {state.connectionMessage && <p role="alert">{state.connectionMessage}</p>}
      {state.canReconnect && <button onClick={() => client.reconnect()}>重新連線</button>}
    </main>
  );
}
