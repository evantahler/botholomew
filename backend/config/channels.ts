import { loadFromEnvIfSet } from "keryx";

export const configChannels = {
  presenceTTL: await loadFromEnvIfSet("PRESENCE_TTL", 90),
  presenceHeartbeatInterval: await loadFromEnvIfSet(
    "PRESENCE_HEARTBEAT_INTERVAL",
    30,
  ),
};
