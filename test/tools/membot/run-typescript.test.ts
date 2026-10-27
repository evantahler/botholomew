import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MembotClient } from "membot";
import { invokeSandbox } from "../../../src/tools/membot/run/execute.ts";
import { membotRunTool } from "../../../src/tools/membot/run.ts";
import type { ToolContext } from "../../../src/tools/tool.ts";
import { setupToolContext } from "../../helpers.ts";

let mem: MembotClient;
let ctx: ToolContext;
let cleanup: () => Promise<void>;

async function seed(logical_path: string, value: unknown): Promise<void> {
  const content =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  await mem.write({ logical_path, content });
}

beforeEach(async () => {
  ({ mem, ctx, cleanup } = await setupToolContext());
});

afterEach(async () => {
  await cleanup();
});

const CUSTOMERS = [
  { id: "c1", name: "Ada", tier: "enterprise" as const, region: "us" },
  { id: "c2", name: "Grace", tier: "pro" as const, region: "eu" },
  { id: "c3", name: "Alan", tier: "free" as const, region: "us" },
];

const ORDERS = [
  {
    id: "o1",
    customer_id: "c1",
    sku: "widget",
    qty: 2,
    cents: 4000,
    ts: "2026-05-31T10:00:00Z",
    status: "paid" as const,
  },
  {
    id: "o2",
    customer_id: "c1",
    sku: "gadget",
    qty: 1,
    cents: 1500,
    ts: "2026-05-31T18:00:00Z",
    status: "paid" as const,
  },
  {
    id: "o3",
    customer_id: "c2",
    sku: "widget",
    qty: 5,
    cents: 10000,
    ts: "2026-06-01T09:00:00Z",
    status: "refunded" as const,
  },
  {
    id: "o4",
    customer_id: "c3",
    sku: "widget",
    qty: 1,
    cents: 2000,
    ts: "2026-06-01T11:00:00Z",
    status: "paid" as const,
  },
  {
    id: "o5",
    customer_id: "c2",
    sku: "gadget",
    qty: 3,
    cents: 4500,
    ts: "2026-06-02T08:00:00Z",
    status: "paid" as const,
  },
];

const PAYMENTS = [
  { order_id: "o1", method: "ach", ok: true },
  { order_id: "o2", method: "card", ok: true },
  { order_id: "o3", method: "card", ok: false },
  { order_id: "o4", method: "card", ok: true },
  { order_id: "o5", method: "wire", ok: true },
];

