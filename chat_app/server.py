"""WebSocket chat server implementing the SRS operations."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import os
from dataclasses import dataclass
from typing import Any

from websockets.asyncio.server import ServerConnection, serve

from .protocol import (
    ProtocolError,
    timestamp,
    validate_message,
    validate_password,
    validate_request,
    validate_username,
    response,
)

LOGGER = logging.getLogger(__name__)


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, digest_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    expected = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return hmac.compare_digest(expected.hex(), digest_hex)


@dataclass(frozen=True)
class Account:
    salt: str
    digest: str


class ChatServer:
    """Owns accounts, active sessions, and recipient routing."""

    def __init__(self) -> None:
        self.accounts: dict[str, Account] = {}
        self.sessions: dict[str, ServerConnection] = {}
        self._lock = asyncio.Lock()

    async def send(self, connection: ServerConnection, payload: dict[str, Any]) -> None:
        await connection.send(json.dumps(payload))

    async def broadcast_event(self, payload: dict[str, Any], exclude: str | None = None) -> None:
        connections = [
            connection
            for username, connection in self.sessions.items()
            if username != exclude
        ]
        if connections:
            await asyncio.gather(
                *(self.send(connection, payload) for connection in connections),
                return_exceptions=True,
            )

    async def handle(self, connection: ServerConnection) -> None:
        username: str | None = None
        try:
            async for raw in connection:
                try:
                    payload = validate_request(json.loads(raw))
                    result, should_close = await self.dispatch(connection, payload, username)
                    if result.get("username"):
                        username = result["username"]
                    await self.send(connection, result)
                    if payload["op"].upper() == "JOIN_CHAT" and result.get("ok"):
                        await self.broadcast_event(
                            {
                                "event": "user_joined",
                                "username": username,
                                "timestamp": timestamp(),
                            },
                            exclude=username,
                        )
                        await self.broadcast_users()
                    if should_close:
                        break
                except (ProtocolError, ValueError, TypeError) as error:
                    await self.send(connection, response(False, error=str(error)))
        except Exception:
            LOGGER.exception("Unhandled connection error")
        finally:
            if username is not None and self.sessions.get(username) is connection:
                del self.sessions[username]
                await self.broadcast_event(
                    {"event": "user_left", "username": username, "timestamp": timestamp()}
                )
                await self.broadcast_users()

    async def dispatch(
        self,
        connection: ServerConnection,
        payload: dict[str, Any],
        current_user: str | None,
    ) -> tuple[dict[str, Any], bool]:
        operation = payload["op"].upper()
        if operation == "REGISTER":
            username = validate_username(payload.get("username"))
            password = validate_password(payload.get("password"))
            async with self._lock:
                if username in self.accounts:
                    return response(False, error="username is already registered"), False
                salt, digest = hash_password(password)
                self.accounts[username] = Account(salt, digest)
            return response(True, message="registration successful"), False

        if operation == "LOGIN":
            username = validate_username(payload.get("username"))
            password = validate_password(payload.get("password"))
            account = self.accounts.get(username)
            if account is None or not verify_password(password, account.salt, account.digest):
                return response(False, error="invalid credentials"), False
            async with self._lock:
                if username in self.sessions:
                    return response(False, error="user is already logged in"), False
                self.sessions[username] = connection
            return response(True, message="login successful", username=username), False

        if current_user is None:
            return response(False, error="authentication required"), False

        if operation == "JOIN_CHAT":
            return response(True, message="joined chat"), False

        if operation == "USER_LIST":
            return response(True, users=sorted(self.sessions)), False

        if operation == "SEND_MESSAGE":
            message = validate_message(payload.get("message"))
            recipient = payload.get("recipient", "broadcast")
            if not isinstance(recipient, str) or not recipient:
                raise ProtocolError("recipient must be a username or broadcast")
            event = {
                "event": "message",
                "sender": current_user,
                "recipient": recipient,
                "message": message,
                "timestamp": timestamp(),
            }
            if recipient == "broadcast":
                await self.broadcast_event(event)
            else:
                target = self.sessions.get(recipient)
                if target is None:
                    return response(False, error="recipient is not online"), False
                await self.send(target, event)
                if recipient != current_user:
                    await self.send(connection, event)
            return response(True, message="message delivered"), False

        if operation == "LOGOUT":
            return response(True, message="logged out"), True

        raise ProtocolError(f"unknown operation: {operation}")

    async def broadcast_users(self) -> None:
        await self.broadcast_event(
            {"event": "user_list", "users": sorted(self.sessions), "timestamp": timestamp()}
        )


async def run(host: str, port: int) -> None:
    chat_server = ChatServer()
    async with serve(chat_server.handle, host, port):
        LOGGER.info("chat server listening on ws://%s:%d", host, port)
        await asyncio.Future()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the chat WebSocket server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(run(args.host, args.port))
    except KeyboardInterrupt:
        LOGGER.info("server stopped")


if __name__ == "__main__":
    main()
