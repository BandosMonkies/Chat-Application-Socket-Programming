import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import WebSocket from "ws";
import { SESSION_COOKIE } from "../src/auth.js";
import { startServer } from "../src/server.js";

let directory;
let app;
let baseUrl;
let serverUrl;

function request(path, options) {
  return fetch(`${baseUrl}${path}`, options);
}

async function postJson(path, body, extraHeaders = {}) {
  return request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function sessionFrom(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "login should set a session cookie");
  return cookie.split(";")[0];
}

async function login(username = "alice", password = "correct-horse") {
  const response = await postJson("/api/auth/login", { username, password });
  assert.equal(response.status, 200);
  return sessionFrom(response);
}

function connectSocket(cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${serverUrl}/chat`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    socket.once("open", () => resolve(socket));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      reject(new Error(`WebSocket upgrade rejected: ${response.statusCode}`));
    });
    socket.once("error", reject);
  });
}

function receiveJson(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
      socket.off("error", onError);
    };
    const onMessage = (message) => {
      cleanup();
      try {
        resolve(JSON.parse(message.toString()));
      } catch (error) {
        reject(error);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before reply"));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.once("message", onMessage);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "chat-auth-test-"));
  app = await startServer({
    host: "127.0.0.1",
    port: 0,
    accountFile: join(directory, "users.json"),
    secureCookies: false,
  });
  const address = app.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  serverUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (app?.httpServer.listening) {
    for (const socket of app.webSocketServer.clients) {
      socket.terminate();
    }
    app.webSocketServer.close();
    await new Promise((resolve, reject) => {
      app.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await rm(directory, { recursive: true, force: true });
});

test("health endpoint reports that the server is running", async () => {
  const response = await request("/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("serves the chat client", async () => {
  const response = await request("/");

  assert.equal(response.status, 200);
  assert.match(await response.text(), /Socket Chat/);
  assert.match(response.headers.get("content-type"), /text\/html/);
});

test("registers a user and stores a salted password hash, not the password", async () => {
  const response = await postJson("/api/auth/register", {
    username: "Alice",
    password: "correct-horse",
  });
  const accountStore = JSON.parse(
    await readFile(join(directory, "users.json"), "utf8"),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, username: "alice" });
  assert.ok(accountStore.alice.salt);
  assert.ok(accountStore.alice.passwordHash);
  assert.notEqual(accountStore.alice.passwordHash, "correct-horse");
});

test("persists accounts across server instances", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const accountFile = join(directory, "users.json");
  const previousServer = app;
  await new Promise((resolve, reject) => {
    previousServer.webSocketServer.close();
    previousServer.httpServer.close((error) =>
      error ? reject(error) : resolve(),
    );
  });

  app = await startServer({
    host: "127.0.0.1",
    port: 0,
    accountFile,
    secureCookies: false,
  });
  const address = app.httpServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  serverUrl = `ws://127.0.0.1:${address.port}`;

  const response = await postJson("/api/auth/login", {
    username: "alice",
    password: "correct-horse",
  });

  assert.equal(response.status, 200);
});

test("rejects malformed registration payloads and invalid account fields", async () => {
  const invalidBodies = [
    "null",
    "[]",
    JSON.stringify({ password: "correct-horse" }),
    JSON.stringify({ username: 42, password: "correct-horse" }),
    JSON.stringify({ username: "not valid", password: "correct-horse" }),
    JSON.stringify({ username: "alice", password: 42 }),
    JSON.stringify({ username: "alice", password: "short" }),
    JSON.stringify({ username: "alice", password: "x".repeat(129) }),
  ];

  for (const body of invalidBodies) {
    const response = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, 400, `Expected rejection for ${body}`);
    const result = await response.json();
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, "string");
  }
});

test("validates password minimum length using UTF-8 bytes", async () => {
  const password = "éééé";
  assert.equal(Buffer.byteLength(password, "utf8"), 8);

  const registration = await postJson("/api/auth/register", {
    username: "unicode",
    password,
  });
  const loginResponse = await postJson("/api/auth/login", {
    username: "unicode",
    password,
  });

  assert.equal(registration.status, 201);
  assert.equal(loginResponse.status, 200);
});

test("does not allow duplicate usernames with different casing", async () => {
  await postJson("/api/auth/register", {
    username: "Alice",
    password: "correct-horse",
  });
  const response = await postJson("/api/auth/register", {
    username: "alice",
    password: "different-horse",
  });

  assert.equal(response.status, 409);
});

