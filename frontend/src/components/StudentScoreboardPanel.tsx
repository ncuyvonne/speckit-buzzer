import type { ScoreboardEntry } from '../realtime/messages';
import { ScoreboardTable } from './TeacherScoringPanel';

export function StudentScoreboardPanel({ entries }: { readonly entries: readonly ScoreboardEntry[] | null }) {
  return (
    <section aria-labelledby="student-scoreboard-title">
      <h2 id="student-scoreboard-title">計分板</h2>
      <ScoreboardTable entries={entries} />
    </section>
  );
}
