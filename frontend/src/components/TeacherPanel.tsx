import { useEffect, useState, type FormEvent } from 'react';
import type { ActivityStage, FairRankingSettings } from '../realtime/messages';
import type { ConnectionRole } from '../state/activity';
import { validateFairRankingDelay } from '../state/buzzer-results';
import { TeacherResultsPanel } from './TeacherResultsPanel';
import type { TeacherProgress } from '../realtime/messages';

export interface CsvExportState {
  readonly status: 'idle' | 'pending' | 'downloaded' | 'error';
  readonly fileName: string | null;
  readonly message: string | null;
}

export interface TeacherPanelProps {
  readonly role: ConnectionRole;
  readonly stage: ActivityStage | null;
  readonly connected: boolean;
  readonly error: string | null;
  readonly onLogin: (password: string) => void;
  readonly onAdvance: (from: ActivityStage, to: ActivityStage) => void;
  readonly resultsProgress?: TeacherProgress | null;
  readonly fairRankingSettings?: FairRankingSettings;
  readonly onSetFairRanking?: (settings: FairRankingSettings) => void;
  readonly csvExport?: CsvExportState;
  readonly onExportCsv?: () => void;
}

const NEXT_STAGE: Partial<Record<ActivityStage, ActivityStage>> = {
  PREPARING: 'BUZZING',
  BUZZING: 'ENDED',
};

const NEXT_ACTION: Partial<Record<ActivityStage, string>> = {
  PREPARING: '開始搶答',
  BUZZING: '結束活動',
};

export function TeacherPanel({
  role,
  stage,
  connected,
  error,
  onLogin,
  onAdvance,
  resultsProgress = null,
  fairRankingSettings = { enabled: false, delaySeconds: null },
  onSetFairRanking = () => undefined,
  csvExport = { status: 'idle', fileName: null, message: null },
  onExportCsv = () => undefined,
}: TeacherPanelProps) {
  const [password, setPassword] = useState('');
  const [fairRankingEnabled, setFairRankingEnabled] = useState(fairRankingSettings.enabled);
  const [delayText, setDelayText] = useState(fairRankingSettings.delaySeconds?.toString() ?? '3');
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    setFairRankingEnabled(fairRankingSettings.enabled);
    setDelayText(fairRankingSettings.delaySeconds?.toString() ?? '3');
    setSettingsError(null);
  }, [fairRankingSettings.enabled, fairRankingSettings.delaySeconds]);

  if (role === 'TEACHER') {
    const nextStage = stage ? NEXT_STAGE[stage] : undefined;
    const delayError = fairRankingEnabled ? validateFairRankingDelay(delayText) : null;
    const draftDelay = fairRankingEnabled ? Number(delayText) : null;
    const hasUnsavedSettings = fairRankingEnabled !== fairRankingSettings.enabled
      || draftDelay !== fairRankingSettings.delaySeconds;
    const canStart = connected && !(fairRankingEnabled && delayError !== null) && !hasUnsavedSettings;

    function saveFairRanking(): void {
      if (fairRankingEnabled && delayError !== null) {
        setSettingsError(delayError);
        return;
      }
      setSettingsError(null);
      onSetFairRanking({
        enabled: fairRankingEnabled,
        delaySeconds: fairRankingEnabled ? Number(delayText) : null,
      });
    }

    return (
      <section aria-labelledby="teacher-panel-title">
        <h2 id="teacher-panel-title">老師控制台</h2>
        {error && <p role="alert">{error}</p>}
        {nextStage && stage && (
          <button type="button" disabled={stage === 'PREPARING' ? !canStart : !connected} onClick={() => onAdvance(stage, nextStage)}>
            {NEXT_ACTION[stage]}
          </button>
        )}
        {stage === 'PREPARING' && (
          <fieldset>
            <legend>公平順位設定</legend>
            <label>
              <input
                type="checkbox"
                checked={fairRankingEnabled}
                onChange={(event) => {
                  setFairRankingEnabled(event.currentTarget.checked);
                  setSettingsError(null);
                }}
              />
              啟用公平順位
            </label>
            <label htmlFor="fair-ranking-delay">每次成功題數增加延遲（秒）</label>
            <input
              id="fair-ranking-delay"
              name="fairRankingDelaySeconds"
              type="number"
              min="1"
              max="30"
              step="any"
              inputMode="decimal"
              value={delayText}
              disabled={!fairRankingEnabled}
              onChange={(event) => {
                setDelayText(event.currentTarget.value);
                setSettingsError(null);
              }}
            />
            {fairRankingEnabled && delayError !== null && <p role="alert">{settingsError ?? delayError}</p>}
            {hasUnsavedSettings && <p role="status">順位設定尚未儲存；請先儲存再開始活動。</p>}
            <button type="button" disabled={!connected || !hasUnsavedSettings} onClick={saveFairRanking}>
              儲存順位設定
            </button>
          </fieldset>
        )}
        {stage === 'ENDED' && (
          <div>
            <p>活動已結束。</p>
            <button type="button" disabled={!connected || csvExport.status === 'pending'} onClick={onExportCsv}>
              {csvExport.status === 'pending' ? '準備 CSV 中…' : '匯出 CSV'}
            </button>
            {csvExport.status === 'downloaded' && <p role="status">已下載 {csvExport.fileName}</p>}
            {csvExport.status === 'error' && <p role="alert">{csvExport.message}</p>}
          </div>
        )}
        <TeacherResultsPanel progress={resultsProgress} rankingMayChange={stage === 'BUZZING' && fairRankingSettings.enabled} />
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
