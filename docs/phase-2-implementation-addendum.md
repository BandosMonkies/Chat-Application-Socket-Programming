# Phase 2 Implementation and Traceability Addendum

**Record date:** 2026-10-30
**Baseline revision:** `83fe81e` (`origin/main`)
**Purpose:** Supplement the four submitted phase-1 PDF deliverables with the
implementation decisions, scope differences, run instructions, and traceability
verified during phase 2.

The original PDF deliverables remain the submitted baseline. This addendum
records their phase-2 updates in a reviewable, version-controlled format rather
than rewriting the fixed-layout PDFs.

## Submitted documents

| Deliverable | Submitted file | Phase-2 update in this addendum |
|---|---|---|
| Software Requirements Specification | [01_SRS_Chat_Application_IEEE_Format.pdf](../01_SRS_Chat_Application_IEEE_Format.pdf) | Records implemented behavior and requirements that remain unverified or out of scope. |
| Test Plan | [02_Test_Plan_Chat_Application_IEEE_Format.pdf](../02_Test_Plan_Chat_Application_IEEE_Format.pdf) | Records execution commands, current test evidence, and test-plan limitations. |
| Software Architecture and Design | [03_Software_Architecture_and_Design_Chat_Application.pdf](../03_Software_Architecture_and_Design_Chat_Application.pdf) | Records the implemented components, storage model, protocol, and deployment boundary. |
| Test Case Update and Traceability | [04_Test_Case_Update_Chat_Application.pdf](../04_Test_Case_Update_Chat_Application.pdf) | Maps the planned test identifiers to automated evidence and explains the numbering difference. |

## Implemented architecture and rationale

- **Runtime and communication:** Node.js 20 or newer, ES modules, Node's built-in
  HTTP server, and the `ws` WebSocket library. Static browser assets are served
  from `public/`; authentication/account logic is in `src/auth.js`, while HTTP,
  WebSocket protocol, routing, and presence are in `src/server.js`.
- **Authentication and storage:** Accounts persist in `data/users.json` with
  salted scrypt password hashes. Session tokens are stored in server memory,
  expire after 12 hours, and are revoked on logout. The WebSocket upgrade
  requires a valid HTTP-only session cookie.
- **Message and presence protocol:** Chat requests and events use JSON text
  frames. `JOIN_CHAT` returns the sorted online-user list; joined clients receive
  join/leave notifications and updated lists. `USER_LIST` returns the current
  list. `SEND_MESSAGE` requires one or more valid recipients and routes messages
  to the sender and connected intended recipients.
- **Validation limits:** HTTP JSON bodies and WebSocket frames are limited to
  16 KiB. Usernames are 3-32 ASCII letters, digits, or underscores; passwords
  are 8-128 UTF-8 bytes. The baseline counts a 2,000-character message limit
  using JavaScript string length. [PR #24](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/pull/24)
  adds strict media-type validation, binary-frame rejection, Unicode
  code-point counting, and negative/recovery tests; see [the issue 11 test
  report](./issue-11-input-validation.md).
- **Rationale and boundary:** The team selected Node.js for the project
  implementation. JSON-file accounts and in-memory sessions keep the
  single-process mini-project simple; they are not a horizontally scalable
  production store. Running multiple server instances or deploying publicly
  requires shared account/session storage, HTTPS, and further operational
  validation. The development listener binds to loopback by default.
- **Unimplemented administration:** No administrative user-management endpoint
  is exposed. Administrative authorization therefore remains inapplicable until
  such an endpoint is designed and approved.

The presence work was delivered by [PR #23](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/pull/23),
closing [issue #10](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/issues/10).
Input validation is being delivered separately in [PR #24](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/pull/24),
for [issue #11](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/issues/11).

## Requirement and test traceability

| Requirement / planned test | Implemented behavior and evidence | Status / limitation |
|---|---|---|
| FR-17, FR-18, NFR-09, SEC-02; TC-09, TC-12, SV-02 | Rejects empty/invalid messages and malformed account/message input; issue 11 adds negative and recovery tests. See [issue 11 test report](./issue-11-input-validation.md). | The issue 11 PR is open for review. Its CI checks pass; merge it before treating its additions as part of `main`. |
| FR-12 through FR-16, NFR-02, NFR-03; TC-07, TC-08, TC-11 | Presence list and join/leave behavior are implemented and tested in [PR #23](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/pull/23). | Merged into `main`. The automated tests verify multiple clients and disconnect handling, but are not a load/stress benchmark. |
| Authentication and protected chat; TC-01 through TC-06, SV-01, SV-04 | Registration, login, logout, session checks, protected WebSocket upgrades, message routing, and timestamp behavior are covered by [the Sprint 1 execution report](./sprint-1-test-execution.md). | The report documents the tested revision and environment; it does not claim production deployment or load testing. |
| NFR-06, NFR-07 | The implementation is split into server, authentication, browser client, and test modules. Node.js is cross-platform; local Windows and GitHub Actions Ubuntu runs are documented in the execution reports. | Maintainability and portability are supported by the structure and runs, not by a separate quantitative metric. |
| NFR-08 | The code uses a single-process JSON account store and in-memory sessions. | Horizontal scaling is not implemented or demonstrated. A shared database and session store are required before multi-instance operation. |

The submitted Test Plan and Test Case Update use different test-case catalogs
and identifiers for their input-validation scenarios. The issue's traceability
identifiers are retained above; automated test names are used as execution
evidence instead of silently renumbering either submitted document.

## Setup and execution

Requirements: Node.js 20 or newer and npm. The only external runtime dependency
is `ws`; testing uses Node's built-in test runner.

```powershell
npm ci
npm start
npm test
npm run test:coverage
```

By default, the server listens on `http://127.0.0.1:8765`. `HOST`, `PORT`, and
`ACCOUNT_FILE` can override the listener and account-file path. Set
`NODE_ENV=production` when serving behind HTTPS to set the `Secure` cookie
attribute; do not expose the development HTTP listener directly to an untrusted
network.
