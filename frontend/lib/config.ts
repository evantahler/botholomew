// Server configuration
// Always uses NEXT_PUBLIC_SERVER_HOSTNAME for all requests
export const SERVER_HOSTNAME =
  process.env.NEXT_PUBLIC_SERVER_HOSTNAME || "http://localhost:8080";

// Helper function to get WebSocket URL
// Always uses the configured SERVER_HOSTNAME
export const getWebSocketUrl = (): string => {
  return SERVER_HOSTNAME.replace(/^http/, "ws") + "/ws";
};

// Helper function to get API URL
// Always uses the configured SERVER_HOSTNAME
export const getApiUrl = (endpoint: string): string => {
  return `${SERVER_HOSTNAME}${endpoint}`;
};
