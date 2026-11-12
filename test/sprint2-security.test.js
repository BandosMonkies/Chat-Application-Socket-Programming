import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, postJson, register, request } from "./sprint2-helpers.js";

test("SV-02 and SV-04 reject invalid credentials and protected access", async () => {
  const fixture = await createFixture("chat-sprint2-security-");
  try {
    await register(fixture.baseUrl, "alice");
    const invalidLogin = await postJson(fixture.baseUrl, "/api/auth/login", {
      username: "alice",
      password: "wrong-password",
    });
    assert.equal(invalidLogin.status, 401);
    assert.deepEqual(await invalidLogin.json(), {
      ok: false,
      error: "Invalid username or password.",
    });

    const users = await request(fixture.baseUrl, "/api/users");
    assert.equal(users.status, 401);
    const chat = await request(fixture.baseUrl, "/api/chats/alice");
    assert.equal(chat.status, 401);

    const malformed = await postJson(
      fixture.baseUrl,
      "/api/auth/register",
      { username: "bad user", password: "correct-horse" },
      { Origin: "https://not-the-request-host.example" },
    );
    assert.equal(malformed.status, 403);
  } finally {
    await fixture.close();
  }
});
