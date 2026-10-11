import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LogLevel } from "keryx";
import { z } from "zod";
import { CookieSameSite } from "../../config/session";

// `render.yaml` is not code, so nothing else in the suite would notice if it
// drifted from what the app actually reads — and the feedback loop for a broken
// blueprint is a failed deploy, minutes after merge. These tests close that
// loop: they parse the real file, validate its structure against the subset of
// Render's blueprint spec we use, and assert the invariants that make the
// topology correct (one migrator, one shared encryption key, public origins).

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** Read a repo-root-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/**
 * A single `envVars` entry. Every variant is `strictObject`, so a typo like
 * `fromDatabse` or a `value` alongside `generateValue` fails to parse rather
 * than being silently dropped by Render.
 */
const envVarSchema = z.union([
  z.strictObject({ fromGroup: z.string() }),
  z.strictObject({ key: z.string(), value: z.string() }),
  z.strictObject({ key: z.string(), generateValue: z.literal(true) }),
  z.strictObject({ key: z.string(), sync: z.literal(false) }),
  z.strictObject({
    key: z.string(),
    fromDatabase: z.strictObject({
      name: z.string(),
      property: z.literal("connectionString"),
    }),
  }),
  z.strictObject({
    key: z.string(),
    fromService: z.union([
      z.strictObject({
        name: z.string(),
        type: z.string(),
        property: z.enum(["connectionString", "host", "port", "hostport"]),
      }),
      // `envVarKey` copies another service's env var — the shape for a secret
      // that must be byte-identical across both roles but cannot live in a
      // group, since Render ignores `sync: false` inside envVarGroups.
      z.strictObject({
        name: z.string(),
        type: z.string(),
        envVarKey: z.string(),
      }),
    ]),
  }),
]);

const buildFilterSchema = z.strictObject({ paths: z.array(z.string()).min(1) });

/**
 * Every instance type Render accepts for a web service or worker — the
 * spec-based ids plus the legacy names still honoured for them.
 *
 * An enum rather than `z.string()`, because the value that broke a Blueprint
 * sync was `starter plus`: a plausible-looking name for a tier Render does not
 * have. `render blueprints validate` rejects `starter_plus` and accepts
 * `starter plus`, so nothing upstream of this list catches it — the sync
 * reports success, creates every other service, and leaves the two that named
 * it missing.
 */
const COMPUTE_PLANS = [
  "free",
  "0.5c-512mb",
  "1c-2g",
  "2c-4g",
  "2c-8g",
  "2c-16g",
  "4c-8g",
  "4c-16g",
  "4c-32g",
  "8c-16g",
  "8c-32g",
  "8c-64g",
  "12c-24g",
  "12c-48g",
  "12c-96g",
  // Legacy names, in Render's own order.
  "starter",
  "standard",
  "pro",
  "pro plus",
  "pro max",
  "pro ultra",
] as const;

/** Fields shared by the three Docker-runtime services. */
const dockerServiceFields = {
  name: z.string(),
  runtime: z.literal("docker"),
  dockerfilePath: z.string(),
  dockerContext: z.string(),
  plan: z.enum(COMPUTE_PLANS),
  region: z.string(),
  branch: z.string(),
  autoDeploy: z.boolean(),
  buildFilter: buildFilterSchema,
  envVars: z.array(envVarSchema).min(1),
};

const serviceSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("web"),
    healthCheckPath: z.string(),
    // Optional while no Blueprint has been created from this file: the public
    // origins are named, and attaching their domains is part of the first sync.
    domains: z.array(z.string()).min(1).optional(),
    ...dockerServiceFields,
  }),
  z.strictObject({ type: z.literal("worker"), ...dockerServiceFields }),
  z.strictObject({
    type: z.literal("keyvalue"),
    name: z.string(),
    plan: z.string(),
    region: z.string(),
    ipAllowList: z.array(z.string()),
    maxmemoryPolicy: z.string(),
  }),
]);

const blueprintSchema = z.strictObject({
  services: z.array(serviceSchema).min(1),
  envVarGroups: z
    .array(
      z.strictObject({
        name: z.string(),
        envVars: z.array(envVarSchema).min(1),
      }),
    )
    .min(1),
  databases: z.array(
    z.strictObject({
      name: z.string(),
      plan: z.string(),
      region: z.string(),
      postgresMajorVersion: z.string(),
      ipAllowList: z.array(z.string()),
    }),
  ),
});

