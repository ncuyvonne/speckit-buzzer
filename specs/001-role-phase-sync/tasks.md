---
description: "Implementation task list for 001 角色與階段同步"
---

# Tasks: 001 角色與階段同步

**Input**: Design documents in `specs/001-role-phase-sync/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/realtime-websocket.md`, `quickstart.md`

**Tests**: Tests are included because the project constitution requires at least one normal and one boundary case for each feature. Within every user story, write its tests before implementing the behavior and verify that they fail for the expected reason.

**Organization**: Tasks are grouped by user story and ordered by dependency. Paths follow the npm-workspaces layout in `plan.md`.

## Phase 1: Setup

**Purpose**: Create the frontend/backend workspace skeleton and safe local configuration.

- [X] T001 Create the root npm workspaces manifest in `package.json`.
- [X] T002 [P] Scaffold the React + TypeScript + Vite application and its entry point in `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/src/main.tsx`, and `frontend/src/App.tsx`.
- [X] T003 [P] Initialize the Node.js + TypeScript backend package and strict compiler configuration in `backend/package.json` and `backend/tsconfig.json`.
- [X] T004 [P] Add `.env.example` with a placeholder-only `TEACHER_PASSWORD` and comma-separated example IDs such as `GROUP_IDS=1,2,3`, and ignore `.env` in `.gitignore`.

---

## Phase 2: Foundational

**Purpose**: Build configuration, protocol, and connection infrastructure required by all stories.

**Checkpoint**: Complete this phase before implementing any user story.

- [X] T005 Add root workspace `typecheck`, `test`, `test:e2e`, and `build` scripts in `package.json` and package-level `dev`, `typecheck`, `test`, and `build` scripts in `frontend/package.json` and `backend/package.json`; load the repository-root `.env` for backend `dev` with Node `--env-file=../.env` from `backend/`.
- [X] T006 [P] Write `backend/tests/unit/config.test.ts` cases for `Teacher login requires a configured, non-whitespace-only password whose JSON request with a 64-character requestId fits within 16 KiB. Compare nonblank passwords exactly and case-sensitively.` and `Loaded once at startup by splitting GROUP_IDS on commas and trimming each entry. Reject empty entries, duplicates after trimming, entries containing control characters, and IDs whose student.join request with a 64-character requestId exceeds 16 KiB. At least one ID is required. ID content is otherwise opaque.`; cover normal, empty, duplicate, control-character and over-limit values.
- [X] T007 Implement `backend/src/config.ts` using the exact `GROUP_IDS` rule, `Loaded once at startup by splitting GROUP_IDS on commas and trimming each entry. Reject empty entries, duplicates after trimming, entries containing control characters, and IDs whose student.join request with a 64-character requestId exceeds 16 KiB. At least one ID is required. ID content is otherwise opaque.`; with a valid roster, keep the server available when the password is absent, whitespace-only or over-limit and disable teacher login.
- [X] T008 Create the server-owned initial activity state in `backend/src/domain/activity-state.ts` enforcing `Server-owned; starts at PREPARING; only advances to the next allowed stage`; initialize `backend/src/domain/group-roster.ts` from the already validated startup configuration. Keep activity and stage in memory so a server restart creates a new activity at `PREPARING`.
- [X] T009 [P] Write normal and boundary JSON envelope, `requestId`, schema, malformed JSON, binary, unknown-type and error-code tests in `backend/tests/unit/protocol.test.ts`; test heartbeat scheduling, pong deadline, and timer cleanup with fake timers in `backend/tests/unit/heartbeat.test.ts`; in `backend/tests/integration/connection.test.ts`, test the 16 KiB boundary, close code `1009`, allowed/denied/missing Origin upgrades, initial `activity.snapshot`, and that a stale connection closes without affecting a responsive peer.
- [X] T010 [P] Define JSON UTF-8 text schemas and actionable error codes in `backend/src/realtime/protocol.ts`; enforce a 16 KiB complete-message limit, required request IDs of 1–64 ASCII letters, digits, hyphens or underscores on requests, and no payload logging. Over-limit input closes with `1009` without an in-band JSON error.
- [X] T011 [P] Define the matching browser-side WebSocket message types in `frontend/src/realtime/messages.ts`.
- [X] T012 Bind HTTP/WebSocket to `127.0.0.1`, allow only `http://127.0.0.1:5173`, and reject missing or disallowed Origin with HTTP 403 before upgrade in `backend/src/server.ts`; configure the strict-port local `/ws` Vite proxy in `frontend/vite.config.ts` without rewriting Origin, and send an initial stage-and-groups `activity.snapshot`. Implement server ping every 30 seconds and terminate a socket that does not pong within 10 seconds in `backend/src/realtime/heartbeat.ts`; stop its interval and pending deadlines on socket close or server shutdown, without affecting other sockets.
- [X] T013 Build the page-origin-relative `/ws` client with lifecycle, bounded reconnect backoff, per-connection role reset and snapshot state in `frontend/src/realtime/client.ts` and `frontend/src/state/activity.ts`; show an actionable message and reconnect option when code `1009` closes the socket in `frontend/src/App.tsx`.
- [X] T014 Configure Vitest and Playwright. Add isolated server support in `backend/tests/support/test-server.ts` and `frontend/tests/e2e/fixtures.ts` so each E2E case owns a fresh `PREPARING` backend on port 3001, injects test-only environment values without loading repository `.env`, and closes sockets, heartbeat timers and the server during teardown. Configure `frontend/playwright.config.ts` with one worker and a Vite-only `webServer` on strict port 5173; configure runners in `backend/vitest.config.ts` and `frontend/vitest.config.ts`.

