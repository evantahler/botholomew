import type { Command } from "commander";
import { loginRequest } from "../client.ts";
import { writeConfig } from "../config.ts";
import { decorateHelp, emit, runAction, sessionRequest } from "../helpers.ts";
import { resolveSecretValue } from "../interpolate.ts";

/**
 * Register login / logout / whoami.
 * @param program - The root program.
 */
export function registerAuthCommands(program: Command): void {
  decorateHelp(
    program
      .command("login")
      .description("Sign in and store the session cookie")
      .requiredOption("--email <email>", "Account email")
      .requiredOption(
        "--password <password>",
        "Account password, or a $VAR / ${VAR} reference to read it from the environment",
      )
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as {
            email: string;
            password: string;
          };
          const { payload, sessionCookie } = await loginRequest(
            ctx.url,
            opts.email,
            resolveSecretValue(opts.password, "--password", process.env),
          );
          writeConfig({
            ...ctx.config,
            baseUrl: ctx.url,
            sessionCookie,
            project: ctx.project,
          });
          emit(ctx, payload);
        });
      }),
  );

  decorateHelp(
    program
      .command("logout")
      .description("Destroy the stored session")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          if (ctx.sessionCookie) {
            await sessionRequest(ctx, "DELETE", "/session");
          }
          const { sessionCookie: _drop, ...rest } = ctx.config;
          writeConfig(rest);
          emit(ctx, { success: true });
        });
      }),
  );

  decorateHelp(
    program
      .command("whoami")
      .description("Show the signed-in user")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          emit(ctx, await sessionRequest(ctx, "GET", "/me"));
        });
      }),
  );
}
