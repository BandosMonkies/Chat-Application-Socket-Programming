const authView = document.querySelector("#auth-view");
const chatView = document.querySelector("#chat-view");
const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const authSubmitLabel = document.querySelector("#auth-submit-label");
const chatStatus = document.querySelector("#chat-status");
const connectionStatus = document.querySelector("#connection-status");
const messages = document.querySelector("#messages");
const emptyState = document.querySelector("#empty-state");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector(".send-button");
const logoutButton = document.querySelector("#logout-button");
const onlineCount = document.querySelector("#online-count");
const onlineUsers = document.querySelector("#online-users");

let authMode = "login";
let username = "";
let socket;

function showStatus(element, message = "") {
  element.textContent = message;
}

function setConnectionState(label, state) {
  connectionStatus.lastChild.textContent = label;
  connectionStatus.className = `connection ${state}`;
}

function setComposerEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function addMessage(message) {
  emptyState?.remove();
  const item = document.createElement("article");
  item.className = `message${message.username === username ? " mine" : ""}`;
  const author = document.createElement("div");
  author.className = "message-meta";
  author.textContent = message.username === username ? "You" : message.username;
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message.message;
  item.append(author, body);
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function addActivity(message) {
  emptyState?.remove();
  const item = document.createElement("article");
  item.className = "activity";
  item.textContent = message;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function renderOnlineUsers(users) {
  onlineCount.textContent = String(users.length);
  onlineUsers.replaceChildren(
    ...users.map((user) => {
      const item = document.createElement("li");
      item.textContent = user === username ? `${user} (you)` : user;
      return item;
    }),
  );
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/chat`);
  setConnectionState("Connecting", "");

  socket.addEventListener("open", () => {
    setConnectionState("Connected", "online");
    showStatus(chatStatus);
    setComposerEnabled(true);
    socket.send(JSON.stringify({ op: "JOIN_CHAT" }));
    messageInput.focus();
  });

  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.event === "message") {
      addMessage(response);
    } else if (response.event === "user_list") {
      renderOnlineUsers(response.users);
    } else if (response.event === "user_joined") {
      addActivity(`${response.username} joined the chat.`);
    } else if (response.event === "user_left") {
      addActivity(`${response.username} left the chat.`);
    } else if (response.event === "chat_joined") {
      showStatus(chatStatus);
    } else if (response.message === "Logged out.") {
      showStatus(chatStatus);
    } else if (response.error) {
      showStatus(chatStatus, response.error);
    }
  });

  socket.addEventListener("close", () => {
    setComposerEnabled(false);
    setConnectionState("Disconnected", "offline");
    if (!authView.classList.contains("hidden")) return;
    showStatus(chatStatus, "Connection lost. Log in again to reconnect.");
  });

  socket.addEventListener("error", () => {
    setConnectionState("Connection error", "offline");
  });
}

async function submitAuth(event) {
  event.preventDefault();
  showStatus(authStatus);
  const formData = new FormData(authForm);
  const endpoint = authMode === "login" ? "login" : "register";

  try {
    const response = await fetch(`/api/auth/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Authentication failed.");
    if (authMode === "register") {
      authMode = "login";
      document.querySelector('[data-mode="login"]').click();
      showStatus(authStatus, "Account created. You can now log in.");
      return;
    }
    username = result.username;
    authView.classList.add("hidden");
    chatView.classList.remove("hidden");
    connect();
  } catch (error) {
    showStatus(authStatus, error.message);
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
    authSubmitLabel.textContent = authMode === "login" ? "Log in" : "Create account";
    document.querySelector("#password").autocomplete = authMode === "login" ? "current-password" : "new-password";
    showStatus(authStatus);
  });
});

authForm.addEventListener("submit", submitAuth);
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ op: "SEND_MESSAGE", message }));
  messageInput.value = "";
});
logoutButton.addEventListener("click", () => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ op: "LOGOUT" }));
  }
  socket?.close();
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  authForm.reset();
  showStatus(authStatus, "You have been logged out.");
});