---

## Phase 3: User Story 1 - 老師登入並推進活動階段 (Priority: P1) 🎯

**Goal**: A teacher can authenticate, advance the activity through the allowed stages, and see errors for invalid credentials or transitions.

**Independent Test**: With a fresh backend, authenticate using a configured password, advance through all three stages and verify the teacher display follows the server broadcast. Verify invalid credentials and missing configuration grant no role, and every new teacher connection requires reauthentication.

### Tests for User Story 1

- [X] T015 [P] [US1] Write credential tests in `backend/tests/unit/teacher-auth.test.ts` for correct, incorrect, empty, whitespace-only, unconfigured and over-limit passwords; assert `Teacher login requires a configured, non-whitespace-only password whose JSON request with a 64-character requestId fits within 16 KiB. Compare nonblank passwords exactly and case-sensitively.` and ensure no credential is disclosed.
- [X] T016 [P] [US1] Write transition tests for `PREPARING → BUZZING → ENDED` using `Server-owned; starts at PREPARING; only advances to the next allowed stage` in `backend/tests/unit/activity-state.test.ts`; test `backend/tests/integration/realtime-handler.test.ts` for unauthenticated `activity.advance` returning `AUTH_REQUIRED`, an authenticated teacher repeating `teacher.authenticate` returning `INVALID_MESSAGE`, and authenticated teacher requests with a stale `from` value, skipped stage, or backward transition returning `STAGE_CONFLICT`. Verify rejected requests leave the role and phase unchanged and produce no phase broadcast.
- [X] T017 [P] [US1] Write Playwright tests in `frontend/tests/e2e/teacher-phase.spec.ts` using the isolated backend fixture for valid/invalid login, missing-password configuration denying login with an actionable hint, post-login snapshot, teacher phase broadcast within 2 seconds, and unauthenticated phase-control rejection. Cover both reconnect and reload in `ENDED` and in an earlier stage. Verify each requires a new password entry and displays the current server stage after successful authentication.

### Implementation for User Story 1