type Blueprint = z.infer<typeof blueprintSchema>;
type Service = Blueprint["services"][number];
/** A service built from a Dockerfile — i.e. anything but a managed resource. */
type DockerService = Exclude<Service, { type: "keyvalue" }>;
type WebService = Extract<Service, { type: "web" }>;
type EnvVar = z.infer<typeof envVarSchema>;

const blueprint: Blueprint = blueprintSchema.parse(
  Bun.YAML.parse(readRepoFile("render.yaml")),
);

/** Find a service by name, failing the test if the blueprint has no such service. */
function service(name: string): Service {
  const found = blueprint.services.find((s) => s.name === name);
  if (!found) throw new Error(`no service named "${name}" in render.yaml`);
  return found;
}

/** Find a service by name, asserting it is one we build from a Dockerfile. */
function dockerService(name: string): DockerService {
  const found = service(name);
  if (found.type === "keyvalue") {
    throw new Error(`"${name}" is a managed resource, not a Docker service`);
  }
  return found;
}

/** Find a service by name, asserting it serves HTTP (and so has a health check). */
function webService(name: string): WebService {
  const found = service(name);
  if (found.type !== "web") {
    throw new Error(`"${name}" is a ${found.type}, not a web service`);
  }
  return found;
}

/** The `envVars` of a service or env var group — `[]` for services that take none. */
function envVars(target: Service | { envVars: EnvVar[] }): EnvVar[] {
  return "envVars" in target ? target.envVars : [];
}

/**
 * The literal `value` a service sets for `key`, or `undefined` if the service
 * does not set it as a literal. Deliberately does NOT follow `fromGroup`: the
 * point of most assertions here is *which* of the two places a key is declared.
 */
function literal(target: Service, key: string): string | undefined {
  for (const entry of envVars(target)) {
    if ("key" in entry && entry.key === key && "value" in entry) {
      return entry.value;
    }
  }
  return undefined;
}

/** Every key a service declares directly, in any form. */
function declaredKeys(target: Service): string[] {
  return envVars(target).flatMap((e) => ("key" in e ? [e.key] : []));
}

/** Names of the env var groups a service pulls in. */
function groupsOf(target: Service): string[] {
  return envVars(target).flatMap((e) =>
    "fromGroup" in e ? [e.fromGroup] : [],
  );
}

const web = webService("botholomew-api");
const worker = dockerService("botholomew-worker");
const frontend = webService("botholomew-frontend");

describe("render.yaml — topology", () => {
  test("declares all five resources: web, worker, frontend, redis, and postgres", () => {
    expect(blueprint.services.map((s) => s.name).sort()).toEqual([
      "botholomew-api",
      "botholomew-frontend",
      "botholomew-redis",
      "botholomew-worker",
    ]);
    expect(blueprint.envVarGroups.map((g) => g.name)).toEqual([
      "botholomew-shared",
    ]);
    expect(blueprint.databases.map((d) => d.name)).toEqual(["botholomew-db"]);
    expect(service("botholomew-redis").type).toBe("keyvalue");
    expect(web.type).toBe("web");
    expect(worker.type).toBe("worker");
    expect(frontend.type).toBe("web");
  });

  test("web and worker share one image; the frontend has its own", () => {
    expect(web.dockerfilePath).toBe("./backend/Dockerfile");
    expect(worker.dockerfilePath).toBe("./backend/Dockerfile");
    expect(frontend.dockerfilePath).toBe("./frontend/Dockerfile");
  });

  test("every fromDatabase / fromService reference resolves", () => {
    const serviceNames = new Set(blueprint.services.map((s) => s.name));
    const databaseNames = new Set(blueprint.databases.map((d) => d.name));

    for (const svc of blueprint.services) {
      for (const entry of envVars(svc)) {
        if ("fromDatabase" in entry) {
          expect(databaseNames).toContain(entry.fromDatabase.name);
        }
        if ("fromService" in entry) {
          expect(serviceNames).toContain(entry.fromService.name);
          // A `type` that disagrees with the referenced service is the kind of
          // thing Render only complains about at blueprint-sync time.
          const referencedType: string = service(entry.fromService.name).type;
          expect(referencedType).toBe(entry.fromService.type);
        }
      }
    }
  });

  test("every fromGroup reference resolves", () => {
    const groupNames = new Set(blueprint.envVarGroups.map((g) => g.name));
    for (const svc of blueprint.services) {
      for (const name of groupsOf(svc)) expect(groupNames).toContain(name);
    }
  });

  test("both backend services get Postgres and Redis from the managed resources", () => {
    for (const svc of [web, worker]) {
      const wired = Object.fromEntries(
        envVars(svc).flatMap((e) =>
          "key" in e && ("fromDatabase" in e || "fromService" in e)
            ? [[e.key, e]]
            : [],
        ),
      );
      expect(wired.DATABASE_URL).toBeDefined();
      expect(wired.REDIS_URL).toBeDefined();
    }
  });

  test("staging tracks main and deploys automatically", () => {
    for (const svc of [web, worker, frontend]) {
      expect(svc.branch).toBe("main");
      expect(svc.autoDeploy).toBe(true);
    }
  });

  test("api and worker run on the 2 GB instance type", () => {
    // Render has no 1 GB tier, so this is the first one above `starter`
    // (512 MB). The frontend is a static nginx box and stays on starter.
    //
    // The literal matters as much as the schema above it: a plausible name for
    // a tier that does not exist syncs "successfully" and silently skips the
    // services that named it.
    expect(web.plan).toBe("1c-2g");
    expect(worker.plan).toBe("1c-2g");
    expect(frontend.plan).toBe("starter");
  });
});

