# Implementation Plan: 004 題組與多填空

**Branch**: `codex/004-question-groups` | **Implementation checkout**: isolated worktree based on `codex-003-buzzer-results` | **Date**: 2026-11-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification in `specs/004-question-groups/spec.md` and user-provided stack: TypeScript + React + Vite frontend; Node.js + WebSocket backend; in-memory or SQLite storage; Google Sheets API with environment-only credentials; Vitest and Playwright; Feature 004 diagrams as the design blueprint.

## Summary

Extend Guided Notes and buzzer results for single answers and groups of 2–20 ordered slots. Import validates that each group can be submitted within 16 KiB. Students send one complete answer vector, and the server ranks accepted submissions by receipt. First export resolves current placeholders and records the original target coordinates. Later exports verify those coordinates and their question/slot identities before writing.

## Technical Context

**Language/Version**: TypeScript 5.9; Node.js 24 LTS (existing repo guidance/types); React 19.3.

**Primary Dependencies**: Vite 8, `ws` 8.18, `googleapis` 189; existing npm workspaces. No new runtime or UI framework dependency is planned.

**Storage**: Process memory, extending `ActivityState` and `BuzzerResultsService`. The accepted spec excludes activity recovery after backend restart; SQLite would add persistence behavior outside the requested scope.

**Testing**: Vitest 5 for backend parser/domain/service and frontend state tests; Playwright 1.63 for browser E2E. Reuse the existing fake Sheets adapter, fake results provider, and test server.

**Target Platform**: Windows local classroom application. The frontend and WebSocket backend remain bound to loopback; only the backend connects to Google Sheets API over HTTPS.

**Project Type**: Existing local web application with `frontend/` React SPA and `backend/` Node.js WebSocket server.

**Performance Goals**: Meet Feature 004 SC-008 / Feature 002's reference target: import and export each complete within 10 seconds for at most 100 top-level question IDs and the reference grid up to 1,000 rows × 26 columns, with no injected network delay or quota/transient API error.

**Constraints**: Server authority covers role, group, stage, validation, receipt order and winners. Google Sheets credentials stay in the backend environment. Each group contains 2–20 slots. Its full UTF-8 submission, including the envelope, must fit in 16,384 bytes. Each export has one atomic write for all target values. First export includes private row and column identifiers in that batch. Keep Feature 002's deadlines, lock and uncertain write handling.

**Scale/Scope**: One in-memory classroom activity, one teacher, the configured student groups, and 1–100 unique top-level question IDs. Single questions and groups with differing slot counts can coexist. No durable result history, answer correctness, or scoring is introduced.

## Constitution Check

| Principle / gate | Plan evidence | Status |
|---|---|---|
| I. Input validation and actionable errors | Import checks the selected sheet for persisted `sb004` export anchors before parsing, then validates header uniqueness, question IDs, placeholder sequence and row adjacency. The buzzer service rejects incomplete/blank vectors without writing any submission; errors name missing/invalid slot numbers. Export validates every target before its batch. | PASS |
| II. Credentials and sensitive data | `GOOGLE_SERVICE_ACCOUNT_JSON` and anchor IDs stay on the backend. The server does not echo the teacher's full worksheet URL. Teachers receive all group answers. Students receive own group answers during BUZZING and own plus winner after ENDED under FR-014/015. | PASS |
| III. Normal and boundary tests | Plan covers valid mixed sheets, marker and byte-limit failures, partial/blank submissions, ranking ties, non-scoring behavior, privacy projections, no-winner clears, write rejection, and repeat export. Commands and expected outcomes are in `quickstart.md`; tests have not been run as part of planning. | PASS (planned; implementation verification remains required) |
| IV. Server-owned state and time | `RealtimeHub` derives role/group from the authenticated connection; `ActivityState` owns stage/question definitions; `BuzzerResultsService` validates the trusted group and records one complete vector synchronously with server receive order. | PASS |
| V. Spec, diagrams, and implementation alignment | The plan maps every Feature 004 `.puml` blueprint to current modules and updates the export/submission diagrams for the accepted re-export behavior and existing `BuzzerResultsService`. Implementation must follow these contracts or update the diagrams/spec together. | PASS |
| VI. Independent branch and PR | Use the isolated implementation branch described below. PR review follows implementation and convergence. | Required before implementation and merge |
| VII. PlantUML design priority | Component, class, import, submit, and export `.puml` files under `diagrams/004-*` are the design blueprint. All five PNGs have now been regenerated from their paired sources and verified before implementation. | PASS |
| Local-only project scope | Keep the app on loopback. Google Sheets API is the feature's external data service and is called by the backend. | PASS |
| Development workflow | Regenerate tasks from this design and repeat cross-artifact analysis before implementation. Run the convergence check after implementation and before final PR review/merge. | Required before implementation and merge |