test("safely stores usernames that match JavaScript object property names", async () => {
  const usernames = ["__proto__", "constructor", "toString"];

  for (const username of usernames) {
    const registration = await postJson("/api/auth/register", {
      username,
      password: "correct-horse",
    });
    assert.equal(registration.status, 201);
  }

  const accountStore = JSON.parse(
    await readFile(join(directory, "users.json"), "utf8"),
  );
  assert.deepEqual(Object.keys(accountStore).sort(), [
    "__proto__",
    "constructor",
    "tostring",
  ]);

  for (const username of usernames) {
    const response = await postJson("/api/auth/login", {
      username,
      password: "correct-horse",
    });
    assert.equal(response.status, 200);
  }
});

test("rejects malformed JSON and non-JSON registration requests", async () => {
  const malformedResponse = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  const incorrectContentTypeResponse = await request("/api/auth/register", {
    method: "POST",
    body: "username=alice",
  });
  const spoofedContentTypeResponse = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/jsonp" },
    body: "{}",
  });

  assert.equal(malformedResponse.status, 400);
  assert.equal(incorrectContentTypeResponse.status, 415);
  assert.equal(spoofedContentTypeResponse.status, 415);
});

test("rejects oversized JSON bodies without interrupting the HTTP connection", async () => {
  const response = await postJson("/api/auth/register", {
    username: "alice",
    password: "x".repeat(17_000),
  });

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Request body is too large.",
  });

  const healthResponse = await request("/health");
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true });
});

test("rejects cross-origin authentication requests", async () => {
  const response = await postJson(
    "/api/auth/register",
    { username: "alice", password: "correct-horse" },
    { Origin: "https://attacker.example" },
  );

  assert.equal(response.status, 403);
});

test("rejects invalid credentials with a generic response", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });

  const wrongPasswordResponse = await postJson("/api/auth/login", {
    username: "alice",
    password: "wrong-password",
  });
  const unknownUserResponse = await postJson("/api/auth/login", {
    username: "bob",
    password: "wrong-password",
  });

  assert.equal(wrongPasswordResponse.status, 401);
  assert.deepEqual(await wrongPasswordResponse.json(), {
    ok: false,
    error: "Invalid username or password.",
  });
  assert.equal(unknownUserResponse.status, 401);
  assert.deepEqual(await unknownUserResponse.json(), {
    ok: false,
    error: "Invalid username or password.",
  });
});

test("login sets a protected, same-site, HTTP-only session cookie", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const response = await postJson("/api/auth/login", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = response.headers.get("set-cookie");

  assert.equal(response.status, 200);
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE}=[a-f0-9]{64};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
});

test("GET /api/auth/me requires a live authenticated session", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });

  const unauthenticatedResponse = await request("/api/auth/me");
  assert.equal(unauthenticatedResponse.status, 401);

  const cookie = await login();
  const authenticatedResponse = await request("/api/auth/me", {
    headers: { Cookie: cookie },
  });

  assert.equal(authenticatedResponse.status, 200);
  assert.deepEqual(await authenticatedResponse.json(), {
    ok: true,
    username: "alice",
  });
});

test("rejects WebSocket access without an authenticated session", async () => {
  await assert.rejects(connectSocket(null), /401/);
});

test("authenticated WebSocket clients may join the chat", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = await login();
  const socket = await connectSocket(cookie);

  try {
    const responsePromise = receiveJson(socket);
    socket.send(JSON.stringify({ op: "JOIN_CHAT" }));
    assert.deepEqual(await responsePromise, {
      ok: true,
      event: "chat_joined",
      username: "alice",
    });
  } finally {
    socket.close();
  }
});

test("authenticated WebSocket clients can send messages to selected recipients", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  await postJson("/api/auth/register", {
    username: "bob",
    password: "correct-horse",
  });
  const cookie = await login();
  const socket = await connectSocket(cookie);

  try {
    const responsePromise = receiveJson(socket);
    socket.send(
      JSON.stringify({
        op: "SEND_MESSAGE",
        recipients: ["BOB", "bob"],
        message: " Hello ",
      }),
    );
    const response = await responsePromise;
    assert.deepEqual(
      { ...response, sentAt: undefined },
      {
        ok: true,
        event: "message",
        username: "alice",
        recipients: ["bob"],
        message: "Hello",
        sentAt: undefined,
      },
    );
    assert.match(response.sentAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    socket.close();
  }
});

