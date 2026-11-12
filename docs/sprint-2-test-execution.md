# Sprint 2 Test Execution and Requirement Traceability

## Verdict

| Tier | Status | Exit code | Evidence |
|---|---|---:|---|
| Startup | PASS | 0 | Playwright web server started `node e2e/server-fixture.js`; `/health` became ready. |
| Integration | PASS | 0 | `npm test`: 42 tests passed, 0 failed. |
| Coverage | PASS | 0 | `npm run test:coverage`: 42 tests passed; 96.84% lines, 91.60% branches, 95.18% functions. |
| Browser E2E | PASS | 0 | `npm run test:e2e`: 1 Playwright flow passed. |
| Dependency audit | FAIL | 1 | `npm audit --omit=dev`: 7 vulnerabilities (2 low, 4 high, 1 critical). |

**Overall:** **NEEDS SIGN-OFF**. All applicable functional, persistence,
concurrency, frontend, input-validation, and runtime authentication/security
tests passed. The dependency audit remains unresolved and could not be linked
to a GitHub defect because the configured `gh` credential is invalid.

## Environment and capability decisions

| Capability | Result |
|---|---|
| OS | Windows |
| Node.js / npm | Node.js `v22.19.0`, npm `10.9.3` |
| Docker | Unavailable: `docker` command not found |
| Database tier | Fallback: local SQLite (`sqlite3`), isolated temporary database per integration test |
| Browser tier | Primary: Playwright `1.65.0` with Chromium installed successfully |
| Application | Node.js HTTP server + `ws` WebSocket server; readiness endpoint `/health` |

Docker was attempted independently and was not available. This does not
downgrade browser validation: Chromium was installed and the browser tier ran
successfully. SQLite is the documented infrastructure fallback; no
Docker-specific database fidelity is claimed.

## Commands and evidence

```powershell
npm ci
npm test
npm run test:coverage
npm run test:e2e
npm audit --omit=dev
```

The canonical integration suite includes the existing authentication/socket
regression cases plus these Sprint 2 suites:

- `test/sprint2-database.test.js` — TC-07 persistence across restart.
- `test/sprint2-concurrency.test.js` — TC-11 concurrent delivery,
  persistence, and measured latency.
- `test/sprint2-security.test.js` — SV-02/SV-04 invalid credentials and
  protected-route enforcement.
- `e2e/sprint2-frontend.spec.js` — browser login, search, chat selection, and
  message rendering.

The concurrency run delivered and read back 20 messages in **283.09 ms** on
this local Windows run. This is a measurement for the tested workload, not a
production benchmark or a claim about all one-second performance requirements.

## Test-case execution

| ID | Coverage and actual result | Status |
|---|---|---|
| TC-07 | SQLite message write, server shutdown, restart, and `/api/chats/bob` read-back retained the message. | PASS |
| TC-08 | Authenticated user list and conversation history endpoints returned the expected users and ordered history. | PASS |
| TC-09 | Invalid/unknown conversation access returned `401` or `404` as applicable. | PASS |
| TC-10 | Malformed JSON, unsupported content type, invalid usernames, and oversized payloads were rejected without breaking the connection. | PASS |
| TC-11 | 20 sends were delivered, all 20 were persisted, and the measured batch elapsed time was 283.09 ms. | PASS — measured workload only |
| TC-12 | Empty messages, invalid recipients, Unicode limits, binary frames, and recovery after malformed frames were covered. | PASS |

## Security validation

| ID | Actual result | Status |
|---|---|---|
| SV-01 | WebSocket upgrade without a valid session was rejected with `401`. | PASS |
| SV-02 | Invalid credentials, malformed auth input, cross-origin auth, invalid recipients, and malformed socket requests were rejected. | PASS |
| SV-03 | No administrative endpoint is exposed; administrative probe returned `404`. Role-based admin authorization is not applicable. | PASS — not applicable |
| SV-04 | Missing, invalid, expired, logged-out, and revoked sessions could not access protected HTTP/WebSocket operations. | PASS |

### Dependency finding

