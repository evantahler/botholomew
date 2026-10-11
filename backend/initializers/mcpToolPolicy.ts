import { api, Initializer } from "keryx";
import { applyMcpToolPolicy } from "../ops/McpToolPolicyOps";

const namespace = "mcpToolPolicy";

/**
 * Stamps every action's `mcp.tool` flag from the publish policy at boot.
 *
 * {@link applyMcpToolPolicy} publishes almost every human-facing HTTP action
 * as a static tool, so a person's Claude (or any OAuth client) sees the same
 * product surface as the website and the CLI. The class-level `mcp.tool` on an
 * action is only the boot default; this initializer overwrites it before any
 * session opens, so Keryx's per-session `registerTools` reads the policy's
 * answer rather than whatever the class happened to declare.
 *
 * `dependsOn = ["mcp"]` orders this after Keryx's own MCP initializer, which is
 * also after the action registry has loaded.
 *
 * `declaresAPIProperty = false`: nothing is attached to `api`.
 */
export class McpToolPolicy extends Initializer {
  /** Register the publish-policy stamp, ordered after Keryx's MCP initializer. */
  constructor() {
    super(namespace);
    this.declaresAPIProperty = false;
    this.dependsOn = ["mcp"];
  }

  /**
   * Stamp `mcp.tool` from the publish policy before any session opens.
   *
   * Runs even when MCP is disabled: `rbac.test.ts` reads the live flags, and
   * Keryx's per-session `registerTools` must see them on the next boot that
   * does enable MCP.
   */
  async initialize(): Promise<void> {
    applyMcpToolPolicy(api.actions.actions);
  }
}
