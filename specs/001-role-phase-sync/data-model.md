# Data Model: 001 角色與階段同步

## Activity

Represents the one classroom activity hosted by the running local server.

| Field | Type | Validation / Rule |
|---|---|---|
| `stage` | `ActivityStage` | Server-owned; starts at `PREPARING`; only advances to the next allowed stage |
| `groups` | `Group[]` | Loaded once at startup by splitting GROUP_IDS on commas and trimming each entry. Reject empty entries, duplicates after trimming, entries containing control characters, and IDs whose student.join request with a 64-character requestId exceeds 16 KiB. At least one ID is required. ID content is otherwise opaque. |

The activity and its stage exist only in server memory. Restarting the server creates a new
activity in `PREPARING`; restart recovery is not part of this feature.

## ActivityStage

Allowed values and transitions:

```text
PREPARING → BUZZING → ENDED
```

Only an authenticated teacher connection can request the next transition. The server validates
the current stage and requested destination before mutating state. No backward or skipped
transition is allowed.

## Group

Represents one valid student team in this activity.

| Field | Type | Validation / Rule |
|---|---|---|
| `id` | `string` | Canonical trimmed, non-empty, opaque string without control characters; unique after trimming; supplied through `GROUP_IDS` |

More than one live student connection may reference the same group. A connection closing must not
remove the group or alter other connections assigned to it.

## UserConnection

Represents one currently open WebSocket connection; it is not a durable user account.

| Field | Type | Validation / Rule |
|---|---|---|
| `role` | `TEACHER \| STUDENT \| UNAUTHENTICATED` | New connection starts unauthenticated |
| `groupId` | `string \| null` | Required for a joined student; must match a configured group |
| `socketState` | `CONNECTING \| OPEN \| CLOSING \| CLOSED` | Managed by the WebSocket lifecycle |

Teacher authorization is attached to the live connection only. Closing the connection clears its
role. Any subsequent teacher connection, including a reconnect, must submit the password again.
No authentication token or teacher credential is persisted in browser storage.

## StudentSelection

Represents the selected group for the current browser tab.

| Field | Type | Validation / Rule |
|---|---|---|
| `groupId` | `string` | Saved in `sessionStorage`; revalidated by the server after each connection |

Reloading or reconnecting the same tab preserves the selection without an elapsed-time limit
within the running activity, including `ENDED`. A missing or invalid selection returns the student
to group selection and the client clears any rejected saved value. Closing the tab ends this
browser session. Cross-tab and cross-device identity are outside the feature scope.

## TeacherCredentialConfiguration

| Field | Source | Validation / Rule |
|---|---|---|
| `TEACHER_PASSWORD` | Environment variable | Teacher login requires a configured, non-whitespace-only password whose JSON request with a 64-character requestId fits within 16 KiB. Compare nonblank passwords exactly and case-sensitively. |

With a valid roster, the server starts even when the password is missing, blank or cannot fit
in the request. Teacher login is unavailable and returns `AUTH_INVALID` without granting a role.
A startup diagnostic may name the environment variable and explain the configuration problem.
Keep the configured password out of logs, error messages, source files, documentation and
committed configuration.

## Relationships

- One running `Activity` owns one current `ActivityStage` and a roster of `Group` entries.
- Each `UserConnection` is connected to the same activity while open.
- A student `UserConnection` may refer to one `Group`; multiple connections may refer to the same group.
- A teacher `UserConnection` has the `TEACHER` role only after password validation on that connection.
- A `StudentSelection` is tab-scoped browser state and is not a teacher credential or server authority.