describe("render.yaml — one migrator, one task runner", () => {
  test("only the worker migrates", () => {
    expect(literal(worker, "DATABASE_AUTO_MIGRATE")).toBe("true");
    expect(literal(web, "DATABASE_AUTO_MIGRATE")).toBe("false");
  });

  test("only the worker runs tasks", () => {
    expect(literal(worker, "TASKS_ENABLED")).toBe("true");
    expect(literal(worker, "TASK_PROCESSORS")).toBe("1");
    expect(literal(web, "TASKS_ENABLED")).toBe("false");
    expect(literal(web, "TASK_PROCESSORS")).toBe("0");
  });

  test("only the web service serves HTTP", () => {
    expect(literal(worker, "WEB_SERVER_ENABLED")).toBe("false");
    // Web relies on the config default (`true`), so it must not disable itself.
    expect(literal(web, "WEB_SERVER_ENABLED")).toBeUndefined();
  });

  test("the two roles are distinguishable in logs and in error reports", () => {
    expect(literal(web, "PROCESS_NAME")).toBe("botholomew-api");
    expect(literal(worker, "PROCESS_NAME")).toBe("botholomew-worker");
    // `config.observability.serviceName` is what `@keryxjs/sentry` stamps as
    // `serverName`. Empty, it falls back to `backend/package.json`'s name
    // (`botholomew-backend`) for both roles, and every issue looks like one
    // process. The Render service names are the ones an operator greps for.
    expect(literal(web, "OTEL_SERVICE_NAME")).toBe("botholomew-api");
    expect(literal(worker, "OTEL_SERVICE_NAME")).toBe("botholomew-worker");
  });
});

describe("render.yaml — build filters", () => {
  test("the backend services ignore frontend-only changes", () => {
    for (const svc of [web, worker]) {
      expect(svc.buildFilter.paths).toContain("backend/**");
      expect(svc.buildFilter.paths).not.toContain("frontend/**");
    }
  });

  test("the frontend also rebuilds on backend changes", () => {
    // `tsc -b` resolves response types through the `@backend/*` alias, so a
    // backend-only change can break the frontend build.
    expect(frontend.buildFilter.paths).toContain("frontend/**");
    expect(frontend.buildFilter.paths).toContain("backend/**");
  });

  test("every service rebuilds when workspace dependencies change", () => {
    for (const svc of [web, worker, frontend]) {
      expect(svc.buildFilter.paths).toContain("bun.lock");
      expect(svc.buildFilter.paths).toContain("package.json");
    }
  });
});

