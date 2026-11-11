const authView = document.querySelector("#auth-view");
const chatView = document.querySelector("#chat-view");
const authForm = document.querySelector("#auth-form");
const authStatus = document.querySelector("#auth-status");
const authSubmitLabel = document.querySelector("#auth-submit-label");
const chatStatus = document.querySelector("#chat-status");
const connectionStatus = document.querySelector("#connection-status");
const messages = document.querySelector("#messages");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector(".send-button");
const logoutButton = document.querySelector("#logout-button");
const chatList = document.querySelector("#chat-list");
const userSearch = document.querySelector("#user-search");
const activeUser = document.querySelector("#active-user");
const activeAvatar = document.querySelector("#active-avatar");

let authMode = "login";
let username = "";
let selectedUser = "";
let users = [];
let socket;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionalDisconnect = false;

function showStatus(element, message = "") { element.textContent = message; }
function setConnectionState(label, state) {
  connectionStatus.lastChild.textContent = label;
  connectionStatus.className = `connection ${state}`;
}
function setComposerEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}
function formatMessageTime(sentAt) {
  const timestamp = new Date(sentAt);
  return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function addMessage(message) {
  document.querySelector("#empty-state")?.remove();
  const item = document.createElement("article");
  item.className = `message${message.username === username ? " mine" : ""}`;
  const author = document.createElement("div");
  author.className = "message-meta";
  author.textContent = message.username === username ? "You" : message.username;
  const timestamp = document.createElement("time");
  timestamp.className = "message-time";
  timestamp.textContent = formatMessageTime(message.sentAt);
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = message.message;
  author.append(timestamp);
  item.append(author, body);
  item.dataset.sentAt = message.sentAt;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}
function renderMessages(conversation) {
  messages.replaceChildren();
  if (!conversation.length) {
    messages.innerHTML = '<div id="empty-state" class="empty-state"><span class="empty-icon">✦</span><strong>No messages yet</strong><span>Say hello to start the conversation.</span></div>';
    return;
  }
  conversation.forEach(addMessage);
}
function renderUsers() {
  const query = userSearch.value.trim().toLowerCase();
  chatList.replaceChildren(...users.filter((user) => user.includes(query)).map((user) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = `chat-list-item${user === selectedUser ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="user-avatar">${user[0].toUpperCase()}</span><span class="user-name">${user}</span>`;
    button.addEventListener("click", () => selectUser(user));
    item.append(button);
    return item;
  }));
}
async function loadUsers() {
  const response = await fetch("/api/users", { credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load users.");
  users = result.users;
  renderUsers();
  if (users.length && !selectedUser) selectUser(users[0]);
}
async function loadConversation(user) {
  const response = await fetch(`/api/chats/${encodeURIComponent(user)}`, { credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load conversation.");
  if (selectedUser === user) renderMessages(result.messages);
}
async function selectUser(user) {
  selectedUser = user;
  activeUser.textContent = user;
  activeAvatar.textContent = user[0].toUpperCase();
  messageInput.placeholder = `Message ${user}...`;
  renderUsers();
  try {
    await loadConversation(user);
    messageInput.focus();
  } catch (error) {
    showStatus(chatStatus, error.message);
  }
}
function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}
function scheduleReconnect() {
  if (intentionalDisconnect || !authView.classList.contains("hidden") || reconnectTimer) return;
  const delay = Math.min(1000 * (2 ** reconnectAttempt), 10000);
  reconnectAttempt += 1;
  showStatus(chatStatus, `Connection lost. Reconnecting in ${Math.ceil(delay / 1000)}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}
function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const currentSocket = new WebSocket(`${protocol}//${location.host}/chat`);
  socket = currentSocket;
  setConnectionState("Connecting", "");
  currentSocket.addEventListener("open", () => {
    if (currentSocket !== socket) return;
    reconnectAttempt = 0;
    setConnectionState("Connected", "online");
    showStatus(chatStatus);
    setComposerEnabled(Boolean(selectedUser));
    currentSocket.send(JSON.stringify({ op: "JOIN_CHAT" }));
  });
  currentSocket.addEventListener("message", ({ data }) => {
    if (currentSocket !== socket) return;
    const response = JSON.parse(data);
    if (response.event === "user_joined" && response.username !== username && !users.includes(response.username)) {
      users = [...users, response.username].sort();
      renderUsers();
    }
    if (response.event === "message") {
      const peer = response.username === username ? response.recipients[0] : response.username;
      if (peer === selectedUser) {
        void loadConversation(peer).catch((error) => showStatus(chatStatus, error.message));
      }
    }
    else if (response.error) showStatus(chatStatus, response.error);
  });
  currentSocket.addEventListener("close", () => {
    if (currentSocket !== socket) return;
    setComposerEnabled(false);
    setConnectionState("Disconnected", "offline");
    scheduleReconnect();
  });
  currentSocket.addEventListener("error", () => {
    if (currentSocket === socket) setConnectionState("Connection error", "offline");
  });
}
async function submitAuth(event) {
  event.preventDefault();
  showStatus(authStatus);
  const formData = new FormData(authForm);
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
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
    intentionalDisconnect = false;
    clearReconnectTimer();
    authView.classList.add("hidden");
    chatView.classList.remove("hidden");
    await loadUsers();
    connect();
  } catch (error) { showStatus(authStatus, error.message); }
}
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  authMode = tab.dataset.mode;
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  authSubmitLabel.textContent = authMode === "login" ? "Log in" : "Create account";
  document.querySelector("#password").autocomplete = authMode === "login" ? "current-password" : "new-password";
  showStatus(authStatus);
}));
authForm.addEventListener("submit", submitAuth);
userSearch.addEventListener("input", renderUsers);
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = messageInput.value.trim();
  if (!message || !selectedUser || socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ op: "SEND_MESSAGE", recipients: [selectedUser], message }));
  messageInput.value = "";
});
logoutButton.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  intentionalDisconnect = true;
  clearReconnectTimer();
  socket?.close();
  socket = null;
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  authForm.reset();
  users = [];
  selectedUser = "";
  showStatus(authStatus, "You have been logged out.");
});