- [X] T018 [P] [US1] Implement teacher authentication in `backend/src/domain/teacher-auth.ts` with the exact `Teacher login requires a configured, non-whitespace-only password whose JSON request with a 64-character requestId fits within 16 KiB. Compare nonblank passwords exactly and case-sensitively.` rule; bind authorization only to the current connection, and never log or persist the submitted password.
- [X] T019 [P] [US1] Implement only `PREPARING → BUZZING → ENDED` in `backend/src/domain/activity-state.ts`, enforcing `Server-owned; starts at PREPARING; only advances to the next allowed stage` and rejecting stale, skipped, or backward transitions.
- [X] T020 [US1] Handle `teacher.authenticate` and `activity.advance` in `backend/src/realtime/handler.ts`; enforce `role` as `TEACHER | STUDENT | UNAUTHENTICATED` with `New connection starts unauthenticated`, authorize before mutating state, reject phase advances by non-teachers and authentication attempts from any already-authenticated connection, send `teacher.authenticated` then the latest `activity.snapshot` after login, and broadcast `activity.phaseChanged` to every open connection only after a valid transition. Rejected requests leave state unchanged and emit no phase broadcast; closing a socket clears only that connection's role.
- [X] T021 [P] [US1] Build teacher login, actionable auth errors, current-stage display, and next-stage control in `frontend/src/components/TeacherPanel.tsx` and `frontend/src/App.tsx`; clear the password input after authentication and never save teacher credentials in browser storage.
- [X] T022 [US1] Connect `teacher.authenticate`, `teacher.authenticated`, `activity.snapshot`, `activity.advance`, `activity.phaseChanged` and actionable errors to the teacher view in `frontend/src/realtime/client.ts`; clear teacher controls for each new socket and restore them only after reauthentication.
- [X] T023 [US1] Run the US1 Vitest and Playwright cases and record commands, results, and any fixes in `specs/001-role-phase-sync/validation-results.md`.

**Checkpoint**: Teacher authentication and stage control work independently; every new teacher connection requires password verification.

---

## Phase 4: User Story 2 - 學生選擇組別並同步看到活動階段 (Priority: P1)

**Goal**: Students can join valid groups, multiple students can share a group, and all connected views show the server's current stage.

**Independent Test**: With a fresh backend, connect a teacher and students in two groups plus a second student in one group. Verify valid/invalid joins, student role isolation, independent same-group connections and server phase broadcasts reaching all views within 2 seconds.

### Tests for User Story 2

- [X] T024 [P] [US2] Write configured-ID validation cases in `backend/tests/unit/group-roster.test.ts` for `Canonical trimmed, non-empty, opaque string without control characters; unique after trimming; supplied through GROUP_IDS`; in `backend/tests/integration/realtime-handler.test.ts`, use a genuinely joined student connection to verify `teacher.authenticate` returns `INVALID_MESSAGE` and `activity.advance` returns `AUTH_REQUIRED`, and verify a teacher connection's `student.join` returns `INVALID_MESSAGE`. Rejected requests leave roles, bindings and stage unchanged and emit no phase broadcast; also verify simultaneous student connections can bind to the same group independently.
- [X] T025 [P] [US2] Write isolated Playwright tests in `frontend/tests/e2e/student-group-sync.spec.ts` for valid/invalid groups, simultaneous students in same and different groups, student role rejection, teacher/student broadcasts and the 2-second update target; with teacher password configuration absent and a valid roster, verify students can still join while teacher login remains unavailable.

### Implementation for User Story 2

