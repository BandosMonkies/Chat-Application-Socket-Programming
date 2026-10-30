# Real-Time Chat Application

A Node.js chat application using WebSockets. The server owns account data,
authentication, sessions, protected chat connections, message delivery,
recipient routing, and user presence.

## Stack and protocol

- Node.js 20 or newer.
- HTTP JSON endpoints for registration, login, logout, and the current session.
- WebSocket connections at `/chat`; a valid server-issued session cookie is
  required before the connection is accepted.
- Usernames are case-insensitive, 3-32 characters, and may contain letters,
  digits, and underscores.
- Passwords must be 8-128 UTF-8 bytes. They are stored as salted scrypt hashes.
- Accounts are persisted in `data/users.json`. Session tokens are random,
  server-side, expire after 12 hours, and are invalidated by logout or restart.
- This account/session store is for the single-process project implementation.
  Use a shared database and session store before running multiple server
  instances or deploying to a production environment.
- No administrative user-management endpoint is currently exposed.

## Setup

```powershell
npm ci
```

Requires Node.js 20 or newer and npm. The `ws` package is the only runtime
dependency; HTTP, cryptography, file storage, and testing use Node.js built-ins.

## Run

```powershell
npm start
```

The server listens on `http://127.0.0.1:8765` by default. Set `HOST`, `PORT`,
or `ACCOUNT_FILE` to override the listener or account-store location. Set
`NODE_ENV=production` when serving behind HTTPS so the session cookie includes
the `Secure` attribute. Do not expose the development HTTP listener directly to
an untrusted network.

## Authentication API

All request and response bodies are JSON. Authentication responses are marked
`Cache-Control: no-store`.

### Register

```http
POST /api/auth/register
Content-Type: application/json

{"username":"alice","password":"correct-horse"}
```

Returns `201 Created`. Duplicate usernames return `409 Conflict`; invalid
username or password data returns `400 Bad Request`.

### Log in

```http
POST /api/auth/login
Content-Type: application/json

{"username":"alice","password":"correct-horse"}
```

Returns the authenticated username and sets an `HttpOnly`, `SameSite=Strict`
`chat_session` cookie. Unknown usernames and incorrect passwords receive the
same `401 Unauthorized` response.

### Check the current session

```http
GET /api/auth/me
Cookie: chat_session=<session-cookie>
```

Returns the current username or `401 Unauthorized` if the cookie is missing,
expired, or revoked.

### Log out

```http
POST /api/auth/logout
Cookie: chat_session=<session-cookie>
```

Revokes the server-side session, closes WebSocket connections using that
session, and expires the cookie. Logging out without a valid session returns
`401 Unauthorized`.

## WebSocket authentication

Connect to `ws://127.0.0.1:8765/chat` with the `chat_session` cookie returned by
login. The server rejects a missing, expired, or revoked session during the
WebSocket upgrade. For example, a client sends:

```json
{ "op": "JOIN_CHAT" }
```

The authenticated client receives a `chat_joined` response followed by a
`user_list` event containing the sorted usernames currently in the room.
Connected clients receive `user_joined` and `user_left` events when a user
enters or leaves, followed by an updated `user_list`. The `USER_LIST`
operation returns the current list. Sending `{"op":"LOGOUT"}` over the
authenticated socket revokes the session. A message request has the shape
`{"op":"SEND_MESSAGE","recipients":["bob"],"message":"Hello"}`. The server
delivers it to the sender and connected authenticated recipients; recipient
names are case-insensitive, duplicates are removed, and at least one valid
recipient is required. Messages include an ISO timestamp. Binary WebSocket
frames are not part of the text protocol, and malformed requests are rejected.
No administrative user-management endpoint is exposed.

## Tests

```powershell
npm test
npm run test:coverage
```

The Sprint 1 execution environment, results, and requirement-to-test mapping
are recorded in [the Sprint 1 test execution report](./docs/sprint-1-test-execution.md).

## Project planning

The team backlog, Sprint 1 and Sprint 2 work, story-point estimates, and
acceptance criteria are tracked in the [GitHub Project](https://github.com/users/BandosMonkies/projects/3)
and the repository's GitHub Issues. Estimates should be reviewed by the team.

## Phase 2 documentation

The implementation differences, rationale, setup details, and requirement
traceability are recorded in
[the phase-2 implementation addendum](./docs/phase-2-implementation-addendum.md).
