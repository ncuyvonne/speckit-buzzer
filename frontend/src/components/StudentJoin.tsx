import { useState } from 'react';
import type { ConnectionRole } from '../state/activity';

export interface StudentJoinProps {
  readonly role: ConnectionRole;
  readonly groups: readonly string[];
  readonly selectedGroupId: string | null;
  readonly connected: boolean;
  readonly error: string | null;
  readonly onJoin: (groupId: string) => void;
}

export function StudentJoin({ role, groups, selectedGroupId, connected, error, onJoin }: StudentJoinProps) {
  const [groupId, setGroupId] = useState('');

  if (role === 'TEACHER') return null;
  if (role === 'STUDENT' && selectedGroupId) {
    return (
      <section aria-labelledby="student-group-title">
        <h2 id="student-group-title">學生畫面</h2>
        <p>已加入組別：{selectedGroupId}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="student-join-title">
      <h2 id="student-join-title">學生加入</h2>
      <label htmlFor="student-group">學生組別</label>
      <select
        id="student-group"
        name="studentGroup"
        value={groupId}
        onChange={(event) => setGroupId(event.currentTarget.value)}
      >
        <option value="">請選擇組別</option>
        {groups.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <button type="button" disabled={!connected || groupId.length === 0} onClick={() => onJoin(groupId)}>
        加入組別
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
