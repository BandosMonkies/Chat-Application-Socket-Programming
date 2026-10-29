# Sprint 1 Functional and Authentication Test Execution

## Execution record

| Item | Result |
|---|---|
| Execution date | 2026-10-29 |
| Tester | Shreecharana24 |
| Local environment | Windows 10.0.26300, Node.js v22.19.0, npm 10.9.3 |
| Application revision | `08842bce1a917d8bd130adc65ef04e3d8c7652c5` (`main`) |
| Test command | `npm run test:coverage` |
| Local result | **PASS** — 25 tests passed, 0 failed |
| Coverage result | 91.36% lines, 85.84% branches, 96.67% functions (all files) |
| CI environment | GitHub Actions, Ubuntu, Node.js 20 |
| CI result | **PASS** — [workflow run 40336226758](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/actions/runs/40336226758) on the same revision |

The automated tests start a local HTTP/WebSocket server and use a temporary
account store for each test. No production service or user data was used.

## Functional test cases

| Test ID | Procedure | Expected result | Actual result | Status | Automated evidence |
|---|---|---|---|---|---|
| TC-01 — Registration | Register a new unique username with valid credentials. | Account is created. | Registration returned `201 Created`; the normalized account was persisted with a salt and password hash, not the plaintext password. | PASS | `registers a user and stores a salted password hash, not the password` |
| TC-02 — Valid login | Register an account, log in with its credentials, and request the current session. | User is authenticated and can access protected chat. | Login returned `200 OK` with an HTTP-only session cookie; `/api/auth/me` returned the authenticated username. | PASS | `login sets a protected, same-site, HTTP-only session cookie`; `GET /api/auth/me requires a live authenticated session` |
| TC-03 — Invalid login | Try an incorrect password and an unknown username. | Login is rejected; protected access is not granted. | Both attempts returned the same generic `401 Unauthorized` response. | PASS | `rejects invalid credentials with a generic response` |
| TC-04 — Socket connection | Connect to `/chat` with a valid session and send `JOIN_CHAT`. | Persistent WebSocket connection is established. | The authenticated connection opened and received a successful `chat_joined` response. | PASS | `authenticated WebSocket clients may join the chat` |
| TC-05 — Send/receive | Connect Alice and Bob, send a valid message addressed to Bob, and observe the sender and connected clients. | The intended recipient receives and displays the correct message. | Alice and Bob received the correct message; an unrelated connected user did not receive it. The message included its timestamp. | PASS | `authenticated WebSocket clients can send messages to selected recipients`; `routes messages only to the sender and intended recipients` |
| TC-06 — Timestamp/order | Send two messages sequentially over one authenticated socket. | Messages have timestamps and are displayed chronologically. | Both messages arrived in send order and the second ISO timestamp was later than the first. | PASS | `sequential messages have chronological timestamps and preserve order` |

## Security validation

| Test ID | Procedure | Expected result | Actual result | Status | Automated evidence |
|---|---|---|---|---|---|
| SV-01 — Unauthenticated access | Attempt a WebSocket connection to protected `/chat` without a session cookie. | Access is denied. | The WebSocket upgrade was rejected with HTTP `401 Unauthorized`. | PASS | `rejects WebSocket access without an authenticated session` |
| SV-03 — Unauthorized administration | Probe an administrative user-management endpoint without authentication. | The operation is denied. | No administrative user-management endpoint is implemented; the probe returned `404 Not Found`. No administrative operation was executed. | PASS — no admin endpoint is exposed | `unimplemented administrative operations are not exposed`; see the README's stack and protocol notes. |
| SV-04 — Invalid/terminated session | Attempt protected HTTP and WebSocket access with invalid and expired session cookies. | Protected activity is not permitted. | `/api/auth/me` returned `401 Unauthorized`, and the WebSocket upgrade was rejected with HTTP `401 Unauthorized`. | PASS | `expired sessions cannot access HTTP or WebSocket protected features`; `invalid sessions cannot perform protected WebSocket operations` |

Input validation was also exercised: malformed JSON, unsupported content
types, invalid usernames, short passwords, and cross-origin authentication
requests were rejected or denied.

## Defects and limitations

- No defects were found by the above execution; no defect issues were opened.
- SV-03 confirms that no administrative endpoint is exposed. It does **not**
  validate role-based authorization for an administrative feature; that test
  becomes applicable if such a feature is added.
- The run did not measure message latency or concurrency. Those are outside
  TC-01 through TC-06 and must be recorded under their separate test cases.

## Reproduction

From a clean checkout with Node.js 20 or newer:

```powershell
npm ci
npm run test:coverage
```

The GitHub Actions CI workflow also runs `npm test` and `npm run test:coverage`
for pushes and pull requests.
