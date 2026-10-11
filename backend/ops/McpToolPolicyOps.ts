/**
 * Which actions are published as MCP tools for human OAuth clients.
 *
 * Keryx serves **one** `/mcp`, and the clients on it are people: Claude, an
 * IDE, any OAuth client a member signs into. The policy is therefore a single
 * gate rather than a static `mcp.tool = false` on every dangerous-looking
 * action: **publish** almost every human-facing HTTP action as a tool, so the
 * API and a person's assistant are the same product surface, and keep a closed
 * list of exceptions. {@link applyMcpToolPolicy} is the source of truth, and
 * `rbac.test.ts` asserts every action's live flag equals
 * {@link shouldPublishAsMcpTool}.
 *
 * Bots never reach this surface. What a bot can do is an in-process tool
 * executed by its own tick, never an action, and a bot holds no token that
 * could call `/mcp`.
 */

/**
 * The fields the publish policy reads and the `mcp.tool` flag it writes.
 *
 * Structural rather than `Action` so tests can call {@link shouldPublishAsMcpTool}
 * against the live registry without importing Keryx's action class type.
 */
export interface McpPublishableAction {
  name: string;
  mcp?: {
    tool?: boolean;
    isLoginAction?: boolean;
    isSignupAction?: boolean;
  };
  web?: { route?: string | RegExp } | null;
  task?: { frequency?: number } | null;
}

/**
 * Actions that have an HTTP route but must never be MCP tools — for anyone.
 *
 * Login and signup (a model has no business minting sessions), and the
 * unauthenticated introspection endpoints, which answer the same thing to
 * everyone and would only add noise to a person's tool list. Prefixes
 * (`webhook:`, `gateway:oauth-`) are applied in {@link shouldPublishAsMcpTool}
 * rather than listed here, so the next member of either family cannot arrive as
 * a tool by omission — even before any action with that prefix is registered.
 *
 * `rbac.test.ts` asserts every name here is a registered action, so a typo
 * cannot leave a real action published while this list reads as though it were
 * not.
 */
export const NEVER_MCP_ACTION_NAMES: ReadonlySet<string> = new Set([
  "user:create",
  "session:create",
  "session:destroy",
  "status",
  "swagger",
  "actions:permissions",
]);

/**
 * Action-name prefixes that are never MCP tools, whatever the action.
 *
 * `webhook:` is token-authenticated machine ingress: a model holding it could
 * deliver an event on behalf of whichever integration's token it had seen.
 * `gateway:oauth-` is the browser half of an OAuth dance, which only makes sense
 * as a redirect a person's browser follows.
 */
export const NEVER_MCP_ACTION_PREFIXES: readonly string[] = [
  "webhook:",
  "gateway:oauth-",
];

/**
 * Whether this action should be registered as an MCP tool at boot.
 *
 * Publish if it has a `web.route`, unless it is a clock (`task.frequency > 0`),
 * a login/signup action, a member of {@link NEVER_MCP_ACTION_NAMES}, or starts
 * with one of {@link NEVER_MCP_ACTION_PREFIXES}.
 *
 * Class-level `mcp.tool` is the boot default and is overwritten by
 * {@link applyMcpToolPolicy}. `rbac.test.ts` asserts every action's live flag
 * equals this function.
 * @param action - A registered action.
 * @returns True if Keryx should register it as a tool.
 */
export function shouldPublishAsMcpTool(action: McpPublishableAction): boolean {
  if (!action.web?.route) return false;
  if (
    action.task != null &&
    action.task.frequency != null &&
    action.task.frequency > 0
  ) {
    return false;
  }
  if (NEVER_MCP_ACTION_NAMES.has(action.name)) return false;
  if (action.mcp?.isLoginAction || action.mcp?.isSignupAction) return false;
  if (NEVER_MCP_ACTION_PREFIXES.some((p) => action.name.startsWith(p))) {
    return false;
  }
  return true;
}

/**
 * Set `mcp.tool` on every registered action from {@link shouldPublishAsMcpTool}.
 *
 * Called at initializer boot, before any MCP session is opened, so
 * `registerTools` reads the live flags. Must run even when MCP is disabled:
 * `rbac.test.ts` (and `actions:permissions` consumers) read the same flags.
 * @param actions - The live action registry (`api.actions.actions`).
 */
export function applyMcpToolPolicy(actions: McpPublishableAction[]): void {
  for (const action of actions) {
    if (!action.mcp) {
      action.mcp = { tool: false };
    }
    action.mcp.tool = shouldPublishAsMcpTool(action);
  }
}
