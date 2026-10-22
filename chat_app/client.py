"""Interactive command-line WebSocket client."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from getpass import getpass
from typing import Any

from websockets.asyncio.client import connect

from .protocol import validate_message, validate_username


async def run(uri: str, username: str, password: str) -> None:
    async with connect(uri) as connection:
        responses: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        async def receive() -> None:
            async for raw in connection:
                event = json.loads(raw)
                if event.get("ok") is not None:
                    await responses.put(event)
                elif event.get("event") == "message":
                    print(
                        f"[{event['timestamp']}] {event['sender']} -> "
                        f"{event['recipient']}: {event['message']}"
                    )
                elif event.get("event") in {"user_joined", "user_left"}:
                    print(f"* {event['username']} {event['event'].replace('user_', '')}")
                elif event.get("event") == "user_list":
                    print(f"* online: {', '.join(event['users']) or '(none)'}")

        receiver = asyncio.create_task(receive())

        async def request_while_connected(payload: dict[str, Any]) -> dict[str, Any]:
            await connection.send(json.dumps(payload))
            return await responses.get()

        try:
            login = await request_while_connected(
                {"op": "LOGIN", "username": username, "password": password}
            )
            if not login.get("ok"):
                raise RuntimeError(login.get("error", "login failed"))
            joined = await request_while_connected({"op": "JOIN_CHAT"})
            if not joined.get("ok"):
                raise RuntimeError(joined.get("error", "unable to join chat"))
            print("Connected. Use '/users', '/to USER MESSAGE', or '/quit'.")
            while True:
                line = await asyncio.to_thread(input, "> ")
                if line == "/quit":
                    await request_while_connected({"op": "LOGOUT"})
                    break
                if line == "/users":
                    result = await request_while_connected({"op": "USER_LIST"})
                    print(f"online: {', '.join(result.get('users', []))}")
                    continue
                recipient = "broadcast"
                message = line
                if line.startswith("/to "):
                    parts = line.split(maxsplit=2)
                    if len(parts) != 3:
                        print("Usage: /to USER MESSAGE")
                        continue
                    recipient, message = parts[1], parts[2]
                try:
                    message = validate_message(message)
                except ValueError as error:
                    print(f"error: {error}")
                    continue
                result = await request_while_connected(
                    {"op": "SEND_MESSAGE", "recipient": recipient, "message": message},
                )
                if not result.get("ok"):
                    print(f"error: {result['error']}")
        finally:
            receiver.cancel()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the chat command-line client.")
    parser.add_argument("--uri", default="ws://127.0.0.1:8765")
    parser.add_argument("--username")
    parser.add_argument("--password")
    args = parser.parse_args()
    try:
        username = validate_username(args.username or input("Username: "))
        password = args.password or getpass("Password: ")
        asyncio.run(run(args.uri, username, password))
    except (KeyboardInterrupt, EOFError):
        print()
    except (RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
