import { useState, type FormEvent } from 'react';
import {
  guidedNotesRecoveryMessage,
  type ActivityStage,
  type GuidedNotesErrorCode,
  type QuestionLayoutSummary,
} from '../realtime/messages';

export interface GuidedNotesPanelProps {
  readonly stage: ActivityStage | null;
  readonly connected: boolean;
  readonly worksheetTitle: string | null;
  readonly questionIds: readonly string[];
  readonly questionLayouts: readonly QuestionLayoutSummary[];
  readonly questionCount: number;
  readonly busy: boolean;
  readonly error: { readonly code: GuidedNotesErrorCode; readonly message: string } | null;
  readonly exportResult: { readonly writtenCellCount: number; readonly clearedCellCount: number } | null;
  readonly onImport: (spreadsheetUrl: string, worksheetTitle: string) => void;
  readonly onExport: () => void;
}

export function GuidedNotesPanel({
  stage,
  connected,
  worksheetTitle,
  questionIds,
  questionLayouts,
  questionCount,
  busy,
  error,
  exportResult,
  onImport,
  onExport,
}: GuidedNotesPanelProps) {
  const [spreadsheetUrl, setSpreadsheetUrl] = useState('');
  const [selectedWorksheetTitle, setSelectedWorksheetTitle] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onImport(spreadsheetUrl, selectedWorksheetTitle);
  }

  function confirmExport() {
    if (window.confirm('確定要將本次搶答結果寫回目前學習單嗎？沒有成功答案的題目作答格會清空。')) {
      onExport();
    }
  }

  return (
    <section aria-labelledby="guided-notes-title">
      <h2 id="guided-notes-title">Guided Notes</h2>
      <p>成功匯入後會清除舊作答與計分資料，並將搶答時限重設為 0 秒（不限時）；公平順位設定會保留。</p>
      <form onSubmit={submit}>
        <label htmlFor="guided-notes-spreadsheet-url">Google 試算表網址</label>
        <input
          id="guided-notes-spreadsheet-url"
          name="spreadsheetUrl"
          type="url"
          autoComplete="off"
          value={spreadsheetUrl}
          onChange={(event) => setSpreadsheetUrl(event.currentTarget.value)}
          required
        />
        <label htmlFor="guided-notes-worksheet-title">工作表分頁名稱</label>
        <input
          id="guided-notes-worksheet-title"
          name="worksheetTitle"
          type="text"
          autoComplete="off"
          value={selectedWorksheetTitle}
          onChange={(event) => setSelectedWorksheetTitle(event.currentTarget.value)}
          required
        />
        <button
          type="submit"
          disabled={!connected || stage !== 'PREPARING' || busy}
        >
          {busy ? '匯入中…' : '匯入題號'}
        </button>
      </form>
      <button
        type="button"
        disabled={!connected || stage !== 'ENDED' || busy}
        onClick={confirmExport}
      >
        {busy ? '寫回中…' : '寫回答案'}
      </button>
      {error && <p role="alert">{guidedNotesRecoveryMessage(error.code, error.message)}</p>}
      {exportResult && (
        <p aria-live="polite">
          寫回完成：更新 {exportResult.writtenCellCount} 格，清空 {exportResult.clearedCellCount} 格。
        </p>
      )}
      <p>工作表：{worksheetTitle ?? '尚未匯入'}</p>
      <p>題數：{questionCount}</p>
      <ol aria-label="已匯入題號">
        {questionIds.map((questionId, index) => {
          const layout = questionLayouts[index];
          const kind = layout?.kind === 'GROUP' ? '題組' : '單題';
          const answerCount = layout?.answerCount ?? 1;
          return (
            <li key={`${index}-${questionId}`}>
              {questionId}（{kind}，{answerCount} 個填空）
            </li>
          );
        })}
      </ol>
    </section>
  );
}
