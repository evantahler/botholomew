import type { Command } from "commander";
import {
  addPageOptions,
  collectOption,
  compact,
  decorateHelp,
  emit,
  pageQuery,
  runAction,
  sessionRequest,
} from "../helpers.ts";
import { resolveProjectId, resolveTagIds } from "../resolve.ts";

/**
 * Register tag and user-tag commands.
 * @param program - The root program.
 */
export function registerTagCommands(program: Command): void {
  const tag = decorateHelp(
    program.command("tag").description("Permission tags"),
  );

  decorateHelp(
    addPageOptions(tag.command("list").description("List tags")).action(
      async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as {
            page?: string;
            limit?: string;
          };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "GET", "/tags", {
              query: compact({ projectId, ...pageQuery(opts) }),
            }),
          );
        });
      },
    ),
  );

  decorateHelp(
    tag
      .command("create")
      .description("Create a tag")
      .requiredOption("--name <name>", "Tag name")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { name: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "PUT", "/tag", {
              body: { projectId, name: opts.name },
            }),
          );
        });
      }),
  );

  decorateHelp(
    tag
      .command("edit")
      .description("Rename a tag")
      .argument("<id>", "Tag id")
      .requiredOption("--name <name>", "New name")
      .action(async function (this: Command, id: string) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { name: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "POST", "/tag", {
              body: { projectId, tagId: Number(id), name: opts.name },
            }),
          );
        });
      }),
  );

  decorateHelp(
    tag
      .command("delete")
      .description("Delete a tag")
      .argument("<id>", "Tag id")
      .action(async function (this: Command, id: string) {
        await runAction(this, async (ctx) => {
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "DELETE", "/tag", {
              body: { projectId, tagId: Number(id) },
            }),
          );
        });
      }),
  );

  decorateHelp(
    tag
      .command("assign")
      .description("Grant a tag to a member")
      .requiredOption("--user <id>", "User id")
      .requiredOption("--tag <id>", "Tag id")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { user: string; tag: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "PUT", "/user-tag", {
              body: {
                projectId,
                userId: Number(opts.user),
                tagId: Number(opts.tag),
              },
            }),
          );
        });
      }),
  );

  decorateHelp(
    tag
      .command("unassign")
      .description("Revoke a tag from a member")
      .requiredOption("--user <id>", "User id")
      .requiredOption("--tag <id>", "Tag id")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { user: string; tag: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "DELETE", "/user-tag", {
              body: {
                projectId,
                userId: Number(opts.user),
                tagId: Number(opts.tag),
              },
            }),
          );
        });
      }),
  );
}

/**
 * Register membership commands.
 * @param program - The root program.
 */
export function registerMemberCommands(program: Command): void {
  const member = decorateHelp(
    program.command("member").description("Project members"),
  );

  decorateHelp(
    addPageOptions(member.command("list").description("List members")).action(
      async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as {
            page?: string;
            limit?: string;
          };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "GET", "/memberships", {
              query: compact({ projectId, ...pageQuery(opts) }),
            }),
          );
        });
      },
    ),
  );

  decorateHelp(
    member
      .command("add")
      .description("Add an existing user by email")
      .requiredOption("--email <email>", "User email")
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as { email: string };
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "PUT", "/membership", {
              body: { projectId, email: opts.email },
            }),
          );
        });
      }),
  );

  decorateHelp(
    member
      .command("remove")
      .description("Remove a member")
      .argument("<userId>", "User id")
      .action(async function (this: Command, userId: string) {
        await runAction(this, async (ctx) => {
          const projectId = await resolveProjectId(ctx);
          emit(
            ctx,
            await sessionRequest(ctx, "DELETE", "/membership", {
              body: { projectId, userId: Number(userId) },
            }),
          );
        });
      }),
  );
}

/**
 * Register invite commands.
 * @param program - The root program.
 */
export function registerInviteCommands(program: Command): void {
  const invite = decorateHelp(
    program.command("invite").description("Project invitations"),
  );

  decorateHelp(
    addPageOptions(
      invite.command("list").description("List this project's invites"),
    ).action(async function (this: Command) {
      await runAction(this, async (ctx) => {
        const opts = this.optsWithGlobals() as {
          page?: string;
          limit?: string;
        };
        const projectId = await resolveProjectId(ctx);
        emit(
          ctx,
          await sessionRequest(ctx, "GET", "/invites", {
            query: compact({ projectId, ...pageQuery(opts) }),
          }),
        );
      });
    }),
  );

  decorateHelp(
    addPageOptions(
      invite.command("pending").description("List invites addressed to you"),
    ).action(async function (this: Command) {
      await runAction(this, async (ctx) => {
        const opts = this.optsWithGlobals() as {
          page?: string;
          limit?: string;
        };
        emit(
          ctx,
          await sessionRequest(ctx, "GET", "/invites/pending", {
            query: pageQuery(opts),
          }),
        );
      });
    }),
  );

  decorateHelp(
    invite
      .command("create")
      .description("Invite an email address")
      .requiredOption("--email <email>", "Invitee email")
      .option(
        "--tag <name-or-id>",
        "A tag to grant on acceptance, by name or id (repeatable)",
        collectOption,
        [],
      )
      .action(async function (this: Command) {
        await runAction(this, async (ctx) => {
          const opts = this.optsWithGlobals() as {
            email: string;
            tag: string[];
          };
          const projectId = await resolveProjectId(ctx);
          const tagIds = await resolveTagIds(ctx, projectId, opts.tag);
          emit(
            ctx,
            await sessionRequest(ctx, "PUT", "/invite", {
              body: { projectId, inviteeEmail: opts.email, tagIds },
            }),
          );
        });
      }),
  );

  decorateHelp(
    invite
      .command("accept")
      .description("Accept an invite addressed to you")
      .argument("<id>", "Invite id")
      .action(async function (this: Command, id: string) {
        await runAction(this, async (ctx) => {
          emit(
            ctx,
            await sessionRequest(ctx, "POST", "/invite/accept", {
              body: { inviteId: Number(id) },
            }),
          );
        });
      }),
  );

  decorateHelp(
    invite
      .command("reject")
      .description("Decline an invite addressed to you")
      .argument("<id>", "Invite id")
      .action(async function (this: Command, id: string) {
        await runAction(this, async (ctx) => {
          emit(
            ctx,
            await sessionRequest(ctx, "POST", "/invite/reject", {
              body: { inviteId: Number(id) },
            }),
          );
        });
      }),
  );
}
