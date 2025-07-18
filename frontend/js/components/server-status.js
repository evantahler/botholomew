// Server Status Component
class ServerStatus extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.refreshInterval = null;
  }

  connectedCallback() {
    this.render();
    this.loadStatus();
    this.startAutoRefresh();
  }

  disconnectedCallback() {
    this.stopAutoRefresh();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        .status {
          background: #e8f5e8;
          border: 1px solid #4caf50;
          border-radius: 10px;
          padding: 1rem;
          margin: 1rem 0;
          color: #2e7d32;
        }

        .status.error {
          background: #ffebee;
          border-color: #f44336;
          color: #c62828;
        }

        .status.loading {
          background: #e3f2fd;
          border-color: #2196f3;
          color: #1565c0;
        }

        .status-details {
          text-align: left;
          margin-top: 1rem;
          font-size: 0.9rem;
        }

        .status-details div {
          margin: 0.25rem 0;
          display: flex;
          justify-content: space-between;
        }

        .status-details .label {
          font-weight: 600;
          color: #555;
        }

        .status-details .value {
          color: #333;
        }

        .refresh-button {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          font-size: 0.8rem;
          text-decoration: underline;
          margin-left: 1rem;
        }

        .refresh-button:hover {
          opacity: 0.8;
        }
      </style>

      <div class="status" id="status-container">
        <div id="status-message">Loading server status...</div>
        <button class="refresh-button" id="refresh-btn" onclick="this.getRootNode().host.loadStatus()">
          Refresh
        </button>
        <div class="status-details" id="status-details" style="display: none">
          <!-- Status details will be populated here -->
        </div>
      </div>
    `;
  }

  async loadStatus() {
    const statusContainer = this.shadowRoot.getElementById("status-container");
    const statusMessage = this.shadowRoot.getElementById("status-message");
    const statusDetails = this.shadowRoot.getElementById("status-details");

    try {
      statusContainer.className = "status loading";
      statusMessage.textContent = "Loading server status...";

      const response = await fetch("/api/status");
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      statusContainer.className = "status";
      statusMessage.textContent = "✅ Server is running successfully";

      // Display status details dynamically
      const detailsHtml = Object.entries(data)
        .map(([key, value]) => {
          const label =
            key.charAt(0).toUpperCase() +
            key.slice(1).replace(/([A-Z])/g, " $1");
          let displayValue = value;

          // Special formatting for specific fields
          if (key === "uptime") {
            displayValue = this.formatUptime(value);
          } else if (key === "consumedMemoryMB") {
            displayValue = `${value} MB`;
          }

          return `
            <div>
              <span class="label">${label}:</span>
              <span class="value">${displayValue}</span>
            </div>
          `;
        })
        .join("");

      statusDetails.innerHTML = detailsHtml;
      statusDetails.style.display = "block";

      this.dispatchEvent(new CustomEvent("status-loaded", { detail: data }));
    } catch (error) {
      console.error("Error loading server status:", error);
      statusContainer.className = "status error";
      statusMessage.textContent = "❌ Failed to load server status";
      statusDetails.style.display = "none";

      this.dispatchEvent(new CustomEvent("status-error", { detail: error }));
    }
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  startAutoRefresh() {
    // Refresh every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.loadStatus();
    }, 30000);
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Public method to manually refresh
  refresh() {
    this.loadStatus();
  }
}

// Register the custom element
customElements.define("server-status", ServerStatus);
