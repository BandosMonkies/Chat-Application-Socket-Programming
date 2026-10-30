import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { AuthError, AuthService, SESSION_COOKIE } from "./auth.js";

const DEFAULT_HOST = process.env.HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.PORT ?? 8765);
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SOCKET_FRAME_BYTES = 16 * 1024;
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
const PUBLIC_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC_FILES = new Map([
  ["/", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { name: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { name: "styles.css", type: "text/css; charset=utf-8" }],
  ["/client.js", { name: "client.js", type: "text/javascript; charset=utf-8" }],
]);

export class JsonAccountStore {
  constructor(filePath) {
    this.filePath = resolve(filePath);
  }

  async read() {
    try {
      const contents = await readFile(this.filePath, "utf8");
      const accounts = JSON.parse(contents);

      if (
        accounts === null ||
        typeof accounts !== "object" ||
        Array.isArray(accounts)
      ) {
        throw new Error("The account store must contain a JSON object.");
      }

      const validatedAccounts = Object.create(null);
      for (const [username, account] of Object.entries(accounts)) {
        if (
          typeof account !== "object" ||
          account === null ||
          Array.isArray(account) ||
          !/^[a-f0-9]{32}$/.test(account.salt) ||
          !/^[a-f0-9]{128}$/.test(account.passwordHash)
        ) {
          throw new Error(`The account record for ${username} is invalid.`);
        }

        validatedAccounts[username] = {
          salt: account.salt,
          passwordHash: account.passwordHash,
        };
      }

      return validatedAccounts;
    } catch (error) {
      if (error.code === "ENOENT") {
        return Object.create(null);
      }

      throw error;
    }
  }

  async write(accounts) {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });

    const temporaryPath = `${this.filePath}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      await writeFile(temporaryPath, JSON.stringify(accounts, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await unlink(temporaryPath).catch((cleanupError) => {
        if (cleanupError.code !== "ENOENT") {
          throw cleanupError;
        }
      });
      throw error;
    }
  }
}

function readCookie(request, cookieName) {
  const cookieHeader = request.headers.cookie;

  if (typeof cookieHeader !== "string") {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    if (name === cookieName) {
      return cookie.slice(separatorIndex + 1).trim();
    }
  }

  return null;
}

function sessionCookie(token, secure) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearedSessionCookie(secure) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];

  if (secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"];
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    throw new AuthError(415, "Content-Type must be application/json.");
  }

  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new AuthError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected a JSON object.");
    }
    return body;
  } catch {
    throw new AuthError(400, "Request body must be a valid JSON object.");
  }
}

function originMatchesHost(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function getSessionFromRequest(request, authService) {
  return authService.getSession(readCookie(request, SESSION_COOKIE));
}

async function serveStaticFile(url, response) {
  const file = STATIC_FILES.get(url.pathname);
  if (!file) {
    return false;
  }

  try {
    const contents = await readFile(resolve(PUBLIC_DIRECTORY, file.name));
    response.writeHead(200, {
      "Content-Type": file.type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
  } catch (error) {
    console.error("Static client could not be served:", error);
    sendJson(response, 500, {
      ok: false,
      error: "The client could not be served.",
    });
  }

  return true;
}

async function handleHttpRequest(
  request,
  response,
  { authService, secureCookies },
) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && (await serveStaticFile(url, response))) {
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (!url.pathname.startsWith("/api/auth/")) {
    sendJson(response, 404, { ok: false, error: "Not found." });
    return;
  }

  if (!originMatchesHost(request)) {
    sendJson(response, 403, { ok: false, error: "Cross-origin request denied." });
    return;
  }

  try {
    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await readJsonBody(request);
      const account = await authService.register(body.username, body.password);
      sendJson(response, 201, { ok: true, username: account.username });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJsonBody(request);
      const session = await authService.login(body.username, body.password);
      sendJson(
        response,
        200,
        { ok: true, username: session.username },
        { "Set-Cookie": sessionCookie(session.token, secureCookies) },
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = readCookie(request, SESSION_COOKIE);
      const session = getSessionFromRequest(request, authService);

      if (!session) {
        sendJson(
          response,
          401,
          { ok: false, error: "Authentication required." },
          { "Set-Cookie": clearedSessionCookie(secureCookies) },
        );
        return;
      }

      authService.revokeSession(token);
      sendJson(
        response,
        200,
        { ok: true, message: "Logged out." },
        { "Set-Cookie": clearedSessionCookie(secureCookies) },
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      const session = getSessionFromRequest(request, authService);
      if (!session) {
        sendJson(response, 401, {
          ok: false,
          error: "Authentication required.",
        });
        return;
      }

      sendJson(response, 200, { ok: true, username: session.username });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(response, error.statusCode, { ok: false, error: error.message });
      return;
    }

    console.error("Authentication request failed:", error);
    sendJson(response, 500, {
      ok: false,
      error: "The request could not be completed.",
    });
  }
}

function parseSocketRequest(socket, raw, authService, webSocketServer) {
  const currentSession = authService.getSession(socket.chatSessionToken);
  if (!currentSession || currentSession.key !== socket.chatSession.key) {
    socket.send(JSON.stringify({ ok: false, error: "Authentication required." }));
    socket.close(1008, "Authentication required");
    return;
  }

  if (raw.length > MAX_SOCKET_FRAME_BYTES) {
    socket.close(1009, "Request is too large");
    return;
  }

  let request;
  try {
    request = JSON.parse(raw.toString("utf8"));
  } catch {
    socket.send(JSON.stringify({ ok: false, error: "Invalid JSON request." }));
    return;
  }

  if (
    request === null ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    typeof request.op !== "string"
  ) {
    socket.send(
      JSON.stringify({
        ok: false,
        error: "Request must be an object with an operation.",
      }),
    );
    return;
  }

  const operation = request.op.toUpperCase();

  if (operation === "JOIN_CHAT") {
    const wasOnline = getUserSockets(webSocketServer, socket.chatSession.username).size > 0;
    if (socket.chatJoined) {
      socket.send(
        JSON.stringify({
          ok: true,
          event: "user_list",
          users: getOnlineUsers(webSocketServer),
        }),
      );
      return;
    }

    socket.chatJoined = true;
    socket.send(
      JSON.stringify({
        ok: true,
        event: "chat_joined",
        username: socket.chatSession.username,
      }),
    );
    socket.send(
      JSON.stringify({
        ok: true,
        event: "user_list",
        users: getOnlineUsers(webSocketServer),
      }),
    );
    if (!wasOnline) {
      broadcastToJoined(
        webSocketServer,
        {
          ok: true,
          event: "user_joined",
          username: socket.chatSession.username,
        },
        socket,
      );
    }
    broadcastToJoined(webSocketServer, {
      ok: true,
      event: "user_list",
      users: getOnlineUsers(webSocketServer),
    });
    return;
  }

  if (operation === "LOGOUT") {
    socket.send(
      JSON.stringify({ ok: true, message: "Logged out." }),
      () => authService.revokeSession(socket.chatSessionToken),
    );
    return;
  }

  if (operation === "REGISTER" || operation === "LOGIN") {
    socket.send(
      JSON.stringify({
        ok: false,
        error: "Use the /api/auth/register and /api/auth/login HTTP endpoints.",
      }),
    );
    return;
  }

  if (operation === "SEND_MESSAGE") {
    if (typeof request.message !== "string" || request.message.trim().length === 0) {
      socket.send(JSON.stringify({ ok: false, error: "Message cannot be empty." }));
      return;
    }

    const message = request.message.trim();
    if (message.length > 2000) {
      socket.send(
        JSON.stringify({ ok: false, error: "Message must be 2000 characters or fewer." }),
      );
      return;
    }

    const payload = JSON.stringify({
      ok: true,
      event: "message",
      username: socket.chatSession.username,
      message,
      sentAt: new Date().toISOString(),
    });

    for (const client of webSocketServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
    return;
  }

  if (operation === "USER_LIST") {
    socket.send(
      JSON.stringify({
        ok: true,
        event: "user_list",
        users: getOnlineUsers(webSocketServer),
      }),
    );
    return;
  }

  socket.send(
    JSON.stringify({ ok: false, error: `Unknown operation: ${operation}` }),
  );
}

function getUserSockets(webSocketServer, username) {
  const sockets = new Set();
  for (const client of webSocketServer.clients) {
    if (
      client.readyState === WebSocket.OPEN &&
      client.chatJoined &&
      client.chatSession.username === username
    ) {
      sockets.add(client);
    }
  }
  return sockets;
}

function getOnlineUsers(webSocketServer) {
  return [...new Set(
    [...webSocketServer.clients]
      .filter(
        (client) =>
          client.readyState === WebSocket.OPEN &&
          client.chatJoined,
      )
      .map((client) => client.chatSession.username),
  )].sort();
}

function broadcastToJoined(webSocketServer, message, excludedSocket = null) {
  const payload = JSON.stringify(message);
  for (const client of webSocketServer.clients) {
    if (
      client !== excludedSocket &&
      client.readyState === WebSocket.OPEN &&
      client.chatJoined
    ) {
      client.send(payload);
    }
  }
}

function removeSocketFromChat(socket, webSocketServer) {
  if (!socket.chatJoined) {
    return;
  }

  socket.chatJoined = false;
  const username = socket.chatSession.username;
  const remainingSockets = getUserSockets(webSocketServer, username);
  if (remainingSockets.size === 0) {
    broadcastToJoined(webSocketServer, {
      ok: true,
      event: "user_left",
      username,
    });
  }
  broadcastToJoined(webSocketServer, {
    ok: true,
    event: "user_list",
    users: getOnlineUsers(webSocketServer),
  });
}

export function createAppServer({
  accountFile = resolve("data", "users.json"),
  sessionTtlMs,
  secureCookies = process.env.NODE_ENV === "production",
} = {}) {
  const accountStore = new JsonAccountStore(accountFile);
  const authService = new AuthService({ accountStore, sessionTtlMs });
  const httpServer = createHttpServer((request, response) => {
    void handleHttpRequest(request, response, { authService, secureCookies });
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_SOCKET_FRAME_BYTES,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const session = getSessionFromRequest(request, authService);

    if (
      url.pathname !== "/chat" ||
      !originMatchesHost(request) ||
      !session
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.chatSession = session;
      webSocket.chatSessionToken = readCookie(request, SESSION_COOKIE);
      authService.attachSocket(session.key, webSocket);
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    socket.on("message", (raw) => {
      parseSocketRequest(socket, raw, authService, webSocketServer);
    });
    socket.once("close", () => {
      removeSocketFromChat(socket, webSocketServer);
    });
  });

  return {
    authService,
    httpServer,
    webSocketServer,
  };
}

export async function startServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  accountFile,
  secureCookies,
} = {}) {
  const app = createAppServer({ accountFile, secureCookies });

  await new Promise((resolveListen, rejectListen) => {
    app.httpServer.once("error", rejectListen);
    app.httpServer.listen(port, host, () => {
      app.httpServer.removeListener("error", rejectListen);
      resolveListen();
    });
  });

  return app;
}

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  startServer()
    .then(({ httpServer }) => {
      const address = httpServer.address();
      console.log(`Chat server listening on http://${address.address}:${address.port}`);
      console.log(`Account store: ${resolve(process.env.ACCOUNT_FILE ?? "data/users.json")}`);
    })
    .catch((error) => {
      console.error("Could not start the chat server:", error);
      process.exitCode = 1;
    });
}
