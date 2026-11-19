# Research: 004 題組與多填空

## Decisions

### R1. 沿用單程序記憶體活動狀態

**Decision**: Extend the existing `ActivityState` and `BuzzerResultsService` in memory. Do not add SQLite for this feature.

**Rationale**: The current application owns one classroom activity per backend process. Features 001–003 already keep activity stage, imported questions, submissions, and winners in memory. Feature 004 does not require restoring an activity after process restart, so an additional persistence layer would introduce schema, transaction, and recovery behavior without serving a stated requirement.

**Alternatives considered**:

- SQLite: rejected for this feature because durable activity recovery is out of scope and no multi-process service is planned.
- A second activity/result store: rejected because it would create competing sources of truth for question definitions, stage, and winners.

**Evidence**: `backend/src/domain/activity-state.ts`, `backend/src/domain/buzzer-results.ts`, and `backend/src/server.ts` establish the existing process-local composition. Feature 004's assumptions explicitly leave restart recovery out of scope.

### R2. Extend the existing server-side feature boundaries

**Decision**: Extend `guided-notes/types.ts`, `worksheet-parser.ts`, `GuidedNotesService`, `ActivityState`, `BuzzerResultsService`, `RealtimeHub`, and the existing frontend state/components. Do not add a parallel `GroupAnswerService` or a new frontend state framework.

**Rationale**: The existing WebSocket handler already derives teacher/student role and group identity, checks activity stage, broadcasts own-group progress, and injects fake Google Sheets/results providers in tests. Extending these boundaries keeps authorization, timestamp ordering, and result visibility in the current server-owned flow.

**Alternatives considered**:

- A new isolated service for group answers: rejected because it would duplicate the existing answer lock, winner, and projection logic.
- Client-side winner/rank selection: rejected because Feature 003 and the project constitution require server-authoritative ordering.

### R3. Parse displayed worksheet values and write all targets as one literal-value batch

**Decision**: Import the selected sheet using displayed values for dynamic `題號` and `作答` discovery and full-width marker parsing. For export, use one `spreadsheets.batchUpdate` containing value-only `UpdateCellsRequest` operations. Write literal `stringValue` entries and clear the `userEnteredValue` field for no-winner slots. Include anchor creation in the first batch.

**Rationale**: Displayed values preserve the worksheet notation. The spreadsheet batch combines all writes and first-export anchor creation atomically. Use a field mask of `userEnteredValue` and exact target ranges. This uses the same literal text semantics as RAW and preserves non-target cells. Atomicity applies to operations inside the batch, while the earlier worksheet read remains separate.

**Alternatives considered**:

- Fixed cell/column offsets: rejected because Feature 002 requires dynamic header discovery and Feature 004 permits mixed worksheet layouts.
- Per-cell writes: rejected because a failed write could leave only part of a question group populated.
- Separate `values.batchUpdate` and anchor write: either operation could commit alone if the other fails.
- Formula-aware input: even text beginning with `=` belongs in the cell as a literal string.