describe("render.yaml — public origins", () => {
  test("health checks point at endpoints that exist", () => {
    // `/api` is the configured API route, and `status` is the action's route.
    expect(web.healthCheckPath).toBe(
      `${literal(web, "WEB_SERVER_API_ROUTE")}/status`,
    );
    expect(frontend.healthCheckPath).toBe("/");
  });

  test("the MCP/OAuth issuer base is the public HTTPS origin", () => {
    const applicationUrl = literal(web, "APPLICATION_URL");
    expect(applicationUrl).toBe("https://api.botholomew.com");
    // Keryx's getExternalOrigin() ignores a localhost APPLICATION_URL and falls
    // through to the (proxy) request origin, which on Render is internal.
    expect(applicationUrl).not.toContain("localhost");
  });

  test("MCP_OAUTH_TRUST_PROXY is on", () => {
    expect(literal(web, "MCP_SERVER_ENABLED")).toBe("true");
    expect(literal(web, "MCP_OAUTH_TRUST_PROXY")).toBe("true");
  });

  test("CORS allows exactly the frontend's origin", () => {
    expect(literal(web, "WEB_SERVER_ALLOWED_ORIGINS")).toBe(
      "https://www.botholomew.com",
    );
  });

  test("no domain is attached before the first sync, and the apex is never an origin", () => {
    // Attaching a domain is not the whole operation — Render still needs DNS
    // records and a certificate, and an attached-but-uncertificated domain
    // serves a TLS error — so it belongs to the first sync, not to a file
    // nothing has deployed. What can be true now: no env var names the apex,
    // which is only ever a redirect to www.
    for (const svc of [web, frontend]) {
      expect(svc.domains, svc.name).toBeUndefined();
    }
    const apexOrigin = "https://botholomew.com";
    for (const target of [...blueprint.services, ...blueprint.envVarGroups]) {
      for (const entry of envVars(target)) {
        if (!("value" in entry)) continue;
        expect(entry.value).not.toBe(apexOrigin);
      }
    }
  });

  test("the web service points WEB_SERVER_THEME at a file that exists", () => {
    // Keryx throws SERVER_INITIALIZATION on boot if the theme path does not
    // resolve, so a typo here is a crash loop on deploy rather than an unstyled
    // page. The path is relative to the app's rootDir, which is `backend/` both
    // locally and in the image.
    const themePath = literal(web, "WEB_SERVER_THEME");
    expect(themePath).toBe("theme/botholomew-theme.ts");
    expect(readRepoFile(join("backend", themePath as string))).toContain(
      "export default",
    );
    // Only the web service renders HTML; the worker has no use for it.
    expect(declaredKeys(worker)).not.toContain("WEB_SERVER_THEME");
  });

  test("the frontend bundle targets the backend's public origin", () => {
    expect(literal(frontend, "VITE_API_URL")).toBe(
      literal(web, "APPLICATION_URL"),
    );
  });

  test("FRONTEND_URL names the frontend, from a group both services read", () => {
    // Two claims. First: it is the *frontend's* origin, not the API's — a link
    // built from the backend's origin lands on an API route a person cannot
    // use. Second: it is in the shared group, so a worker task building a link
    // reads the same value a web request does.
    const shared = blueprint.envVarGroups.find(
      (g) => g.name === "botholomew-shared",
    );
    const groupKeys = new Map(
      (shared?.envVars ?? []).flatMap((e) =>
        "key" in e && "value" in e ? [[e.key, e.value] as const] : [],
      ),
    );

    // The frontend's origin is already written down once, as the only origin
    // CORS allows — so that is what this is checked against rather than a
    // second copy of the hostname.
    expect(groupKeys.get("FRONTEND_URL")).toBe(
      literal(web, "WEB_SERVER_ALLOWED_ORIGINS"),
    );
    expect(groupKeys.get("FRONTEND_URL")).not.toBe(
      literal(web, "APPLICATION_URL"),
    );
    expect(declaredKeys(web)).not.toContain("FRONTEND_URL");
    expect(declaredKeys(worker)).not.toContain("FRONTEND_URL");
  });

  test("the cross-origin session cookie is Secure + SameSite=None", () => {
    expect(literal(web, "SESSION_COOKIE_SECURE")).toBe("true");
    // Parsed straight into the enum, so the capitalization has to match.
    expect(literal(web, "SESSION_COOKIE_SAME_SITE")).toBe(CookieSameSite.None);
  });

  test("no service points at localhost or plain HTTP", () => {
    for (const svc of blueprint.services) {
      for (const entry of envVars(svc)) {
        if (!("value" in entry)) continue;
        expect(entry.value).not.toContain("localhost");
        expect(entry.value).not.toContain("http://");
      }
    }
  });
});

