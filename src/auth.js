import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE = "chat_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 128;
const KEY_LENGTH = 64;
const UNKNOWN_ACCOUNT_SALT = randomBytes(16);
const UNKNOWN_ACCOUNT_HASH = randomBytes(KEY_LENGTH).toString("hex");
const SCRYPT_OPTIONS = {
  N: 2 ** 14,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

export class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
  }
}

export function normalizeUsername(value) {
  if (typeof value !== "string" || !USERNAME_PATTERN.test(value)) {
    throw new AuthError(
      400,
      "Username must be 3-32 characters using letters, numbers, or underscores.",
    );
  }

  return value.toLowerCase();
}

function validatePassword(value) {
  const passwordBytes =
    typeof value === "string" ? Buffer.byteLength(value, "utf8") : 0;

  if (
    typeof value !== "string" ||
    passwordBytes < MIN_PASSWORD_LENGTH ||
    passwordBytes > MAX_PASSWORD_BYTES
  ) {
    throw new AuthError(400, "Password must be 8-128 bytes.");
  }

  return value;
}

async function hashPassword(password, salt = randomBytes(16)) {
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);

  return {
    salt: salt.toString("hex"),
    passwordHash: derivedKey.toString("hex"),
  };
}

function sessionKey(token) {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthService {
  constructor({ accountStore, sessionTtlMs = SESSION_TTL_MS }) {
    this.accountStore = accountStore;
    this.sessionTtlMs = sessionTtlMs;
    this.sessions = new Map();
    this.sessionSockets = new Map();
    this.accountWriteQueue = Promise.resolve();
  }

  async register(usernameInput, passwordInput) {
    const username = normalizeUsername(usernameInput);
    const password = validatePassword(passwordInput);
    const { salt, passwordHash } = await hashPassword(password);

    const registerAccount = async () => {
      const accounts = await this.accountStore.read();

      if (Object.hasOwn(accounts, username)) {
        throw new AuthError(409, "Username is already registered.");
      }

      accounts[username] = { salt, passwordHash };
      await this.accountStore.write(accounts);
    };

    const pendingWrite = this.accountWriteQueue.then(registerAccount);
    this.accountWriteQueue = pendingWrite.catch(() => {});
    await pendingWrite;

    return { username };
  }

  async login(usernameInput, passwordInput) {
    const username = normalizeUsername(usernameInput);
    const password = validatePassword(passwordInput);
    const accounts = await this.accountStore.read();
    const account = Object.hasOwn(accounts, username)
      ? accounts[username]
      : null;

    const { passwordHash } = await hashPassword(
      password,
      account ? Buffer.from(account.salt, "hex") : UNKNOWN_ACCOUNT_SALT,
    );
    const actual = Buffer.from(passwordHash, "hex");
    const expected = Buffer.from(
      account?.passwordHash ?? UNKNOWN_ACCOUNT_HASH,
      "hex",
    );

    if (
      !account ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new AuthError(401, "Invalid username or password.");
    }

    const token = randomBytes(32).toString("hex");
    const key = sessionKey(token);

    this.sessions.set(key, {
      username,
      expiresAt: Date.now() + this.sessionTtlMs,
    });

    return { token, username };
  }

  getSession(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return null;
    }

    const key = sessionKey(token);
    const session = this.sessions.get(key);

    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.revokeSession(token);
      return null;
    }

    return { key, username: session.username };
  }

  revokeSession(token) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
      return false;
    }

    const key = sessionKey(token);
    const existed = this.sessions.delete(key);
    const sockets = this.sessionSockets.get(key);

    if (sockets) {
      for (const socket of sockets) {
        if (socket.readyState === socket.OPEN) {
          socket.close(1008, "Session ended");
        }
      }
      this.sessionSockets.delete(key);
    }

    return existed;
  }

  attachSocket(sessionKeyValue, socket) {
    let sockets = this.sessionSockets.get(sessionKeyValue);

    if (!sockets) {
      sockets = new Set();
      this.sessionSockets.set(sessionKeyValue, sockets);
    }

    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.sessionSockets.delete(sessionKeyValue);
      }
    });
  }
}
