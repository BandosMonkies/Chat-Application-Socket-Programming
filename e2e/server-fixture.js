import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.js";

const directory = await mkdtemp(join(tmpdir(), "chat-e2e-"));
const app = await startServer({
  host: "127.0.0.1",
  port: 8765,
  accountFile: join(directory, "users.json"),
  databaseFile: join(directory, "chat.db"),
  secureCookies: false,
});

async function shutdown() {
  for (const socket of app.webSocketServer.clients) socket.terminate();
  app.webSocketServer.close();
  await new Promise((resolve, reject) => {
    app.httpServer.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(directory, { recursive: true, force: true });
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit()));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit()));
