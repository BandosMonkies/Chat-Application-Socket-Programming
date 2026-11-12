import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { startServer } from "../src/server.js";
import {
  connectSocket,
  createFixture,
  login,
  register,
  request,
  waitForMessage,
} from "./sprint2-helpers.js";

test("TC-07 database persistence survives server restart", async () => {
  const fixture = await createFixture("chat-sprint2-db-");
  let aliceCookie;
  try {
    await register(fixture.baseUrl, "alice");
    await register(fixture.baseUrl, "bob");
    aliceCookie = await login(fixture.baseUrl, "alice");
    const socket = await connectSocket(fixture.serverUrl, aliceCookie);
    socket.send(JSON.stringify({
      op: "SEND_MESSAGE",
      recipients: ["bob"],
      message: "Persist this message",
    }));
    const sent = await waitForMessage(socket, (message) => message.event === "message");
    assert.equal(sent.message, "Persist this message");
    socket.close();

    const databaseFile = `${fixture.directory}\\chat.db`;
    const accountFile = `${fixture.directory}\\users.json`;
    await fixture.close(false);
    const restarted = await startServer({
      host: "127.0.0.1",
      port: 0,
      accountFile,
      databaseFile,
      secureCookies: false,
    });
    try {
      const address = restarted.httpServer.address();
      const restartedUrl = `http://127.0.0.1:${address.port}`;
      const response = await request(restartedUrl, "/api/chats/bob", {
        headers: { Cookie: await login(restartedUrl, "alice") },
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.messages[0].message, "Persist this message");
    } finally {
      restarted.webSocketServer.close();
      await new Promise((resolve, reject) => {
        restarted.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await rm(fixture.directory, { recursive: true, force: true });
    }
  } finally {
    if (fixture.app.httpServer.listening) await fixture.close();
  }
});