**Pre-research gate**: The spec defines group sizes, submission limits and repeat export behavior. The research phase resolves the transport measurement and original target verification designs.

## Project Structure

### Documentation (this feature)

```text
specs/004-question-groups/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── group-questions-websocket.md
    └── worksheet-group-layout.md
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── App.tsx                         # Wire layout summaries and grouped submit to existing panels
│   ├── components/
│   │   ├── BuzzerAnswerPanel.tsx       # Render single answer or all imported group slots
│   │   ├── TeacherResultsPanel.tsx     # Show complete per-group vectors and winner vector
│   │   ├── StudentResultsPanel.tsx     # Show winner vector and requesting group's vector
│   │   └── GuidedNotesPanel.tsx        # Show imported question types/slot counts to teacher
│   ├── realtime/
│   │   ├── messages.ts                # Wire types and errors
│   │   └── client.ts                  # Send exact measured request, track acceptance, decode role views
│   └── state/
│       ├── activity.ts                 # Store ordered question layout summary
│       └── buzzer-results.ts           # Store own/group answer vectors and projections
└── tests/
    ├── unit/                            # Extend current Vitest client/state tests
    └── e2e/                             # Extend existing import, submit, results, export flows

backend/
├── src/
│   ├── domain/
│   │   ├── activity-state.ts           # Validate and atomically replace imported question layouts
│   │   └── buzzer-results.ts           # Validate/lock full answer vectors and derive winners
│   ├── guided-notes/
│   │   ├── types.ts                    # Question union, answer slots, vectors, result projections
│   │   ├── worksheet-parser.ts         # Parse markers and map initial/repeated export targets
│   │   ├── winning-results-provider.ts # Carry complete winning vectors into real export
│   │   └── service.ts                  # Reuse existing serialized import/export operations
│   ├── integrations/google-sheets/
│   │   ├── types.ts                    # Multi-slot write target contract
│   │   └── adapter.ts                  # Read Sheets anchors and apply the atomic target batch
│   └── realtime/
│       ├── protocol.ts                 # Validate the grouped submission payload
│       └── handler.ts                  # Role/phase checks and privacy-safe broadcasts
└── tests/
    ├── unit/guided-notes/               # Extend worksheet-parser/export-mapping tests
    ├── unit/buzzer-results.test.ts      # Complete/partial vectors, lock, rank order
    ├── integration/                     # Extend import/export/submit/progress coverage
    └── support/                         # Reuse fake Sheets/results and test server
```

**Structure Decision**: Extend the existing npm workspaces and module boundaries. The current `backend/src/server.ts` remains the composition root. `BuzzerResultsService` owns single and grouped submissions; `GuidedNotesService` remains the serialized worksheet operation; `WorksheetParser` owns marker/layout rules. The UI uses the existing shared WebSocket client and stores. No new application, database, framework, or parallel service layer is planned.

## Blueprint Alignment

| Feature 004 diagram | Design responsibility | Planned implementation mapping |
|---|---|---|
| [Component](../../diagrams/004-question-groups-component.puml) | UI → WebSocket client → RealtimeHub → existing services → Sheets. | `App.tsx`, panels, `realtime/client.ts`, `RealtimeHub`, `GuidedNotesService`, `ActivityState`, `BuzzerResultsService`, `BuzzerWinningResultsProvider`, adapter. |
| [Class](../../diagrams/004-question-groups-class.puml) | Single/group question types, 2–20 ordered slots, complete submission, winner, and first export manifest. | `guided-notes/types.ts`, `activity-state.ts`, `buzzer-results.ts`, Sheets types. |
| [Import sequence](../../diagrams/004-question-groups-sequence-import.puml) | Role/phase checks, persisted `sb004` export-anchor rejection, slot validation, minimum payload check, and atomic replacement. | Existing `guidedNotes.import` handler, Sheets metadata read, parser, service and Activity replacement. |
| [Submit sequence](../../diagrams/004-question-groups-sequence-submit.puml) | Browser measures exact message and retains the draft on overflow. Server validates before lock and ranking. | `App.tsx`, frontend client/store, `buzzerResults.submitAnswer` routing, domain service, role projections. |
| [Export sequence](../../diagrams/004-question-groups-sequence-export.puml) | READY results, first export using markers, original coordinate verification, atomic writes, and reconciliation. | Real provider, parser, `GuidedNotesService.exportAnswers`, activity manifest, Sheets adapter. |

All five PNGs are paired with their `.puml` sources in `diagrams/`. If implementation changes these boundaries or the repeat-export path, update the corresponding source diagram and regenerate its PNG.

