import type { ExportAnchorState, ExportManifest, Question, WorksheetReference } from '../guided-notes/types.js';

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

export interface FairRankingSettings {
  readonly enabled: boolean;
  readonly delaySeconds: number | null;
}

/** Server-owned state for the one activity in this process. */
export class ActivityState {
  #stage: ActivityStage = 'PREPARING';
  #worksheet: WorksheetReference | null = null;
  #questions: readonly Question[] = Object.freeze([]);
  #exportAnchorState: ExportAnchorState = Object.freeze({ status: 'NONE' });
  #fairRankingSettings: FairRankingSettings = Object.freeze({ enabled: false, delaySeconds: null });

  get stage(): ActivityStage {
    return this.#stage;
  }

  get worksheet(): WorksheetReference | null {
    return this.#worksheet;
  }

  get questions(): readonly Question[] {
    return this.#questions;
  }

  get exportAnchorState(): ExportAnchorState {
    return this.#exportAnchorState;
  }

  get fairRankingSettings(): FairRankingSettings {
    return this.#fairRankingSettings;
  }

  setFairRankingSettings(settings: FairRankingSettings): boolean {
    if (this.#stage !== 'PREPARING' || typeof settings.enabled !== 'boolean') return false;
    if (settings.enabled && (typeof settings.delaySeconds !== 'number'
      || !Number.isFinite(settings.delaySeconds)
      || settings.delaySeconds < 1
      || settings.delaySeconds > 30)) return false;
    if (!settings.enabled && settings.delaySeconds !== null
      && (typeof settings.delaySeconds !== 'number'
        || !Number.isFinite(settings.delaySeconds)
        || settings.delaySeconds < 1
        || settings.delaySeconds > 30)) {
      return false;
    }
    this.#fairRankingSettings = Object.freeze({
      enabled: settings.enabled,
      delaySeconds: settings.enabled ? settings.delaySeconds : null,
    });
    return true;
  }

  get fairRankingConfigurationValid(): boolean {
    return !this.#fairRankingSettings.enabled
      || (typeof this.#fairRankingSettings.delaySeconds === 'number'
        && Number.isFinite(this.#fairRankingSettings.delaySeconds)
        && this.#fairRankingSettings.delaySeconds >= 1
        && this.#fairRankingSettings.delaySeconds <= 30);
  }

  setExportAnchorState(state: ExportAnchorState): void {
    if (state.status !== 'NONE') {
      if (this.#worksheet === null || state.manifest.worksheet.sheetId !== this.#worksheet.sheetId
        || state.manifest.worksheet.spreadsheetId !== this.#worksheet.spreadsheetId) {
        throw new TypeError('Export anchor state does not match the active worksheet.');
      }
    }
    if (state.status === 'NONE') {
      this.#exportAnchorState = Object.freeze({ status: 'NONE' });
      return;
    }
    const freezeManifest = (manifest: ExportManifest) => Object.freeze({
      ...manifest,
      worksheet: Object.freeze({ ...manifest.worksheet }),
      header: Object.freeze({ ...manifest.header }),
      targets: Object.freeze(manifest.targets.map((target) => Object.freeze({ ...target }))),
      anchors: Object.freeze(manifest.anchors.map((anchor) => Object.freeze({ ...anchor }))),
    });
    this.#exportAnchorState = state.status === 'PREPARED'
      ? Object.freeze({
        status: 'PREPARED',
        manifest: freezeManifest(state.manifest),
      })
      : Object.freeze({ status: 'CONFIRMED', manifest: freezeManifest(state.manifest) });
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
      if (question.kind === 'SINGLE' && (
        question.answerSlots.length !== 1
        || question.answerSlots[0]?.placeholderNumber !== 1
        || question.answerSlots[0]?.sourceRowAtImport !== question.sourceRowAtImport
      )) {
        throw new TypeError('Guided Notes import state is invalid.');
      }
      if (question.kind === 'GROUP' && (
        question.answerSlots.length < 2
        || question.answerSlots.length > 20
        || question.answerSlots.some((slot, slotIndex) => (
          slot.placeholderNumber !== slotIndex + 1
          || !Number.isInteger(slot.sourceRowAtImport)
          || slot.sourceRowAtImport !== question.sourceRowAtImport + slotIndex
        ))
      )) {
        throw new TypeError('Guided Notes import state is invalid.');
      }
      seen.add(question.questionId);
    }

    this.#worksheet = Object.freeze({ ...worksheet });
    this.#questions = Object.freeze(questions.map((question) => Object.freeze({ ...question })));
    this.#exportAnchorState = Object.freeze({ status: 'NONE' });
    return true;
  }

  advance(from: ActivityStage, to: ActivityStage): TransitionResult {
    if (from !== this.#stage || NEXT_STAGE[this.#stage] !== to
      || (to === 'BUZZING' && !this.fairRankingConfigurationValid)) {
      return { accepted: false, stage: this.#stage };
    }
    this.#stage = to;
    return { accepted: true, stage: this.#stage };
  }
}
