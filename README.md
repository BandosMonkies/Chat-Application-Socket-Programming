# Real-Time Chat Application

Minimal client/server WebSocket implementation for the chat application described in
the SRS and architecture specification.

## Implementation decisions

- **Stack:** Python 3.11+ and the `websockets` package.
- **Transport:** WebSocket over `ws://` (the server defaults to `127.0.0.1:8765`).
- **Architecture:** layered client/server responsibilities. The server owns authentication,
  connection/session state, validation, and message routing; the client owns the
  command-line interface and rendering events.
- **Recipients:** messages use `broadcast` for every connected user or a username for
  one-to-one delivery. Direct messages are echoed to the sender and delivered once to
  the online recipient.
- **Persistence:** this bootstrap uses an in-memory user/session store. Restarting the
  server clears registered accounts; persistent storage can be added without changing
  the WebSocket operations.

## Requirements

- Python 3.11 or newer
- A network connection to the server (localhost is sufficient for development)

## Setup

```bash
git clone <repository-url>
cd Chat-Application-Socket-Programming
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
```

## Run the server

```bash
python -m chat_app.server
```

Use `--host` and `--port` to expose a controlled network instance, for example:

```bash
python -m chat_app.server --host 0.0.0.0 --port 8765
```

## Register and run a client

Registration is a protocol operation, so use a short Python snippet once per account:

```bash
python - <<'PY'
import asyncio, json
from websockets.asyncio.client import connect

async def register():
    async with connect("ws://127.0.0.1:8765") as socket:
        await socket.send(json.dumps({
            "op": "REGISTER", "username": "alice", "password": "correct-horse"
        }))
        print(await socket.recv())

asyncio.run(register())
PY
```

Then start one or more clients in separate terminals:

```bash
python -m chat_app.client --username alice
```

Client commands:

- Enter text to broadcast it to all online users.
- `/to USER MESSAGE` sends a direct message.
- `/users` displays the current online-user list.
- `/quit` logs out and closes the connection.

## Protocol operations

The JSON operations are `REGISTER`, `LOGIN`, `JOIN_CHAT`, `SEND_MESSAGE`,
`USER_LIST`, and `LOGOUT`. Successful messages include an ISO-8601 UTC timestamp.
Invalid credentials, unauthenticated operations, empty/oversized messages, unknown
recipients, and malformed requests receive an explicit error response.

## Tests

```bash
python -m unittest discover -s tests -v
```
