// Message Log Component
class MessageLog extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.messages = [];
    this.maxMessages = 100; // Limit to prevent memory issues
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .messages {
          border: 1px solid #ccc;
          padding: 10px;
          height: 300px;
          overflow-y: auto;
          background: #f8f9fa;
          border-radius: 8px;
          margin: 1rem 0;
        }

        .message {
          padding: 0.5rem;
          margin: 0.25rem 0;
          border-radius: 4px;
          background: white;
          border-left: 3px solid #667eea;
          font-family: monospace;
          font-size: 0.9rem;
          word-break: break-word;
        }

        .message.error {
          border-left-color: #dc3545;
          background: #fff5f5;
        }

        .message.success {
          border-left-color: #28a745;
          background: #f8fff8;
        }

        .message.warning {
          border-left-color: #ffc107;
          background: #fffbf0;
        }

        .message-time {
          color: #666;
          font-size: 0.8rem;
          margin-bottom: 0.25rem;
        }

        .message-content {
          white-space: pre-wrap;
        }

        .controls {
          margin-bottom: 1rem;
        }

        .clear-btn {
          background: #6c757d;
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.9rem;
        }

        .clear-btn:hover {
          background: #5a6268;
        }

        .message-count {
          margin-left: 1rem;
          color: #666;
          font-size: 0.9rem;
        }
      </style>

      <div class="controls">
        <button class="clear-btn" id="clear-btn">Clear Messages</button>
        <span class="message-count" id="message-count">0 messages</span>
      </div>
      <div class="messages" id="messages-container">
        <!-- Messages will be added here -->
      </div>
    `;

    // Add event listeners
    this.shadowRoot
      .getElementById("clear-btn")
      .addEventListener("click", () => {
        this.clear();
      });
  }

  addMessage(content, type = "info", timestamp = new Date()) {
    const message = {
      content,
      type,
      timestamp,
      id: Date.now() + Math.random(),
    };

    this.messages.push(message);

    // Limit the number of messages
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    this.renderMessages();
    this.updateMessageCount();

    // Dispatch event for external listeners
    this.dispatchEvent(new CustomEvent("message-added", { detail: message }));

    return message.id;
  }

  addErrorMessage(content) {
    return this.addMessage(content, "error");
  }

  addSuccessMessage(content) {
    return this.addMessage(content, "success");
  }

  addWarningMessage(content) {
    return this.addMessage(content, "warning");
  }

  renderMessages() {
    const container = this.shadowRoot.getElementById("messages-container");

    container.innerHTML = this.messages
      .map(
        (message) => `
      <div class="message ${message.type}" data-message-id="${message.id}">
        <div class="message-time">${message.timestamp.toLocaleTimeString()}</div>
        <div class="message-content">${this.escapeHtml(message.content)}</div>
      </div>
    `,
      )
      .join("");

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  updateMessageCount() {
    const countElement = this.shadowRoot.getElementById("message-count");
    countElement.textContent = `${this.messages.length} message${this.messages.length !== 1 ? "s" : ""}`;
  }

  clear() {
    this.messages = [];
    this.renderMessages();
    this.updateMessageCount();
    this.dispatchEvent(new CustomEvent("messages-cleared"));
  }

  removeMessage(messageId) {
    const index = this.messages.findIndex((msg) => msg.id === messageId);
    if (index !== -1) {
      this.messages.splice(index, 1);
      this.renderMessages();
      this.updateMessageCount();
      this.dispatchEvent(
        new CustomEvent("message-removed", { detail: { messageId } }),
      );
    }
  }

  getMessages() {
    return [...this.messages];
  }

  getMessageCount() {
    return this.messages.length;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Public method to set max messages
  setMaxMessages(max) {
    this.maxMessages = max;
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
      this.renderMessages();
      this.updateMessageCount();
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Register the custom element
customElements.define("message-log", MessageLog);
