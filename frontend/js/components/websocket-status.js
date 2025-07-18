// WebSocket Status Component
class WebSocketStatus extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.connected = false;
    this.ws = null;
    this.reconnectInterval = null;
  }

  connectedCallback() {
    this.render();
    this.connect();
  }

  disconnectedCallback() {
    this.disconnect();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          margin-top: 2rem;
          padding: 1rem;
          border-radius: 8px;
          background: #f5f5f5;
          font-family: inherit;
        }

        .connected {
          background: #e8f5e8;
          color: #2e7d32;
        }

        .disconnected {
          background: #ffebee;
          color: #c62828;
        }

        .status-text {
          font-weight: bold;
        }

        .connection-details {
          margin-top: 0.5rem;
          font-size: 0.9rem;
          opacity: 0.8;
        }
      </style>

      <div class="status-text">
        WebSocket Status: <span id="connection-status">Connecting...</span>
      </div>
      <div class="connection-details" id="connection-details"></div>
    `;
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.updateStatus("Connected", "connected");
      this.updateDetails("Ready to receive messages");
      this.dispatchEvent(new CustomEvent("websocket-connected"));
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.updateStatus("Disconnected", "disconnected");
      this.updateDetails("Connection lost. Attempting to reconnect...");
      this.dispatchEvent(new CustomEvent("websocket-disconnected"));

      // Try to reconnect after 5 seconds
      if (this.reconnectInterval) {
        clearTimeout(this.reconnectInterval);
      }
      this.reconnectInterval = setTimeout(() => this.connect(), 5000);
    };

    this.ws.onerror = (error) => {
      this.connected = false;
      this.updateStatus("Connection Error", "disconnected");
      this.updateDetails("Failed to establish connection");
      this.dispatchEvent(new CustomEvent("websocket-error", { detail: error }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.dispatchEvent(
          new CustomEvent("websocket-message", { detail: data }),
        );
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }
  }

  updateStatus(text, className) {
    const statusElement = this.shadowRoot.getElementById("connection-status");
    const container = this.shadowRoot.querySelector("div");

    statusElement.textContent = text;
    container.className = `status-text ${className}`;
  }

  updateDetails(text) {
    const detailsElement = this.shadowRoot.getElementById("connection-details");
    detailsElement.textContent = text;
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  isConnected() {
    return this.connected;
  }
}

// Register the custom element
customElements.define("websocket-status", WebSocketStatus);
