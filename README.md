# Real-Time Chat Application

A Node.js chat application using WebSockets. The server owns account data,
authentication, sessions, and protected chat connections. Message delivery,
user presence, and recipient routing are separate implementation work.

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

For first-time installation, use `npm install` if a package lock has not yet
been created.

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
{"op":"JOIN_CHAT"}
```

The authenticated client receives a `chat_joined` response. Sending
`{"op":"LOGOUT"}` over the authenticated socket revokes the session. The
browser client served at `/` sends messages with
`{"op":"SEND_MESSAGE","message":"Hello"}` and displays messages broadcast to
all authenticated connections. User-list operations are not implemented.

## Tests

```powershell
npm test
npm run test:coverage
```

## Project planning

The team backlog, Sprint 1 and Sprint 2 work, story-point estimates, and
acceptance criteria are tracked in the [GitHub Project](https://github.com/users/BandosMonkies/projects/3)
and the repository's GitHub Issues. Estimates should be reviewed by the team.