- [X] T026 [P] [US2] Handle `student.join` in `backend/src/realtime/handler.ts`; reject requests from `TEACHER` connections with `INVALID_MESSAGE`, require `groupId` to be `Required for a joined student; must match a configured group`, validate using `Canonical trimmed, non-empty, opaque string without control characters; unique after trimming; supplied through GROUP_IDS` in `backend/src/domain/group-roster.ts`, bind the accepted group and `STUDENT` role only to that connection, then send `student.joined` followed by the latest `activity.snapshot`. Clear only that socket's group binding on close and preserve other members of the same group.
- [X] T027 [P] [US2] Build the student group picker and current-stage view with clear validation errors in `frontend/src/components/StudentJoin.tsx` and `frontend/src/App.tsx`.
- [X] T028 [US2] Connect `student.join`, `student.joined`, `activity.snapshot` and `activity.phaseChanged` to the student view in `frontend/src/realtime/client.ts`; render the stage from the latest server-provided event.
- [X] T029 [US2] Run the US2 Vitest and Playwright cases and record commands, results, and any fixes in `specs/001-role-phase-sync/validation-results.md`.

**Checkpoint**: Teacher and student views use the same server phase; valid groups support multiple simultaneous student connections.

---

## Phase 5: User Story 3 - 學生重新整理或重新連線後恢復活動狀態 (Priority: P2)

**Goal**: A student tab restores its selected group after reload/reconnect and then displays a fresh server snapshot.

**Independent Test**: For each of the three activity stages, reload and reconnect a student tab; verify its group is restored and its stage matches the current server state. With two students in one group, disconnect one, advance the stage, and verify the returning tab rejoins while its peer stays joined. Verify missing/invalid stored groups return to group selection.

### Tests for User Story 3

- [X] T030 [P] [US3] Write isolated Playwright tests in `frontend/tests/e2e/student-reconnect.spec.ts` for `groupId` being `Saved in sessionStorage; revalidated by the server after each connection`; verify the saved selection belongs to that same browser tab, there is no age-based expiry while the same activity remains running, and restore after reload/reconnect in all three stages, including `ENDED`; reject and clear missing/invalid selections, and confirm a same-group peer stays joined.

### Implementation for User Story 3

- [X] T031 [P] [US3] Implement `StudentSelection.groupId` in `frontend/src/state/student-selection.ts` as `Saved in sessionStorage; revalidated by the server after each connection`; missing or server-rejected values clear the saved group and return that tab to selection.
- [X] T032 [P] [US3] In `frontend/src/realtime/client.ts`, wait for the connection `activity.snapshot` before resending the saved group; after `student.joined`, apply the fresh post-join `activity.snapshot` and clear the saved group on `GROUP_INVALID`.
- [X] T033 [P] [US3] Render restored, missing and rejected group-selection states in `frontend/src/components/StudentJoin.tsx` and `frontend/src/App.tsx`; show the stage from the latest server `activity.snapshot` after the server revalidates `StudentSelection.groupId`.
- [X] T034 [US3] Run the US3 Playwright cases and record commands, results, and any fixes in `specs/001-role-phase-sync/validation-results.md`.

**Checkpoint**: Student state recovers in the same tab; teacher credentials are never restored from browser storage.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the complete feature against the specification, diagrams, and constitution.

- [X] T035 [P] Align local setup commands and the acceptance walkthrough with the implemented scripts in `specs/001-role-phase-sync/quickstart.md`.
- [X] T036 [P] Compare implemented components, data relationships, messages, stage changes, denied-Origin behavior and reconnect flows with `diagrams/001-role-phase-sync-component.puml`, `diagrams/001-role-phase-sync-class.puml`, `diagrams/001-role-phase-sync-sequence.puml`, `diagrams/001-role-phase-sync-sequence-recovery.puml` and `specs/001-role-phase-sync/contracts/realtime-websocket.md`; regenerate the four matching PNGs and record the comparison in `specs/001-role-phase-sync/validation-results.md`.
- [X] T037 Run `npm run typecheck --workspaces`, `npm run test --workspaces`, `npm run test:e2e`, and `npm run build --workspaces`; record exact commands and actual results in `specs/001-role-phase-sync/validation-results.md`.
- [X] T038 Review `specs/001-role-phase-sync/spec.md`, `specs/001-role-phase-sync/contracts/realtime-websocket.md`, `.env.example` and `.gitignore` against completed behavior; verify password-disabled login, teacher reauthentication on each connection, documented error behavior and no credential disclosure; open the branch Pull Request with actual test results and address review before merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002–T004 can proceed in parallel after T001.
- **Foundational (Phase 2)**: Starts after setup. Tests T006 and T009 precede configuration and protocol implementation. Complete server, Vite proxy, browser client and isolated backend fixture before story tests.
- **User Story 1 (Phase 3)**: Starts after Phase 2; teacher authorization and phase control are the first vertical slice.
- **User Story 2 (Phase 4)**: Starts after US1 because its end-to-end sync journey uses the teacher's phase transitions.
- **User Story 3 (Phase 5)**: Starts after US2 because it restores the group selected by the student join flow.
- **Polish (Phase 6)**: Starts after all three stories pass their targeted checks.

