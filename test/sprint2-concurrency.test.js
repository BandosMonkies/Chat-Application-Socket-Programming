import assert from "node:assert/strict";
import test from "node:test";
import {
  connectSocket,
  createFixture,
  login,
  register,
  request,
} from "./sprint2-helpers.js";

test("TC-11 concurrent sends preserve all persisted messages and measure latency", async () => {
  const fixture = await createFixture("chat-sprint2-concurrency-");
  try {
    await register(fixture.baseUrl, "alice");
    await register(fixture.baseUrl, "bob");
    const aliceCookie = await login(fixture.baseUrl, "alice");
    const socket = await connectSocket(fixture.serverUrl, aliceCookie);
    const messageCount = 20;
    const startedAt = performance.now();
    const received = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.event === "message") received.push(message);
    });
    for (let index = 0; index < messageCount; index += 1) {
      socket.send(JSON.stringify({
        op: "SEND_MESSAGE",
        recipients: ["bob"],
        message: `concurrent-${index}`,
      }));
    }
    while (received.length < messageCount) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const elapsedMs = performance.now() - startedAt;
    assert.equal(new Set(received.map((message) => message.message)).size, messageCount);
    const response = await request(fixture.baseUrl, "/api/chats/bob", {
      headers: { Cookie: aliceCookie },
    });
    const history = await response.json();
    assert.equal(history.messages.length, messageCount);
    console.log(`SPRINT2_LATENCY messages=${messageCount} elapsed_ms=${elapsedMs.toFixed(2)}`);
    socket.close();
  } finally {
    await fixture.close();
  }
});
