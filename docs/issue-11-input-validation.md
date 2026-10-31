# Issue 11 Input Validation Test Execution

## Execution record

| Item | Result |
|---|---|
| Execution date | 2026-10-30 |
| Tester | Shreecharana24 |
| Environment | Windows 10.0.26300, Node.js v22.19.0, npm 10.9.3 |
| Branch | `issue-11-input-validation` |
| Base revision | `338fdd3` |
| Test command | `npm run test:coverage` |
| Result | **PASS** — 27 tests passed, 0 failed |
| Coverage | 94.47% lines, 90.12% branches, 95.79% functions (all files) |
| CI result | **PASS** — both PR #24 checks passed: [test](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/actions/runs/41081869028) and [coverage](https://github.com/BandosMonkies/Chat-Application-Socket-Programming/actions/runs/41081843595) |

Tests start a local HTTP/WebSocket server and use temporary account storage.
No production service or user data was used.

## Input-validation cases

| Area | Inputs and procedure | Expected and actual result | Automated evidence |
|---|---|---|---|
| Registration fields | Submit null, array, missing fields, invalid username, non-string password, and passwords below/above allowed bounds. | Every invalid request returns a client error with a JSON error response. | `rejects malformed registration payloads and invalid account fields` |
| HTTP JSON media type | Submit malformed JSON, form data, and the spoofed `application/jsonp` media type. | Invalid JSON returns `400`; non-JSON media types return `415`. | `rejects malformed JSON and non-JSON registration requests` |
| HTTP body size | Submit an oversized JSON request, then request `/health`. | Registration returns `413`; the health endpoint still returns `200`. | `rejects oversized JSON bodies without interrupting the HTTP connection` |
| WebSocket structure | Send malformed JSON, null, arrays, invalid operations, and missing/incorrect recipient or message fields. | Each invalid frame returns a JSON error; no invalid chat message is delivered. A subsequent valid message still reaches the sender and intended recipient. | `rejects malformed WebSocket payloads and recovers without delivering them` |
| WebSocket frame type | Send a binary frame containing otherwise valid JSON. | The server explicitly rejects the binary frame. | `rejects malformed WebSocket payloads and recovers without delivering them` |
| Message length | Send 2,000 emoji code points, then 2,001. | The 2,000-character message is delivered; the longer message is rejected. | `rejects malformed WebSocket payloads and recovers without delivering them` |

## Defects and limitations

- No defects were found by this execution.
- The coverage report includes the full project test suite; it is not a
  stand-alone measurement of issue 11 code.
- No latency or load benchmark was part of this input-validation execution.

## Reproduction

```powershell
npm test
npm run test:coverage
```