**References**: [Read and write cell values](https://developers.google.com/workspace/sheets/api/guides/values), [Spreadsheet batch atomicity](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate), [UpdateCellsRequest and field clearing](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request#UpdateCellsRequest), [CellData fields](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells).

### R4. Verify original answer targets for same-activity export

**Decision**: First export locates the live markers and creates PROJECT developer metadata with the stable key `sb004` for the applicable rows and columns in the same atomic batch. Keep a manifest of exact coordinates and per-dimension metadata IDs in the Activity. Require the original coordinates, matched anchors, and live header/question structure before repeat export. Confirmed target-cell values do not determine identity and may be overwritten on repeat. Before importing a worksheet for a new activity, call `spreadsheets.developerMetadata.search` for `metadataKey=sb004` and `visibility=PROJECT`, then match ROW/COLUMN locations to the selected numeric `sheetId`; reject a match. This remains detectable after the in-memory manifest is cleared. For a PREPARED first write only, use anchor, mapping, prewrite and intended-value read-back to resolve its outcome.

**Rationale**: Google documents that developer metadata follows dimensions as rows or columns move and is removed when its location is deleted. Checking that all IDs remain at the recorded coordinates gives evidence that a visually identical blank row was not substituted for a verified answer row. The stable `sb004` key also lets a later import detect an exported worksheet after the in-memory Activity and manifest have been reset. The backend uses `spreadsheets.developerMetadata.search` with PROJECT visibility and filters results to the selected sheet's ROW/COLUMN locations. PROJECT metadata is visible only to its creating Google Cloud project, so the local app keeps its configured service-account project stable across activity resets and restarts. Anchors are worksheet metadata separate from the cells. A target-value-only edit after confirmation changes cell contents, not the verified row/column identity; repeating the activity export overwrites that target with the current result. Raw values are needed to reconcile a first write whose response is uncertain, because the system must determine whether its intended batch was applied. Use short keys because Google counts key and value characters against the sheet allocation. No anchor stores an answer, group ID or credential.

**Alternatives considered**:

- Rebuild from offsets or cell values alone: inserting an empty row among cleared slots can produce the same apparent structure.
- Follow moved anchors: the accepted rule permits only the original coordinates.
- Reject every Drive revision change: this would require a separate Drive API scope and reject unrelated workbook edits.

**Validation boundary**: Check structural edits already reflected in the prewrite read. Sheets describes atomic batches and collaborative edits separately, with no revision precondition on the batch. Keep the worksheet stable during the operation and verify the anchor approach against an isolated live sheet before acceptance.

**References**: [Developer metadata location and movement](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.developerMetadata), [Metadata visibility and storage](https://developers.google.com/workspace/sheets/api/guides/metadata), [GridData dimension metadata](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets#GridData), [Scoped spreadsheet read](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [Atomic writes and collaboration](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

### R5. Use the existing internal WebSocket and test tooling

**Decision**: Keep the existing JSON-over-WebSocket envelope and 16 KiB message-size guard. Add a grouped-answer request shape and extend teacher/student projections. Use Vitest for parser/domain/service tests and Playwright for browser flows through the existing fake-adapter fixtures.

**Rationale**: The repository already has backend Node-based Vitest tests, injectable Sheets/results providers, an isolated test server, and sequential Playwright E2E setup. The frontend Vitest environment is Node-only and does not install a DOM simulator, so UI assertions belong in Playwright unless a later design shows a need for a new dependency.

**Alternatives considered**:

- New public HTTP API or WebSocket server: rejected because the local app already uses a shared WebSocket contract for stage and answer events.
- Live Google credentials in automated tests: rejected; deterministic fake Sheets/results providers cover protocol, mapping, and failure cases without credentials.

**References**: [Vitest test environments and features](https://vitest.dev/guide/features), [Vitest mocking](https://vitest.dev/guide/mocking), [Playwright fixtures](https://playwright.dev/docs/test-fixtures), [Playwright assertions](https://playwright.dev/docs/test-assertions), [Playwright web server](https://playwright.dev/docs/test-webserver).

### R6. Size the actual encoded submission

**Decision**: Keep the 16,384-byte transport ceiling and import groups of 2–20 slots. The browser group path always uses a 36-byte safe ASCII ID. The backend import preflight uses the same compact JSON envelope and a representative ID of the same length, with one `a` per slot and the actual displayed question ID. The browser measures the actual JSON it sends with `TextEncoder`. The backend uses UTF-8 byte counts and retains the transport and decoder checks.

**Rationale**: Browser character counts omit JSON escapes, the envelope and extra UTF-8 bytes. Measuring an envelope with the same ID width avoids rejecting a valid exact-limit group or accepting a group whose minimum valid answer cannot fit. The browser can keep the draft and display a hint without initiating a transport failure. Reserve the transport disconnect behavior for direct oversized messages that bypass the browser checks.

**Alternatives considered**:

- Size answers alone or use JavaScript string length: neither measures the complete encoded request.
- Raise the limit globally or transmit partial answers: the prior limits and one-operation semantics are part of the accepted design.

**Evidence**: `backend/src/config.ts`, `backend/src/server.ts`, `backend/src/realtime/protocol.ts`, and `frontend/src/realtime/client.ts` already define the inbound boundary, request IDs and compact request serialization.

## Resolved planning inputs

- Frontend: TypeScript, React, Vite.
- Backend: Node.js and the existing `ws` WebSocket server.
- Sheets integration: existing Google Sheets API adapter and backend-only environment credentials.
- Storage: in-memory activity state; SQLite is not selected.
- Validation: existing Vitest and Playwright packages and test fixtures.
- Blueprints: the five Feature 004 diagrams in `diagrams/` are the design authority; plan sections below map each one to the proposed components and flows.

No unresolved `NEEDS CLARIFICATION` item remains from the feature specification.