## Design Decisions and Operation Boundaries

1. **Question shape and counts (FR-003–008)**: Keep up to 100 unique top-level question IDs. A single question has one logical slot. Groups have their own ordered sequences of 2–20 full-width markers. Reject a malformed sequence, out-of-range count or unshippable group before committing any replacement of the current activity.
2. **Minimum submission on import (FR-008/009)**: At the backend, serialize the compact group request envelope with the real displayed ID, its slots with `a` in each answer and a representative 36-byte ASCII browser request ID. Measure UTF-8 bytes. For over-limit questions report the ID and source row and suggest shortening the ID or splitting the group. Recheck PREPARING before commit. The same envelope and byte boundary are defined in the [WebSocket contract](./contracts/group-questions-websocket.md).
3. **Submission and rank (FR-009–013)**: The group browser path creates a fixed-width 36-byte ASCII request ID, measures the complete serialized message and sends that exact string only when it fits. Retain drafts and show a local shortening hint on overflow. Preserve the single-answer path and the server's 16,384-byte transport and decoder guards. Validate role, stage, type, unique slot set and nonblank text before synchronously recording the first valid vector and server receipt order for each group/question.
4. **Display and production export inputs (FR-007, FR-014–016)**: Wire layout/answer submission through `App.tsx`, `realtime/client.ts`, and the stores. Update the client's pending/accepted requests and snapshot, broadcast and reconnect decoders. Teachers see all group answers. Students see their own live answers and own/winner answers after ENDED. Feed ordered vectors from `BuzzerWinningResultsProvider` into the existing real export path. Preserve READY with no winners as a valid clear operation and stop on UNAVAILABLE.
5. **First export (FR-016–019)**: Rediscover unique headers, question IDs and markers. Verify current question kinds and group slot counts against the imported activity. Prepare an in-memory manifest with original sheet/row/column coordinates, target-to-slot mappings, IDs of anchors to create, prewrite values and intended values. Apply all target writes and PROJECT developer metadata for the header row, each distinct target row and the question/answer columns in one `spreadsheets.batchUpdate`. Update only `userEnteredValue` in cells, using literal strings and field-mask clears. See the [worksheet contract](./contracts/worksheet-group-layout.md).
6. **Repeat export and reconciliation (FR-016–020)**: Re-read live sheet identity, headers, parent IDs and blank child relationships plus all row/column anchors. Require exact recorded coordinates and matching mappings. Confirmed target-cell values are not identity evidence: if a teacher edits a target value after confirmation, a repeat still writes the activity result to that verified original cell. Refuse the entire write if any required anchor or structural mapping evidence differs or is missing. After an unconfirmed first write, compare its manifest, anchors, mapping and intended values: a complete match promotes it to confirmed and reports success without another batch; definitive non-application allows revalidation and a later fresh first attempt; inconclusive evidence keeps PREPARED and returns unconfirmed without writing. If a confirmed repeat is uncertain, keep the original activity manifest CONFIRMED and retain a private pending-repeat snapshot; reconcile it before another write.
7. **Sheets and memory boundaries**: Keep Sheets calls in the existing adapter under the existing Sheets scope and Feature 002 deadline/lock/retry rules. Keep the manifest, its status and results in the active process. Feature 004's stable PROJECT developer metadata key is `sb004`; anchor entries contain identifiers only. Activity replacement or process restart discards the in-memory manifest but leaves sheet anchors. Before parsing a selected sheet for a new activity, `GuidedNotesService` calls `spreadsheets.developerMetadata.search` for `metadataKey=sb004` and `visibility=PROJECT`, matches ROW/COLUMN locations to the selected numeric `sheetId`, and rejects a match with an actionable original/unexported-sheet message; other keys, tabs and location types are ignored, and the active question state remains unchanged.

## Validation Plan

The planned test scenarios and runnable commands are documented in [quickstart.md](./quickstart.md). The implementation phase should extend the existing test files rather than introduce a separate harness:

