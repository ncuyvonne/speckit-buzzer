import type { Question, WorksheetReference } from '../guided-notes/types.js';

export const ACTIVITY_STAGES = ['PREPARING', 'BUZZING', 'ENDED'] as const;
export type ActivityStage = (typeof ACTIVITY_STAGES)[number];

const NEXT_STAGE: Readonly<Record<ActivityStage, ActivityStage | null>> = {
  PREPARING: 'BUZZING',
  BUZZING: 'ENDED',
  ENDED: null,
};

export interface TransitionResult {
  readonly accepted: boolean;
  readonly stage: ActivityStage;
}

/** Server-owned state for the one activity in this process. */
export class ActivityState {
  #stage: ActivityStage = 'PREPARING';
  #worksheet: WorksheetReference | null = null;
  #questions: readonly Question[] = Object.freeze([]);

  get stage(): ActivityStage {
    return this.#stage;
  }

  get worksheet(): WorksheetReference | null {
    return this.#worksheet;
  }

  get questions(): readonly Question[] {
    return this.#questions;
  }

  get questionCount(): number {
    return this.#questions.length;
  }

  /** Replaces the complete Guided Notes import only while the authoritative stage is PREPARING. */
  replaceGuidedNotesImport(worksheet: WorksheetReference, questions: readonly Question[]): boolean {
    if (this.#stage !== 'PREPARING') return false;
    if (
      worksheet.spreadsheetId.trim().length === 0
      || !Number.isInteger(worksheet.sheetId)
      || worksheet.worksheetTitle.trim().length === 0
      || questions.length < 1
      || questions.length > 100
    ) {
      throw new TypeError('Guided Notes import state is invalid.');
    }

    const seen = new Set<string>();
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index]!;
      if (
        question.questionId.trim().length === 0
        || seen.has(question.questionId)
        || question.displayOrder !== index + 1
        || !Number.isInteger(question.sourceRowAtImport)
        || question.sourceRowAtImport < 1
      ) {
        throw new TypeError('Guided Notes import state is invalid.');
      }
      seen.add(question.questionId);
    }

    this.#worksheet = Object.freeze({ ...worksheet });
    this.#questions = Object.freeze(questions.map((question) => Object.freeze({ ...question })));
    return true;
  }

  advance(from: ActivityStage, to: ActivityStage): TransitionResult {
    if (from !== this.#stage || NEXT_STAGE[this.#stage] !== to) {
      return { accepted: false, stage: this.#stage };
    }
    this.#stage = to;
    return { accepted: true, stage: this.#stage };
  }
}
