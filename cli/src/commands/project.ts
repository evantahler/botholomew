import type { Command } from "commander";
import { writeConfig } from "../config.ts";
import {
  addPageOptions,
  decorateHelp,
  emit,
  pageQuery,
  runAction,
  sessionRequest,
} from "../helpers.ts";
import { resolveProjectId } from "../resolve.ts";

/**
 * Register project commands.
 * @param program - The root program.
 */
export function registerProjectCommands(program: Command): void {
  const project = decorateHelp(
    program.command("project").description("Projects you belong to"),
  );

  decorateHelp(
    addPageOptions(
      project.command("list").description("List projects you belong to"),
    ).action(async function (this: Command) {
      await runAction(this, async (ctx) => {
        const opts = this.optsWithGlobals() as {
          page?: string;
          limit?: string;
        };
        emit(
          ctx,
          await sessionRequest(ctx, "GET", "/projects", {
            query: pageQuery(opts),
          }),
        );
      });
    }),
  );

  decorateHelp(
    project
      .command("create")
      .description("Create a project")
      .requiredOption("--name <name>", "Display name")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { name: string };
          emit(
            ctx,
            await sessionRequest(ctx, "PUT", "/project", {
              body: { name: opts.name },
            }),
          );
        });
      }),
  );

  decorateHelp(
    project
      .command("view")
      .description("View the selected project")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "GET", "/project", {
              query: { projectId },
            }),
          );
        });
      }),
  );

  decorateHelp(
    project
      .command("edit")
      .description("Rename the selected project")
      .requiredOption("--name <name>", "New display name")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { name: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "POST", "/project", {
              body: { projectId, name: opts.name },
            }),
          );
        });
      }),
  );

  decorateHelp(
    project
      .command("delete")
      .description("Delete the selected project")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "DELETE", "/project", {
              body: { projectId },
            }),
          );
        });
      }),
  );

  decorateHelp(
    project
      .command("use")
      .description("Persist the selected project in the config file")
      .argument("<id-or-slug>", "Project id or slug")
      .action(async function (this: Command, selector: string) {
        await runAction(this, async (ctx) => {
          writeConfig({ ...ctx.config, project: selector, baseUrl: ctx.url });
          emit(ctx, { project: selector });
        });
      }),
  );
}