- Parser and import: valid mixed rows, one-marker/20/21-slot boundaries, minimum complete request at 16,384/16,385 bytes, `sb004` exported-sheet rejection with unrelated-key acceptance, unauthorized/wrong-stage rejection before Sheets access, and original activity intact on any failure.
- Buzzer domain: single answer regression; complete group vector; missing/blank/extra/duplicate slot rejection; no lock/rank on invalid input; duplicate lock; earliest complete server order; equal timestamp order.
- Client and server transport: exact UTF-8 envelope sizing for multibyte text and escaped JSON, draft retention with no send/pending state on overflow, direct oversized input with no mutation, accepted retry at or below the boundary, legacy single-answer coverage.
- Import/export integration: use the real `BuzzerWinningResultsProvider` at least once, assert the atomic target-value + anchor batch, and cover repeat success, missing anchors, inserted blank/no-winner rows, moved/deleted rows or columns, repeat after a target-value-only edit, result-not-ready and lost responses. For an unconfirmed first write, verify matching intended values promotes PREPARED to CONFIRMED without a second batch; verify definitive non-application can retry only after marker revalidation and inconclusive evidence preserves PREPARED without writing.
- E2E: mixed import, rejection of a previously exported sheet for a new activity, partial and oversized draft recovery, atomic accepted submission, teacher and student projections including rejoin, and stable same-activity export.
- Regression gates: `npm run typecheck`, workspace Vitest, Playwright E2E, and `npm run build`. No tests were run during planning.
- Manual disposable-sheet benchmark: Feature 002 reference dimensions, no real classroom data, and no credentials in test output; import/export each meet the 10-second target.

**Implementation order for the next task generation**: Define the question and transport contracts before wiring the client and import preflight. Establish export target mapping, result provider vectors and the adapter read/write contract before integrating the export coordinator. Run the end-to-end checks against the integrated production path. Follow implementation with the constitution's convergence check.

## Risks and Bounded Assumptions

- **Concurrent Sheets edits**: Anchors establish identity at validation time. Sheets applies a batch atomically and provides no revision precondition for this read/write pair. Teachers should pause structural edits during export. The live validation fixture must demonstrate the supported change detection before implementation is accepted.
- **PlantUML runtime**: Java 8 and Graphviz are available; all five Feature 004 PNGs were regenerated from their paired `.puml` sources and the class/export diagrams were visually inspected. Re-render any diagram whose source changes.
- **Anchor visibility**: PROJECT metadata is searchable only from its creating Google Cloud project. Keep the configured service-account project stable across activity resets and backend restarts; changing to a different project requires revisiting the metadata visibility design before claiming the new-activity import guard is reliable.
- **Sheet metadata quota**: First export adds PROJECT developer metadata separate from cell content. The published metadata quota places a finite bound on these entries. Use short keys and one anchor per distinct dimension. Definite quota failure leaves the entire first batch unapplied.
- **Memory lifetime**: Re-export support lasts only for the current in-memory Activity. Process restart removes imported layout and results, consistent with the accepted scope.
- **Branch handoff**: Create `codex/004-question-groups` in an isolated checkout based on a revision containing Features 002 and 003, using the checked in 003 branch tip if no merged base contains both. Transfer the untracked `specs/004-question-groups/` and `diagrams/004-question-groups-*` files explicitly. Verify the constitution used for the build and keep unrelated local modifications out of the Feature 004 PR.

## Post-Design Constitution Check

| Principle / gate | Phase 1 evidence | Status |
|---|---|---|
| I. Input validation and actionable errors | Parser and submission contracts define exact invalid shapes and user-directed errors; export blocks before write on ambiguous targets. | PASS |
| II. Credentials and sensitive data | Backend-only credential path. Browser projections omit credentials, full source URLs and anchor IDs. | PASS |
| III. Normal and boundary tests | `quickstart.md` lists parser/domain/integration/E2E scenarios and commands. Planned only; implementation must run them and report actual results. | PASS (execution pending) |
| IV. Server-owned state and time | Activity stage, group, full-vector acceptance, received order, and winner remain server-owned. | PASS |
| V. Spec, diagrams, and implementation alignment | Five updated Feature 004 diagrams map to data model, contracts, source modules, and test scenarios. | PASS |
| VI. Independent branch and PR | Feature 004 is implemented in the isolated `codex/004-question-groups` worktree; PR review remains required before merge. | PASS (isolation); review pending |
| VII. PlantUML design priority | The five `.puml` sources define the implementation map. All five paired PNGs were regenerated from their current sources before implementation. | PASS |
| Local-only project scope | UI and backend stay on loopback; only backend-to-Sheets traffic is external. | PASS |
| Development workflow | Feature tasks were implemented and regression gates were run; run convergence and the manual Sheets benchmark before preparing a reviewable PR. | In progress |

**Post-design gate**: Specification, plan, contracts, source diagrams, and implementation are aligned. All five Feature 004 PNGs were regenerated from their paired `.puml` files in the isolated worktree. Full automated validation results and the remaining manual Sheets benchmark are recorded in [quickstart.md](./quickstart.md); PR review remains required before merge.

## Complexity Tracking

The design extends the existing workspaces and services. The added worksheet state is a compact set of dimension anchors, with the original coordinates and reconciliation state kept in the existing activity memory. The anchor mechanism handles shifted rows even when all relevant cell values were blank.
