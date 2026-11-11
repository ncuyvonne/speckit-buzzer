# Research: 001 角色與階段同步

**Date**: 2026-11-10
**Status**: Decisions resolved for this feature

## Decisions

### 1. Frontend: React + TypeScript + Vite SPA

- **Decision**: Use Vite's `react-ts` starting template. Keep separate teacher and student views,
  one typed WebSocket client, and a small activity-state model. Do not add a router or global state
  library for this feature.
- **Rationale**: This matches project instruction list section 4 and the small set of screens and
  flows in the component and sequence diagrams. React documents starting from scratch with Vite
  when the application constraints favor a custom setup.
- **Alternatives considered**: A full-stack React framework would add server and routing
  conventions that do not replace the required Node.js WebSocket authority. A larger client state
  library is not needed for one shared phase and one selected group.
- **Sources**: [React: Build an app from Scratch](https://react.dev/learn/build-a-react-app-from-scratch),
  [Vite Guide](https://vite.dev/guide/)

### 2. Runtime: Node.js 24 LTS and TypeScript strict mode

- **Decision**: Target the latest Node.js 24.x LTS patch and TypeScript 5.x with `strict` enabled.
  Run `tsc --noEmit` separately from the Vite build.
- **Rationale**: Node 24 is an LTS line with a mature compatibility window. TypeScript's strict
  mode catches unsafe values at compile time. Vite transforms TypeScript but does not type-check
  it, so an explicit type-check command is required.
- **Alternatives considered**: Node 26 is also LTS, but it entered LTS recently; Node 24 gives
  dependencies a longer-established compatibility baseline. Relying on Vite alone would leave
  type errors unchecked.
- **Sources**: [Node.js Releases](https://nodejs.org/en/about/previous-releases),
  [Vite Features](https://vite.dev/guide/features),
  [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict),
  [TypeScript noEmit](https://www.typescriptlang.org/tsconfig/noEmit)

### 3. Realtime server: Node HTTP server with `ws`

- **Decision**: Attach a `ws` `WebSocketServer` to the local Node HTTP server. Check request
  `Origin` before accepting an upgrade. Use `http://127.0.0.1:5173` as the single local page
  origin with Vite `strictPort`. The browser uses its page host and port for `/ws`. Vite forwards
  the upgrade to `127.0.0.1:3001` and preserves the original `Origin`. Limit incoming messages to
  16 KiB using `ws maxPayload` and surface close code 1009 as a client error.
- **Rationale**: The server must own the current phase, validate role and transition rules, and
  broadcast canonical state to every connected client. The official `ws` documentation covers
  attaching to an existing HTTP server and broadcasting. Vite's documentation warns that its
  proxy does not check WebSocket origins, so the backend must check them.
- **Alternatives considered**: Direct cross-origin WebSocket connections would need more browser
  configuration. Rewriting Origin at the proxy would weaken the backend's origin check.
  A JSON error for oversized messages would require accepting data beyond the transport limit.
- **Sources**: [`ws` README](https://github.com/websockets/ws/blob/master/README.md),
  [`ws` API](https://github.com/websockets/ws/blob/master/doc/ws.md),
  [Vite server options](https://vite.dev/config/server-options)

### 4. Teacher authentication: per-connection, password each time

- **Decision**: Every WebSocket connection begins unauthenticated. The teacher submits the
  `TEACHER_PASSWORD` value for that connection; the server records the teacher role only on that
  live connection. A disconnect or page refresh clears that authorization, so the next connection
  requires the password again. A missing or unusable password leaves the teacher login unavailable
  with `AUTH_INVALID` while student joins remain available for a valid roster. Teacher authorization
  stays on the live socket without a resume token, cookie or persistent session key.
- **Rationale**: This directly implements the final clarified specification and avoids a token
  that would conflict with the constitution's environment-variable rule. The configured password
  is read from `process.env`, is never echoed, and is excluded from application logs.
- **Alternatives considered**: A 60-second resume ticket would preserve the prior behavior but
  requires a client-held token outside environment variables; the user chose to remove that
  behavior. Failing the whole server on a missing teacher password would prevent the login screen
  from returning the FR-002 error and would also stop otherwise valid student joins.
- **Sources**: [Node.js Environment Variables](https://nodejs.org/api/environment_variables.html),
  [`ws` client authentication guidance](https://github.com/websockets/ws/blob/master/README.md#client-authentication)

### 5. Activity and group data: in-memory server state

- **Decision**: Keep the single activity's phase, configured group roster, and live connection
  contexts in server memory. Parse comma-separated group IDs from non-secret `GROUP_IDS`, trim each
  entry, and reject empty, duplicate-after-trimming, or control-character entries during startup.
  Reset the activity to「準備中」when the Node process starts.
- **Rationale**: The specification requires recovery after browser refresh or network reconnect,
  not recovery after a server process restart. A single in-memory state makes the server authority
  explicit without a database layer.
- **Alternatives considered**: SQLite would add schema, file lifecycle, and persistence behavior
  with no stated restart-recovery requirement. SQLite's `:memory:` mode itself is connection-local
  and disappears when its connection closes.
- **Tradeoff**: Restarting the server ends the current in-memory activity and returns it to
 「準備中」; process restart recovery is outside this feature's current scope.
- **Sources**: [SQLite In-Memory Databases](https://www.sqlite.org/inmemorydb.html)

### 6. Student group restoration: tab-scoped browser storage

- **Decision**: Store only the selected student `groupId` in `sessionStorage`. On each new WebSocket
  connection, the server immediately pushes an `activity.snapshot`. The student client then sends
  the saved group to the server, which validates it against the current roster and returns the join
  result with a fresh snapshot. Restore the selection in the same tab and running activity
  without a timer, in all three stages. Clear a rejected saved group before showing the picker.
- **Rationale**: `sessionStorage` survives reloads in the same tab and is isolated per tab, fitting
  the requirement that each student browser retains its group while allowing several students in
  the same group.
- **Alternatives considered**: `localStorage` would retain the group after the tab/browser is
  closed, which is not required. No student account system is needed for per-tab group identity.
- **Source**: [MDN: `sessionStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)

### 7. Testing: Vitest for logic, Playwright for end-to-end flows

- **Decision**: Use Vitest for stage-transition, validation, authentication, and group-state tests;
  use real loopback WebSocket clients in Vitest to test the role guard. Use Playwright with
  separate browser contexts for role and sync flows and a fresh backend instance for each test.
  Start Vite once through `webServer`, with one Playwright worker for the fixed proxy port.
  A test-scoped fixture owns the backend startup and teardown. Type checking remains separate.
- **Rationale**: Vitest runs TypeScript tests in the Vite ecosystem and its Node environment fits
  backend logic. Fresh browser contexts isolate tab storage. A fresh backend is also needed
  because the stage only advances and is shared by all sockets on a server instance.
- **Acceptance coverage**: valid and invalid teacher password, phase order and unauthorized
  transition, synchronization within 2 seconds, two students in one group, student reload/reconnect,
  teacher reauthentication after reconnect and reload.
- **Alternatives considered**: Testing only mocked WebSocket messages would not prove that real
  clients receive the server broadcast; keep at least one complete Playwright flow on the real
  local server.
- **Sources**: [Vitest: Writing Tests](https://vitest.dev/guide/learn/writing-tests),
  [Vitest Environments](https://vitest.dev/guide/environment.html),
  [Playwright webServer](https://playwright.dev/docs/test-webserver),
  [Playwright fixtures](https://playwright.dev/docs/test-fixtures),
  [Playwright WebSocketRoute](https://playwright.dev/docs/api/class-websocketroute)

### 8. Google Sheets API is not used in feature 001

- **Decision**: Do not add Sheets API dependencies or credentials to this feature. Keep Sheets
  integration for feature 002, where the project instruction list defines it.
- **Rationale**: Feature 001 has no sheet import/export behavior. Adding the integration here would
  expand scope and expose credentials without serving the role or phase flows.
- **Source**: Project instruction list section 2, feature 002; the integration remains governed by
  section 4 when that feature is planned.