describe("membot_run complex TypeScript", () => {
  test("joins, groups, narrows unions, and writes a typed rollup", async () => {
    await seed("sales/customers.json", CUSTOMERS);
    await seed("sales/orders.json", ORDERS);
    await seed("sales/payments.json", PAYMENTS);

    const r = await membotRunTool.execute(
      {
        source: `
          type Tier = "free" | "pro" | "enterprise";
          type OrderStatus = "paid" | "refunded" | "void";

          interface Customer {
            id: string;
            name: string;
            tier: Tier;
            region: string;
          }

          interface Order {
            id: string;
            customer_id: string;
            sku: string;
            qty: number;
            cents: number;
            ts: string;
            status: OrderStatus;
          }

          interface Payment {
            order_id: string;
            method: string;
            ok: boolean;
          }

          type DailyRollup = {
            day: string;
            orders: number;
            revenue_cents: number;
            by_tier: Record<Tier, number>;
            top_customer: string | null;
          };

          function groupBy<T>(rows: T[], key: (row: T) => string): Record<string, T[]> {
            const out: Record<string, T[]> = {};
            for (const row of rows) {
              const k = key(row);
              (out[k] ??= []).push(row);
            }
            return out;
          }

          function sum(nums: number[]): number {
            return nums.reduce((total: number, n: number) => total + n, 0);
          }

          const [customers, orders, payments] = await Promise.all([
            files.readJson("sales/customers.json") as Promise<Customer[]>,
            files.readJson("sales/orders.json") as Promise<Order[]>,
            files.readJson("sales/payments.json") as Promise<Payment[]>,
          ]);

          const customerById: Record<string, Customer> = Object.fromEntries(
            customers.map((c: Customer) => [c.id, c]),
          );
          const paymentByOrder: Record<string, Payment> = Object.fromEntries(
            payments.map((p: Payment) => [p.order_id, p]),
          );

          const settled = orders.filter((order: Order) => {
            const payment = paymentByOrder[order.id];
            if (order.status === "refunded" || order.status === "void") return false;
            return payment?.ok === true;
          });

          const byDay = groupBy(settled, (order: Order) => order.ts.slice(0, 10));
          const days = Object.keys(byDay).sort();

          const rollup: DailyRollup[] = days.map((day: string) => {
            const dayOrders = byDay[day] ?? [];
            const emptyTiers: Record<Tier, number> = {
              free: 0,
              pro: 0,
              enterprise: 0,
            };
            const spendByCustomer: Record<string, number> = {};
            for (const order of dayOrders) {
              const customer = customerById[order.customer_id];
              if (customer) emptyTiers[customer.tier] += order.cents;
              spendByCustomer[order.customer_id] =
                (spendByCustomer[order.customer_id] ?? 0) + order.cents;
            }
            const top = Object.entries(spendByCustomer).sort((a, b) => b[1] - a[1])[0];
            return {
              day,
              orders: dayOrders.length,
              revenue_cents: sum(dayOrders.map((o: Order) => o.cents)),
              by_tier: emptyTiers,
              top_customer: top ? (customerById[top[0]]?.name ?? top[0]) : null,
            };
          });

          await files.writeJson("sales/rollup.json", rollup, "daily rollup");
          const reread = await files.readJson("sales/rollup.json") as DailyRollup[];
          return {
            days: reread.length,
            total_revenue: sum(reread.map((row: DailyRollup) => row.revenue_cents)),
            first: reread[0],
            last: reread[reread.length - 1],
          };
        `,
      },
      ctx,
    );

    expect(r).toMatchObject({
      is_error: false,
      result_type: "object",
      result: {
        days: 3,
        total_revenue: 12000,
        first: {
          day: "2026-05-31",
          orders: 2,
          revenue_cents: 5500,
          by_tier: { free: 0, pro: 0, enterprise: 5500 },
          top_customer: "Ada",
        },
        last: {
          day: "2026-06-02",
          orders: 1,
          revenue_cents: 4500,
          top_customer: "Grace",
        },
      },
    });

    const stored = JSON.parse(
      (await mem.read({ logical_path: "sales/rollup.json" })).content ?? "",
    );
    expect(stored).toHaveLength(3);
    expect(stored[1]).toMatchObject({
      day: "2026-06-01",
      orders: 1,
      revenue_cents: 2000,
      by_tier: { free: 2000, pro: 0, enterprise: 0 },
      top_customer: "Alan",
    });
  });

  test("uses classes, optional chaining, and recursive helpers", async () => {
    await seed("graph/nodes.json", [
      { id: "root", children: ["a", "b"] },
      { id: "a", children: ["a1"] },
      { id: "b", children: [] },
      { id: "a1", children: [] },
    ]);

    const outcome = await invokeSandbox(ctx, {
      source: `
        interface Node {
          id: string;
          children: string[];
        }

        class TreeIndex {
          private readonly byId: Record<string, Node>;
          constructor(nodes: Node[]) {
            this.byId = Object.fromEntries(nodes.map((n: Node) => [n.id, n]));
          }
          get(id: string): Node | undefined {
            return this.byId[id];
          }
          walk(id: string, acc: string[] = []): string[] {
            acc.push(id);
            const kids = this.get(id)?.children ?? [];
            for (const child of kids) this.walk(child, acc);
            return acc;
          }
        }

        const nodes = await files.readJson("graph/nodes.json") as Node[];
        const tree = new TreeIndex(nodes);
        const order = tree.walk("root");
        const missing = tree.get("nope")?.id ?? null;
        return { order, missing, depth: order.length };
      `,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: {
        order: ["root", "a", "a1", "b"],
        missing: null,
        depth: 4,
      },
    });
  });

  test("satisfies, as const, and template types survive stripping", async () => {
    await seed("cfg/flags.json", { dark: true, compact: false });
    const outcome = await invokeSandbox(ctx, {
      source: `
        type FlagName = "dark" | "compact";
        const names = ["dark", "compact"] as const;
        const flags = await files.readJson("cfg/flags.json") as Record<FlagName, boolean>;
        const enabled = names.filter((name) => flags[name] === true);
        const label = \`enabled:\${enabled.join(",")}\` as const;
        const payload = { label, enabled } satisfies { label: string; enabled: readonly string[] };
        return payload;
      `,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: { label: "enabled:dark", enabled: ["dark"] },
    });
  });

  test("concurrent reads plus list/info/text round-trip", async () => {
    await seed("notes/a.md", "alpha");
    await seed("notes/b.json", { n: 2 });
    await seed("notes/c.json", { n: 3 });

    const outcome = await invokeSandbox(ctx, {
      source: `
        const [listed, aText, b, c, existsMissing, info] = await Promise.all([
          files.list({ prefix: "notes/", limit: 10 }),
          files.readText("notes/a.md"),
          files.readJson("notes/b.json"),
          files.readJson("notes/c.json"),
          files.exists("notes/missing.json"),
          files.info("notes/b.json"),
        ]);
        const ack = await files.writeText(
          "notes/sum.md",
          \`\${aText}:\${b.n + c.n}\`,
          "sum",
        );
        const back = await files.readText("notes/sum.md");
        const after = await files.list({ prefix: "notes/", limit: 10 });
        return {
          listedBeforeWrite: listed.entries.map((e: { logical_path: string }) => e.logical_path).sort(),
          paths: after.entries.map((e: { logical_path: string }) => e.logical_path).sort(),
          existsMissing,
          mime: info.mime_type,
          infoPath: info.logical_path,
          back,
          written: ack.logical_path,
        };
      `,
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: {
        existsMissing: false,
        infoPath: "notes/b.json",
        back: "alpha:5",
        written: "notes/sum.md",
      },
    });
    const result = (
      outcome.output as { result: { paths: string[]; mime: string } }
    ).result;
    expect(result.paths).toEqual(
      expect.arrayContaining([
        "notes/a.md",
        "notes/b.json",
        "notes/c.json",
        "notes/sum.md",
      ]),
    );
    expect(typeof result.mime).toBe("string");
  });

  test("Map/Set aggregation serializes through a plain object", async () => {
    await seed("tags.json", [
      { id: 1, tags: ["a", "b"] },
      { id: 2, tags: ["b", "c"] },
      { id: 3, tags: ["a"] },
    ]);
    const outcome = await invokeSandbox(ctx, {
      source: `
        type Row = { id: number; tags: string[] };
        const rows = await files.readJson("tags.json") as Row[];
        const counts = new Map<string, number>();
        const seen = new Set<string>();
        for (const row of rows) {
          for (const tag of row.tags) {
            seen.add(tag);
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        }
        return {
          unique: [...seen].sort(),
          counts: Object.fromEntries(counts),
        };
      `,
    });
    expect(outcome.status).toBe("completed");
    if (outcome.status !== "completed") return;
    expect(outcome.output).toMatchObject({
      is_error: false,
      result: {
        unique: ["a", "b", "c"],
        counts: { a: 2, b: 2, c: 1 },
      },
    });
  });

  test("guest throw becomes a failed run, not a host escape", async () => {
    const outcome = await invokeSandbox(ctx, {
      source: `
        function boom(msg: string): never {
          throw new Error(msg);
        }
        boom("typed failure");
        return { escaped: true };
      `,
    });
    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.output.message).toContain("typed failure");
  });
});
