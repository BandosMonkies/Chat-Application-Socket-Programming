import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sqlite3 from "sqlite3";

export class ChatDatabase {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.database = null;
  }

  async open() {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.database = await new Promise((resolveOpen, rejectOpen) => {
      const database = new sqlite3.Database(this.filePath, (error) =>
        error ? rejectOpen(error) : resolveOpen(database),
      );
    });
    await this.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        message TEXT NOT NULL,
        sent_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation_idx
        ON messages(sender, recipient, sent_at);
    `);
    return this;
  }

  close() {
    this.database?.close();
    this.database = null;
  }

  exec(sql) {
    return new Promise((resolveExec, rejectExec) => {
      this.database.exec(sql, (error) => (error ? rejectExec(error) : resolveExec()));
    });
  }

  run(sql, ...params) {
    return new Promise((resolveRun, rejectRun) => {
      this.database.run(sql, params, function onRun(error) {
        if (error) rejectRun(error);
        else resolveRun(this);
      });
    });
  }

  all(sql, ...params) {
    return new Promise((resolveAll, rejectAll) => {
      this.database.all(sql, params, (error, rows) =>
        error ? rejectAll(error) : resolveAll(rows),
      );
    });
  }

  addUser(username) {
    return this.run(
      "INSERT OR IGNORE INTO users (username, created_at) VALUES (?, ?)",
      username,
      new Date().toISOString(),
    );
  }

  async listUsers(currentUsername) {
    const rows = await this.all(
      "SELECT username FROM users WHERE username <> ? ORDER BY username",
      currentUsername,
    );
    return rows.map(({ username }) => username);
  }

  async getConversation(currentUsername, otherUsername) {
    const rows = await this.all(`
        SELECT sender, recipient, message, sent_at
        FROM messages
        WHERE (sender = ? AND recipient = ?)
           OR (sender = ? AND recipient = ?)
        ORDER BY sent_at ASC, id ASC
      `, currentUsername, otherUsername, otherUsername, currentUsername);
    return rows.map((row) => ({
        username: row.sender,
        recipient: row.recipient,
        message: row.message,
        sentAt: row.sent_at,
      }));
  }

  saveMessage(sender, recipient, message, sentAt) {
    return this.run(
      "INSERT INTO messages (sender, recipient, message, sent_at) VALUES (?, ?, ?, ?)",
      sender,
      recipient,
      message,
      sentAt,
    );
  }
}
