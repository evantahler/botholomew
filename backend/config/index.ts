import { configActions } from "./actions";
import { configAudit } from "./audit";
import { configChannels } from "./channels";
import { configDatabase } from "./database";
import { configLogger } from "./logger";
import { configObservability } from "./observability";
import { configPlugins } from "./plugins";
import { configProcess } from "./process";
import { configRateLimit } from "./rateLimit";
import { configRedis } from "./redis";
import { configSecrets } from "./secrets";
import { configSentry } from "./sentry";
import { configServerCli } from "./server/cli";
import { configServerMcp } from "./server/mcp";
import { configServerWeb } from "./server/web";
import { configSession } from "./session";
import { configTasks } from "./tasks";

export default {
  plugins: configPlugins,
  actions: configActions,
  channels: configChannels,
  process: configProcess,
  logger: configLogger,
  database: configDatabase,
  observability: configObservability,
  redis: configRedis,
  rateLimit: configRateLimit,
  session: configSession,
  server: { cli: configServerCli, web: configServerWeb, mcp: configServerMcp },
  tasks: configTasks,
  audit: configAudit,
  secrets: configSecrets,
  sentry: configSentry,
};

/**
 * The type of the merged configuration object. Applications can extend this
 * via module augmentation to add custom config sections:
 *
 * ```typescript
 * declare module "keryx" {
 *   interface KeryxConfig {
 *     audit: { retentionDays: number };
 *   }
 * }
 * ```
 */