### User Story Dependency Graph

```text
Setup → Foundational → US1 (P1) → US2 (P1) → US3 (P2) → Polish
```

US2 and US3 have real flow dependencies: US2 needs teacher-controlled phase changes to verify
synchronization; US3 needs the group selection established by US2. Their unit tests can still be
written independently once foundational types and test runners exist.

### Parallel Opportunities

- After T001, setup tasks T002, T003, and T004 touch separate files and can run in parallel.
- In Phase 2, T006 and T009 test authoring can run in parallel. After T009, backend protocol T010
  and browser message types T011 touch separate files. T014 defines the E2E fixture before story tests.
- In US1, tests T015–T017 can be authored in parallel. After they are written, T018, T019 and T021
  touch separate files and can proceed in parallel; T020 and T022 integrate them.
- In US2, T024 and T025 can run in parallel. After tests, T026 and T027 can run in parallel; T028
  connects the student view to the established broadcast.
- In US3, author T030 first; T031 then enables T032 network recovery and T033 selection UI on separate files in parallel; run T034 after both.
- In Polish, T035 and T036 can be performed in parallel after story completion; T037 and T038
  follow the final changes.

## Parallel Examples

### User Story 1

```text
Parallel test authoring: T015 backend teacher-auth unit tests; T016 backend activity-state tests; T017 frontend teacher-flow E2E tests.
Parallel implementation after tests: T018 backend/src/domain/teacher-auth.ts; T019 backend/src/domain/activity-state.ts; T021 frontend/src/components/TeacherPanel.tsx.
```

### User Story 2

```text
Parallel test authoring: T024 backend group-roster tests; T025 frontend student-group-sync E2E tests.
Parallel implementation after tests: T026 backend group binding and `student.joined`/snapshot responses; T027 frontend/src/components/StudentJoin.tsx. The `activity.phaseChanged` broadcast is implemented by T020 and consumed by T028.
```

### User Story 3

```text
After T030 is written: complete T031, then T032 frontend/src/realtime/client.ts and T033 frontend/src/components/StudentJoin.tsx can proceed in parallel.
```

## Implementation Strategy

### MVP First

Implement and validate US1 as the first teacher-control vertical slice. The minimum useful classroom
MVP includes both P1 stories, US1 + US2, because students must join and observe teacher-driven
phase changes. Add US3 next for refresh/reconnect recovery.

### Incremental Delivery

1. Complete setup and foundational infrastructure.
2. Complete US1 and validate correct/incorrect login, phase progression, and reauthentication.
3. Add US2 and validate group selection, simultaneous same-group students, and phase sync.
4. Add US3 and validate student state recovery after reload/reconnect.
5. Complete the cross-cutting checks and PR review.

## Notes

- Every task starts with a checkbox and sequential ID; user-story tasks include their `[USn]` label.
- `[P]` means the task can run in parallel without editing the same file or waiting on an unfinished dependency.
- Tests are listed before each story's implementation; verify the expected failure before implementing the behavior.
- After each user story, run its targeted checks before beginning the next story phase.
- Final test results must report actual commands and outcomes; do not mark unrun checks as passing.
