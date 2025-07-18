// Component loader for Botholomew frontend
// This file makes components available globally

// Make components available globally for browser usage
window.BotholomewComponents = {
  WebSocketStatus: customElements.get("websocket-status"),
  ServerStatus: customElements.get("server-status"),
  MessageLog: customElements.get("message-log"),
};

console.log(
  "Botholomew components loaded:",
  Object.keys(window.BotholomewComponents),
);