describe("render.yaml — shared secrets", () => {
  const shared = blueprint.envVarGroups.find(
    (g) => g.name === "botholomew-shared",
  );
  if (!shared) throw new Error("no botholomew-shared env var group");

  test("both backend services pull the shared group", () => {
    expect(groupsOf(web)).toContain("botholomew-shared");
    expect(groupsOf(worker)).toContain("botholomew-shared");
  });

  test("SECRETS_ENCRYPTION_KEY is generated once, in the group", () => {
    // Declaring `generateValue: true` on both services would mint two
    // different keys, and anything encrypted by web would be undecryptable in a
    // worker task. It has to be declared in exactly one place.
    expect(shared.envVars).toContainEqual({
      key: "SECRETS_ENCRYPTION_KEY",
      generateValue: true,
    });
    for (const svc of blueprint.services) {
      expect(declaredKeys(svc)).not.toContain("SECRETS_ENCRYPTION_KEY");
    }
  });

  test("the group holds no per-service value", () => {
    // Anything that differs between web and worker must not be in the group,
    // or one of the two roles is silently wrong.
    const perService = [
      "PROCESS_NAME",
      "OTEL_SERVICE_NAME",
      "DATABASE_AUTO_MIGRATE",
      "TASKS_ENABLED",
      "TASK_PROCESSORS",
      "WEB_SERVER_ENABLED",
    ];
    const groupKeys = shared.envVars.flatMap((e) =>
      "key" in e ? [e.key] : [],
    );
    for (const key of perService) expect(groupKeys).not.toContain(key);
  });

  test("the group holds exactly what both roles must agree on", () => {
    // NODE_ENV, the log format, the encryption key, and the frontend's origin.
    // Anything else in the group is either per-service (and silently wrong for
    // one role) or a deployment concern this blueprint does not configure.
    expect(
      shared.envVars.flatMap((e) => ("key" in e ? [e.key] : [])).sort(),
    ).toEqual(
      [
        "FRONTEND_URL",
        "LOG_COLORIZE",
        "LOG_INCLUDE_TIMESTAMPS",
        "LOG_LEVEL",
        "NODE_ENV",
        "SECRETS_ENCRYPTION_KEY",
      ].sort(),
    );
  });

  test("no model-provider key, error reporter, or mail server is configured", () => {
    // Keys are the project's own (BYOK), so a provider key never appears in a
    // blueprint; Sentry and SMTP are deployment work this file does not do.
    const forbidden =
      /^(ANTHROPIC|OPENAI|SENTRY|SMTP|GITHUB_APP|VERCEL|SANDBOX)_|_API_KEY$/;
    for (const target of [...blueprint.services, ...blueprint.envVarGroups]) {
      for (const entry of envVars(target)) {
        if ("key" in entry) {
          expect(
            forbidden.test(entry.key),
            `${entry.key} on ${target.name}`,
          ).toBe(false);
        }
      }
    }
  });

  test("no secret is committed as a literal", () => {
    const secretish = /TOKEN|PASSWORD|SECRET|KEY$/;
    for (const target of [...blueprint.services, ...blueprint.envVarGroups]) {
      for (const entry of envVars(target)) {
        if ("value" in entry && secretish.test(entry.key)) {
          throw new Error(`${entry.key} is a literal value in render.yaml`);
        }
      }
    }
  });

  test("the shared group's log config matches what the app can parse", () => {
    const level = shared.envVars.find(
      (e) => "key" in e && e.key === "LOG_LEVEL",
    );
    expect(level).toBeDefined();
    if (!level || !("value" in level))
      throw new Error("LOG_LEVEL has no value");
    expect(Object.values<string>(LogLevel)).toContain(level.value);
  });

  test("NODE_ENV is production for both backend roles", () => {
    expect(shared.envVars).toContainEqual({
      key: "NODE_ENV",
      value: "production",
    });
  });
});