`npm audit --omit=dev` reported 7 vulnerabilities: 2 low, 4 high, and 1
critical. The direct `sqlite3@5.1.7` dependency is associated with vulnerable
`node-gyp`/`tar` transitive packages; npm reports `sqlite3@6.0.1` as a
major-version fix. No dependency upgrade was made during this execution task.

## SRS-to-test traceability

The following matrix records actual evidence from this run. `UNVERIFIED` means
the submitted SRS requirement needs a dedicated test or measurement; it is not
silently treated as passed.

| Requirement | Evidence | Result |
|---|---|---|
| FR-01 | Registration test creates a normalized account and stores a hash. | PASS |
| FR-02 | Valid login returns a session cookie and `/api/auth/me` identity. | PASS |
| FR-03 | Logout revokes the session and closes protected sockets. | PASS |
| FR-04 | Missing/invalid/expired sessions are rejected. | PASS |
| FR-05 | Authenticated WebSocket join succeeds. | PASS |
| FR-06 | Online user list and join/leave notifications are exercised. | PASS |
| FR-07 | Messages are sent to selected recipients and echoed to the sender. | PASS |
| FR-08 | Unintended connected users do not receive private messages. | PASS |
| FR-09 | Message timestamps are ISO-formatted and sequential order is preserved. | PASS |
| FR-10 | Conversation history is available through the protected chat endpoint. | PASS |
| FR-11 | SQLite message persistence survives server restart. | PASS |
| FR-12 | Browser chat list search and conversation selection work. | PASS |
| FR-13 | Browser message composer renders a sent message. | PASS |
| FR-14 | Malformed/oversized input is rejected and the socket recovers. | PASS |
| FR-15 | Unknown users and conversations are rejected without delivery. | PASS |
| FR-16 | Concurrent sends preserve all 20 messages. | PASS |
| FR-17 | Authentication and chat routes enforce same-origin/session checks. | PASS |
| FR-18 | Protected user/history routes return authenticated data only. | PASS |
| FR-19 | Administrative operations remain unavailable as specified. | PASS — N/A |
| FR-20 | Reconnection/missed-message replay after a live socket disconnect was not separately measured. | UNVERIFIED |
| NFR-01 | Local measured 20-message batch completed in 283.09 ms. | PASS — local workload |
| NFR-02 | Restart persistence test retained message history. | PASS |
| NFR-03 | Concurrent message delivery and database read-back passed. | PASS |
| NFR-04 | No production load profile or sustained throughput measurement was performed. | UNVERIFIED |
| NFR-05 | No multi-instance/shared-session deployment test was performed. | UNVERIFIED |
| NFR-06 | Automated tests run on Node.js 22; CI configuration targets Node.js 20. | PASS |
| NFR-07 | Tests use isolated temporary stores and deterministic cleanup. | PASS |
| NFR-08 | Horizontal scaling is not implemented; sessions remain process-local. | UNVERIFIED |
| NFR-09 | Input limits and malformed request handling are covered. | PASS |
| NFR-10 | Dependency audit has unresolved vulnerabilities. | FAIL — defect |
| SEC-01 | Protected HTTP and WebSocket access requires a valid session. | PASS |
| SEC-02 | Invalid credentials receive a generic `401`; password hashes are not plaintext. | PASS |
| SEC-03 | Same-origin checks, input validation, frame limits, and path validation pass. | PASS |
| SEC-04 | Logout/expiry/revocation prevent subsequent protected access. | PASS |

## Defects and limitations

| Finding | Severity | Link/status |
|---|---|---|
| Runtime dependency audit reports one critical and four high vulnerabilities through `sqlite3@5.1.7` dependency tooling. | High/Critical | No issue link created: `gh auth status` reports an invalid credential. Requires dependency-remediation follow-up. |
| Docker unavailable for this run. | Environment limitation | SQLite fallback used; Docker database fidelity not verified. |
| Live reconnect replay was not separately exercised. | Coverage gap | FR-20 remains UNVERIFIED. |

No functional or authentication/security test failure was observed. The
dependency audit finding must be resolved or explicitly waived before a fully
clean security acceptance.
