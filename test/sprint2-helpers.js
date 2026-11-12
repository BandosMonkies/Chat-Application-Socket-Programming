import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../src/server.js";

export async function createFixture(prefix = "chat-sprint2-") {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const app = await startServer({
    host: "127.0.0.1",
    port: 0,
    accountFile: join(directory, "users.json"),
    databaseFile: join(directory, "chat.db"),
    secureCookies: false,
  });
  const address = app.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const serverUrl = `ws://127.0.0.1:${address.port}`;

  return {
    app,
    directory,
    baseUrl,
    serverUrl,
    async close(removeDirectory = true) {
      for (const socket of app.webSocketServer.clients) socket.terminate();
      app.webSocketServer.close();
      await new Promise((resolve, reject) => {
        app.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      if (removeDirectory) await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export async function register(baseUrl, username) {
  const response = await postJson(baseUrl, "/api/auth/register", {
    username,
    password: "correct-horse",
  });
  if (response.status !== 201) throw new Error(`Registration failed: ${response.status}`);
}

export async function login(baseUrl, username) {
  const response = await postJson(baseUrl, "/api/auth/login", {
    username,
    password: "correct-horse",
  });
  if (response.status !== 200) throw new Error(`Login failed: ${response.status}`);
  return response.headers.get("set-cookie").split(";")[0];
}

export function connectSocket(serverUrl, cookie) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${serverUrl}/chat`, { headers: { Cookie: cookie } });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function waitForMessage(socket, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (!predicate(message)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    }
    socket.on("message", onMessage);
  });
}

export function request(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}