describe("render.yaml — agrees with the Dockerfiles", () => {
  test("services that COPY the root lockfile build from the repo root", () => {
    for (const svc of [web, worker, frontend]) {
      const dockerfile = readRepoFile(svc.dockerfilePath);
      if (dockerfile.includes("COPY bun.lock")) {
        expect(svc.dockerContext).toBe(".");
      }
    }
  });

  test("every workspace package.json is COPY'd before bun install", () => {
    // bun install --frozen-lockfile fails with `Workspace not found "cli"` if
    // the root package.json lists a workspace whose manifest is not in the
    // image. The app images do not need CLI sources — only the manifest, so
    // the workspace graph resolves. Asserted from package.json workspaces so
    // the next member cannot land without a matching COPY.
    const rootPkg = JSON.parse(readRepoFile("package.json")) as {
      workspaces: string[];
    };
    expect(rootPkg.workspaces.length).toBeGreaterThan(0);

    for (const svc of [web, worker, frontend]) {
      const dockerfile = readRepoFile(svc.dockerfilePath);
      const installAt = dockerfile.indexOf("RUN bun install --frozen-lockfile");
      expect(installAt).toBeGreaterThan(-1);
      const beforeInstall = dockerfile.slice(0, installAt);
      for (const ws of rootPkg.workspaces) {
        expect(beforeInstall).toContain(
          `COPY ${ws}/package.json ${ws}/package.json`,
        );
      }
      expect(dockerfile).not.toContain("COPY cli/ cli/");
    }
  });

  test("every VITE_* env var is declared as an ARG in its Dockerfile", () => {
    // Vite inlines these at build time. Render passes a service's env vars to
    // the Docker build as build args, but only an `ARG` the Dockerfile declares
    // actually reaches the build.
    const dockerfile = readRepoFile(frontend.dockerfilePath);
    const viteKeys = declaredKeys(frontend).filter((k) =>
      k.startsWith("VITE_"),
    );
    expect(viteKeys.length).toBeGreaterThan(0);
    for (const key of viteKeys) {
      expect(dockerfile).toContain(`ARG ${key}`);
    }
  });

  test("the web service's port matches what its image exposes", () => {
    expect(readRepoFile(web.dockerfilePath)).toContain("EXPOSE 10000");
    expect(literal(web, "WEB_SERVER_PORT")).toBe("10000");
    // Binding to localhost inside a container is unreachable from Render's proxy.
    expect(literal(web, "WEB_SERVER_HOST")).toBe("0.0.0.0");
  });

  test("the frontend's nginx listens on the port its image exposes", () => {
    expect(readRepoFile(frontend.dockerfilePath)).toContain("EXPOSE 10000");
    expect(readRepoFile("frontend/nginx.conf")).toContain("listen 10000");
  });

  test("the backend image pre-generates the swagger schema cache", () => {
    // Measured, not guessed: generating these at boot runs ts-morph over every
    // action and peaks at ~1.4 GB RSS against a settled footprint of ~80 MB. A
    // container smaller than that is killed before it finishes starting, with
    // no traffic and nothing in the log naming the cause — which is what the
    // 512 MB starter plan did. `keryx build` moves the work to the builder.
    //
    // Asserted by ordering rather than by presence: the RUN has to come before
    // the runtime stage, or it generates the cache into a layer the final image
    // never copies and the server regenerates it at boot anyway — the same
    // crash, from a Dockerfile that looks fixed.
    const dockerfile = readRepoFile(web.dockerfilePath);
    const generate = dockerfile.indexOf("keryx.ts build");
    const runtimeStage = dockerfile.indexOf("FROM oven/bun:1-slim");

    expect(generate).toBeGreaterThan(-1);
    expect(runtimeStage).toBeGreaterThan(-1);
    expect(generate).toBeLessThan(runtimeStage);

    // Both backend services run the same image, so neither can miss it.
    expect(worker.dockerfilePath).toBe(web.dockerfilePath);
  });
});

describe("render.yaml — managed resources", () => {
  test("Redis will not evict queued tasks", () => {
    const redis = service("botholomew-redis");
    if (redis.type !== "keyvalue") throw new Error("redis is not a keyvalue");
    // node-resque's queue lives here; evicting a job under memory pressure
    // would lose work silently.
    expect(redis.maxmemoryPolicy).toBe("noeviction");
    expect(redis.ipAllowList).toEqual([]);
  });

  test("Postgres is the major version CI tests against", () => {
    const database = blueprint.databases[0];
    if (!database) throw new Error("no database in render.yaml");
    expect(database.postgresMajorVersion).toBe("18");
    // Empty allow-list = reachable only from inside the Render network.
    expect(database.ipAllowList).toEqual([]);
  });

  test("everything is in one region", () => {
    const regions = new Set([
      ...blueprint.services.map((s) => s.region),
      ...blueprint.databases.map((d) => d.region),
    ]);
    expect(regions.size).toBe(1);
  });
});