test("routes messages only to the sender and intended recipients", async () => {
  for (const username of ["alice", "bob", "charlie"]) {
    await postJson("/api/auth/register", {
      username,
      password: "correct-horse",
    });
  }

  const alice = await connectSocket(await login("alice"));
  const bob = await connectSocket(await login("bob"));
  const charlie = await connectSocket(await login("charlie"));

  try {
    const aliceMessage = receiveJson(alice);
    const bobMessage = receiveJson(bob);
    const charlieMessage = receiveJson(charlie);
    alice.send(
      JSON.stringify({
        op: "SEND_MESSAGE",
        recipients: ["bob"],
        message: "Private hello",
      }),
    );

    assert.equal((await aliceMessage).message, "Private hello");
    const response = await bobMessage;
    assert.equal(response.username, "alice");
    assert.deepEqual(response.recipients, ["bob"]);
    assert.equal(response.message, "Private hello");
    assert.match(response.sentAt, /^\d{4}-\d{2}-\d{2}T/);
    await assert.rejects(
      Promise.race([
        charlieMessage,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("not delivered")), 100),
        ),
      ]),
      /not delivered/,
    );
  } finally {
    alice.close();
    bob.close();
    charlie.close();
  }
});

test("rejects messages without valid recipients", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const socket = await connectSocket(await login());

  try {
    const responsePromise = receiveJson(socket);
    socket.send(JSON.stringify({ op: "SEND_MESSAGE", message: "Hello" }));
    assert.deepEqual(await responsePromise, {
      ok: false,
      error: "At least one recipient is required.",
    });
  } finally {
    socket.close();
  }
});

test("rejects malformed WebSocket payloads and recovers without delivering them", async () => {
  for (const username of ["alice", "bob"]) {
    await postJson("/api/auth/register", {
      username,
      password: "correct-horse",
    });
  }
  const alice = await connectSocket(await login("alice"));
  const bob = await connectSocket(await login("bob"));
  const invalidFrames = [
    { payload: "{", error: "Invalid JSON request." },
    {
      payload: "null",
      error: "Request must be an object with an operation.",
    },
    {
      payload: "[]",
      error: "Request must be an object with an operation.",
    },
    {
      payload: JSON.stringify({ op: 42 }),
      error: "Request must be an object with an operation.",
    },
    {
      payload: JSON.stringify({ op: "SEND_MESSAGE", message: "hello" }),
      error: "At least one recipient is required.",
    },
    ...[
      {
        fields: { message: null, recipients: ["bob"] },
        error: "Message cannot be empty.",
      },
      {
        fields: { message: 42, recipients: ["bob"] },
        error: "Message cannot be empty.",
      },
      {
        fields: { message: "", recipients: ["bob"] },
        error: "Message cannot be empty.",
      },
      {
        fields: { message: " \t\n ", recipients: ["bob"] },
        error: "Message cannot be empty.",
      },
      {
        fields: { message: "x".repeat(2001), recipients: ["bob"] },
        error: "Message must be 2000 characters or fewer.",
      },
      {
        fields: { message: "hello", recipients: [] },
        error: "At least one recipient is required.",
      },
      {
        fields: { message: "hello", recipients: "bob" },
        error: "At least one recipient is required.",
      },
      {
        fields: { message: "hello", recipients: ["not valid"] },
        error:
          "Username must be 3-32 characters using letters, numbers, or underscores.",
      },
      {
        fields: { message: "hello", recipients: [null] },
        error:
          "Username must be 3-32 characters using letters, numbers, or underscores.",
      },
    ].map(({ fields, error }) => ({
      payload: JSON.stringify({ op: "SEND_MESSAGE", ...fields }),
      error,
    })),
  ];

  try {
    for (const { payload, error } of invalidFrames) {
      const responsePromise = receiveJson(alice);
      alice.send(payload);
      assert.deepEqual(await responsePromise, { ok: false, error });
    }

    const binaryResponsePromise = receiveJson(alice);
    alice.send(
      Buffer.from(JSON.stringify({ op: "JOIN_CHAT" })),
      { binary: true },
    );
    assert.deepEqual(await binaryResponsePromise, {
      ok: false,
      error: "Binary WebSocket frames are not supported.",
    });

    const aliceMessagePromise = receiveJson(alice);
    const bobMessagePromise = receiveJson(bob);
    const message = "🙂".repeat(2000);
    alice.send(
      JSON.stringify({
        op: "SEND_MESSAGE",
        recipients: ["bob"],
        message,
      }),
    );

    assert.equal((await aliceMessagePromise).message, message);
    assert.equal((await bobMessagePromise).message, message);

    const rejectedMessagePromise = receiveJson(alice);
    alice.send(
      JSON.stringify({
        op: "SEND_MESSAGE",
        recipients: ["bob"],
        message: "🙂".repeat(2001),
      }),
    );
    assert.deepEqual(await rejectedMessagePromise, {
      ok: false,
      error: "Message must be 2000 characters or fewer.",
    });
  } finally {
    alice.close();
    bob.close();
  }
});

