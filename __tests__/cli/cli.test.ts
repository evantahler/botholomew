import { $ } from "bun";
import { test, expect, describe, beforeAll } from "bun:test";
import pkg from "./../../package.json";
import { api } from "../../api";

beforeAll(async () => {
  await api.start();
  await api.db.clearDatabase();
  await api.stop();
});

describe("CLI", () => {
  test("help describes the CLI and actions", async () => {
    const { stdout, stderr, exitCode } =
      await $`./botholomew.ts --help`.quiet();

    expect(exitCode).toBe(0);
    expect(stderr).toBeEmpty();
    expect(stdout.toString()).toContain("Botholomew");
    expect(stdout.toString()).toContain("status");
    expect(stdout.toString()).toContain("user:create");
  });

  test("no action is the same as help, but technically an error", async () => {
    const { stdout, stderr, exitCode } = await $`./botholomew.ts`
      .quiet()
      .nothrow();

    expect(exitCode).toBe(1);
    expect(stdout).toBeEmpty();
    expect(stderr.toString()).toContain("Botholomew");
  });

  test('the version is returned with "--version"', async () => {
    const { stdout, stderr, exitCode } =
      await $`./botholomew.ts --version`.quiet();

    expect(exitCode).toBe(0);
    expect(stderr).toBeEmpty();
    expect(stdout.toString()).toContain(pkg.version);
  });

  test('actions with inputs can be described with "--help"', async () => {
    const { stdout, stderr, exitCode } =
      await $`./botholomew.ts "user:create" --help`.quiet();

    expect(exitCode).toBe(0);
    expect(stderr).toBeEmpty();

    expect(stdout.toString()).toContain("--name <value>");
    expect(stdout.toString()).toContain("The user's name");
    expect(stdout.toString()).toContain("--email <value>");
    expect(stdout.toString()).toContain("The user's email");
    expect(stdout.toString()).toContain("--password <value>");
    expect(stdout.toString()).toContain("The user's password");
  });

  test("create user and session via the CLI as integration test", async () => {
    const { stdout, stderr, exitCode } =
      await $`./botholomew.ts "user:create" --name test --email test@test.com --password testpass123`.quiet();

    expect(exitCode).toBe(0);
    expect(stderr).toBeEmpty();

    const { response } = JSON.parse(stdout.toString());
    expect(response.user.id).toBeGreaterThan(0);
    expect(response.user.email).toEqual("test@test.com");

    const {
      stdout: stdout2,
      stderr: stderr2,
      exitCode: exitCode2,
    } = await $`./botholomew.ts "session:create" --email test@test.com --password testpass123`.quiet();

    expect(exitCode2).toBe(0);
    expect(stderr2).toBeEmpty();

    const { response: response2 } = JSON.parse(stdout2.toString());
    expect(response2.user.id).toEqual(1);
    expect(response2.user.email).toEqual("test@test.com");
    expect(response2.session.id).not.toBeNull();
  });

  describe("CLI errors", () => {
    test("action not found", async () => {
      const { stdout, stderr, exitCode } = await $`./botholomew.ts foo`
        .quiet()
        .nothrow();

      expect(exitCode).toBe(1);
      expect(stdout).toBeEmpty();
      expect(stderr.toString()).toContain("unknown command 'foo'");
    });

    test("action param missing", async () => {
      // missing password
      const { stdout, stderr, exitCode } =
        await $`./botholomew.ts "user:create" --name test --email test@test.com`
          .quiet()
          .nothrow();

      expect(exitCode).toBe(1);
      expect(stderr.toString()).toContain(
        "required option '--password <value>' not specified",
      );
      expect(stdout).toBeEmpty();
    });

    test("validation from within action", async () => {
      // password too short
      const { stdout, stderr, exitCode } =
        await $`./botholomew.ts "user:create" --name test --email test@test.com --password x`
          .quiet()
          .nothrow();

      expect(exitCode).toBe(1);
      expect(stdout).toBeEmpty();

      const { response } = JSON.parse(stderr.toString());
      expect(response).toEqual({});
    });
  });
});
