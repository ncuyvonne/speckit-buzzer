# Quickstart: 001 角色與階段同步

This guide describes the implemented local setup and validation flow for feature 001.

## Prerequisites

- Node.js 24.x LTS and npm
- A browser supported by Playwright for automated end-to-end tests
- No external credentials or services are needed for feature 001

## Configure and run locally

1. Copy `.env.example` to `.env` and set a local teacher password and group roster. Do not commit
   `.env` or paste the password into logs or documentation.

   ```powershell
   Copy-Item .env.example .env
   ```

2. Install the workspace dependencies from the repository root:

   ```powershell
   npm install
   ```

   The backend development command loads the root `.env` file so `TEACHER_PASSWORD` and `GROUP_IDS`
   are available when npm starts the backend workspace.

3. Start the backend in one terminal:

   ```powershell
   npm run dev --workspace backend
   ```

4. Start the Vite frontend in another terminal:

   ```powershell
   npm run dev --workspace frontend
   ```

5. Open `http://127.0.0.1:5173`. Open separate tabs or browser contexts for the teacher and
   student groups. Use the teacher password from `.env`; students choose a configured group.

Expected: all connected screens show「準備中」. The teacher can advance to「搶答中」and
「已結束」; all open views display each accepted phase within 2 seconds.

## Run checks

From the repository root, run the workspace checks:

```powershell
npm run typecheck --workspaces
npm run test --workspaces
npm run test:e2e
npm run build --workspaces
```

Stop manually started servers before running `npm run test:e2e` so the test runner can own
ports 5173 and 3001. Each end-to-end case starts with a fresh backend in `PREPARING`.

If Playwright reports that its browser is not installed, install the project-selected browser once:

```powershell
npx playwright install chromium
```

## Acceptance walkthrough

Treat each scenario as a separate run. Restart the backend before a scenario that advances the
phase so it starts at `PREPARING`. Keep the backend running during a reload or reconnect scenario.

1. Confirm the correct teacher password grants teacher controls; an incorrect or empty password is
   rejected with an actionable message that does not reveal the password.
2. Open two student contexts and join different valid groups. Open another student context in one
   of those same groups; all connections remain independent.
3. Advance each stage and confirm every open teacher/student view updates within 2 seconds.
4. Attempt an invalid group, an unauthenticated teacher action, and a skipped/backward phase change;
   each is rejected and the server phase remains unchanged.
5. While the same backend activity remains running, in each of the three stages (including
   `ENDED`) reload and reconnect the same student tab, including after a long disconnect. Confirm
   it restores its group and displays the current phase. The restore promise has no elapsed-time
   cutoff within that activity; restarting the backend starts a new activity at `PREPARING`.
6. Disconnect and reconnect the teacher, then separately reload the teacher page; confirm both
   flows require the teacher password again before controls return. After login, confirm the
   current server phase is displayed.
7. Open two students in the same group, disconnect one, advance the phase, then reconnect it;
   confirm the returning student sees the current phase and group while the connected peer stays joined.
8. Start a separate local run with a valid roster and no teacher password. Verify that student
   joins succeed and teacher login displays a configuration hint without granting controls.
9. In the WebSocket integration checks, verify that a denied Origin receives HTTP 403; a joined
   student's `teacher.authenticate` and a teacher's `student.join` receive `INVALID_MESSAGE`; and
   both a joined student and unauthenticated socket receive `AUTH_REQUIRED` when attempting to
   advance. Rejected operations leave roles, bindings and phase unchanged and emit no phase
   broadcast. Also verify that a message over 16 KiB closes with code `1009`, and a heartbeat timeout
   closes only the stale socket while a responsive peer remains connected.
