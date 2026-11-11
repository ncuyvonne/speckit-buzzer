# Realtime WebSocket Contract: 001 角色與階段同步

## Connection

- The browser opens `http://127.0.0.1:5173` and connects to `/ws` on that same host and port.
  Vite uses a fixed port (`strictPort`) and forwards the upgrade to `ws://127.0.0.1:3001/ws`
  with WebSocket proxying enabled and `rewriteWsOrigin` disabled.
- The backend binds to `127.0.0.1`. Its local browser Origin allowlist contains
  `http://127.0.0.1:5173`. A missing Origin is rejected by the same check.
- The server rejects an unapproved origin during the HTTP upgrade with status 403, before a
  WebSocket connection exists; it does not attempt to return an in-band JSON error for this case.
- Every new WebSocket connection starts with role `UNAUTHENTICATED`.
- The server sends an `activity.snapshot` immediately after the connection opens. A student must join a valid
  group before the student view is considered joined. A teacher must authenticate before receiving
  teacher controls.
- Client messages must be UTF-8 JSON text. The server limits each complete incoming message to
  16 KiB (16,384 bytes), including the envelope and any fragments after reassembly. Messages
  beyond the limit close the connection with WebSocket code `1009`. The UI explains that the
  message is too long and allows reconnecting. The server sends no JSON error for this close.
- For messages delivered to the application, binary data, malformed JSON, unknown types and
  invalid field shapes return `INVALID_MESSAGE`. Rejected requests never change shared state.
  Errors and logs omit credentials and raw request payloads.

## Message Envelope

Client requests:

```json
{
  "type": "message.name",
  "requestId": "client-generated-request-id",
  "payload": {}
}
```

`requestId` is required on requests and contains 1–64 ASCII letters, digits, hyphens or
underscores. Request-specific acknowledgements and errors echo a valid `requestId` when available.
An error for a request whose ID cannot be parsed or validated omits it. Snapshots and phase
broadcasts are unsolicited events and omit `requestId`.

## Client-to-Server Messages

### `teacher.authenticate`

```json
{
  "type": "teacher.authenticate",
  "requestId": "r1",
  "payload": { "password": "<entered by teacher>" }
}
```

- Valid only on an unauthenticated connection.
- Requests from an already authenticated teacher or a student connection return `INVALID_MESSAGE`
  without changing that connection's role.
- The server compares the value with `TEACHER_PASSWORD`, then discards the received value.
- An incorrect or blank password, or unavailable password configuration, returns `AUTH_INVALID`
  with a fixed message advising the user to check the entered password and local configuration.
  The server can still accept student joins when the roster is valid.
- On success, only the current live connection receives role `TEACHER`. It receives
  `teacher.authenticated` followed by a fresh `activity.snapshot`.
- The teacher client sends the password again on every new connection. It does not save it in
  browser storage.

### `student.join`

```json
{
  "type": "student.join",
  "requestId": "r2",
  "payload": { "groupId": "2" }
}
```

- Valid only for a non-teacher connection. Requests from a teacher connection return
  `INVALID_MESSAGE` without changing any connection binding.
- The server checks `groupId` against the configured roster and binds this connection to that group.
- On success, the connection receives `student.joined` followed by a fresh `activity.snapshot`.
- Multiple student connections may join the same group.
- On reconnect, the client may resend the tab's saved `groupId`; the server must revalidate it.

### `activity.advance`

```json
{
  "type": "activity.advance",
  "requestId": "r3",
  "payload": { "from": "PREPARING", "to": "BUZZING" }
}
```

- The server checks the connection role before transition validation. Both `UNAUTHENTICATED`
  and `STUDENT` receive `AUTH_REQUIRED` without a state change or phase broadcast.
- The server accepts only the exact next transition from its current state.
- Stale `from` values, skipped stages, and backward transitions return `STAGE_CONFLICT` and do
  not mutate activity state.
- On success, the server broadcasts `activity.phaseChanged` to every open connection.
  The teacher who sent the request applies the same broadcast as all other connected clients.

## Server-to-Client Messages

### `activity.snapshot`

```json
{
  "type": "activity.snapshot",
  "payload": {
    "stage": "PREPARING",
    "groups": ["1", "2", "3"]
  }
}
```

Sent immediately on every new connection and again after successful role or group selection. The
client does not send a snapshot request. The stage always comes from the server. The valid group
list is public activity configuration.

### `teacher.authenticated`

```json
{
  "type": "teacher.authenticated",
  "requestId": "r1",
  "payload": { "ok": true }
}
```

### `student.joined`

```json
{
  "type": "student.joined",
  "requestId": "r2",
  "payload": { "ok": true, "groupId": "2" }
}
```

### `activity.phaseChanged`

```json
{
  "type": "activity.phaseChanged",
  "payload": { "stage": "BUZZING" }
}
```

Broadcast after a valid teacher transition. Clients replace their displayed phase with this
server-provided value.

### `error`

```json
{
  "type": "error",
  "requestId": "r3",
  "payload": {
    "code": "AUTH_REQUIRED",
    "message": "請先輸入老師密碼。"
  }
}
```

Supported in-band error codes: `INVALID_MESSAGE`, `AUTH_INVALID`, `AUTH_REQUIRED`, `GROUP_INVALID`,
`STAGE_CONFLICT`. Messages are actionable and never include a supplied password or other secret.

## Timing and Failure Behavior

- The server is the sole clock and state authority for stage changes.
- A transition broadcast must reach open clients within the SC-002 2-second local-network target.
- On socket close, the server discards that connection's role and group binding. Student tabs may
  rejoin with their saved group. Closing one connection leaves the roster and other connections
  intact. Teachers must authenticate again.
- The client may retry a dropped connection with bounded backoff. The server sends a fresh snapshot
  immediately after each connection opens. After receiving it, students with a saved group repeat
  `student.join`; teachers must enter their password again.
- In the same tab and running activity, student group recovery has no elapsed-time limit and
  applies in all three stages. After `GROUP_INVALID` on a restore attempt, the client clears the
  saved group and displays the group picker.
- The server sends a WebSocket ping every 30 seconds. A connection that does not return a pong
  within 10 seconds is terminated; other connections remain open. The server clears that
  connection's heartbeat interval and pending pong deadline on close, and clears all heartbeat
  timers on server shutdown. Client reconnect logic handles the resulting close event.
