import { loadFromEnvIfSet } from "keryx";

export const configRedis = {
  connectionString: await loadFromEnvIfSet(
    "REDIS_URL",
    "redis://localhost:6379/0",
  ),
};