test("sequential messages have chronological timestamps and preserve order", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = await login();
  const socket = await connectSocket(cookie);

  try {
    const firstResponsePromise = receiveJson(socket);
    socket.send(
      JSON.stringify({ op: "SEND_MESSAGE", recipients: ["alice"], message: "First" }),
    );
    const firstResponse = await firstResponsePromise;

    const secondResponsePromise = receiveJson(socket);
    socket.send(
      JSON.stringify({ op: "SEND_MESSAGE", recipients: ["alice"], message: "Second" }),
    );
    const secondResponse = await secondResponsePromise;

    assert.equal(firstResponse.message, "First");
    assert.equal(secondResponse.message, "Second");
    assert.ok(
      Date.parse(firstResponse.sentAt) < Date.parse(secondResponse.sentAt),
    );
  } finally {
    socket.close();
  }
});

test("logout revokes the session, expires the cookie, and closes its sockets", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = await login();
  const socket = await connectSocket(cookie);
  const closePromise = new Promise((resolve) =>
    socket.once("close", (code, reason) => resolve({ code, reason })),
  );
  const logoutResponse = await request("/api/auth/logout", {
    method: "POST",
    headers: { Cookie: cookie },
  });

  try {
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get("set-cookie"), /Max-Age=0/);
    const close = await closePromise;
    assert.equal(close.code, 1008);
    assert.equal(close.reason.toString(), "Session ended");

    const currentUserResponse = await request("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    assert.equal(currentUserResponse.status, 401);
    await assert.rejects(connectSocket(cookie), /401/);
  } finally {
    socket.terminate();
  }
});

test("WebSocket LOGOUT revokes its cookie session", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = await login();
  const socket = await connectSocket(cookie);
  const closePromise = new Promise((resolve) =>
    socket.once("close", (code) => resolve(code)),
  );

  try {
    const responsePromise = receiveJson(socket);
    socket.send(JSON.stringify({ op: "LOGOUT" }));
    assert.deepEqual(await responsePromise, {
      ok: true,
      message: "Logged out.",
    });
    assert.equal(await closePromise, 1008);
    await assert.rejects(connectSocket(cookie), /401/);
  } finally {
    socket.terminate();
  }
});

test("expired sessions cannot access HTTP or WebSocket protected features", async () => {
  await postJson("/api/auth/register", {
    username: "alice",
    password: "correct-horse",
  });
  const cookie = await login();
  const token = cookie.split("=")[1];
  app.authService.sessions.get(
    app.authService.getSession(token).key,
  ).expiresAt = Date.now() - 1;

  const response = await request("/api/auth/me", {
    headers: { Cookie: cookie },
  });

  assert.equal(response.status, 401);
  await assert.rejects(connectSocket(cookie), /401/);
});

test("invalid sessions cannot perform protected WebSocket operations", async () => {
  const response = await request("/api/auth/me", {
    headers: { Cookie: `${SESSION_COOKIE}=${"a".repeat(64)}` },
  });

  assert.equal(response.status, 401);
  await assert.rejects(
    connectSocket(`${SESSION_COOKIE}=${"a".repeat(64)}`),
    /401/,
  );
});

test("invalid and unauthenticated logout requests do not create a session", async () => {
  const response = await request("/api/auth/logout", { method: "POST" });

  assert.equal(response.status, 401);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});

test("unimplemented administrative operations are not exposed", async () => {
  const response = await request("/api/auth/admin/users", {
    method: "DELETE",
  });

  assert.equal(response.status, 404);
});
