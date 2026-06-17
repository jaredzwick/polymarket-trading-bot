import { test, expect, beforeEach, mock } from "bun:test";
import { AdapterRegistry } from "./registry";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../types/adapter";

function makeAdapter(name: string): SignalAdapter & {
  initCalled: boolean;
  startCalled: boolean;
  shutdownCalled: boolean;
} {
  return {
    name,
    version: "1.0.0",
    initCalled: false,
    startCalled: false,
    shutdownCalled: false,
    async initialize(_ctx: AdapterContext) {
      this.initCalled = true;
    },
    async start(_ctx: AdapterContext) {
      this.startCalled = true;
    },
    async shutdown() {
      this.shutdownCalled = true;
    },
  };
}

function makeRegistry() {
  const events = new EventBus();
  const logger = new Logger("error");
  const marketData = {
    subscribe: mock(() => {}),
    unsubscribe: mock(() => {}),
    getOrderBook: mock(() => null),
    getMarket: mock(async () => null),
    start: mock(async () => {}),
    stop: mock(() => {}),
  };
  return new AdapterRegistry({ events, logger, marketData });
}

test("AdapterRegistry registers and starts adapters", async () => {
  const registry = makeRegistry();
  const adapter = makeAdapter("test-adapter");
  const descriptor: AdapterDescriptor = {
    name: "test-adapter",
    version: "1.0.0",
    factory: () => adapter,
  };

  registry.register(descriptor);
  expect(registry.listRegistered()).toContain("test-adapter");

  await registry.start();
  expect(adapter.initCalled).toBe(true);
  expect(adapter.startCalled).toBe(true);
  expect(registry.listRunning()).toContain("test-adapter");
  expect(registry.isRunning()).toBe(true);

  await registry.shutdown();
  expect(adapter.shutdownCalled).toBe(true);
  expect(registry.listRunning()).toHaveLength(0);
  expect(registry.isRunning()).toBe(false);
});

test("AdapterRegistry rejects duplicate registration", () => {
  const registry = makeRegistry();
  const descriptor: AdapterDescriptor = {
    name: "dup",
    version: "1.0.0",
    factory: () => makeAdapter("dup"),
  };
  registry.register(descriptor);
  expect(() => registry.register(descriptor)).toThrow();
});

test("AdapterRegistry rejects registration while running", async () => {
  const registry = makeRegistry();
  registry.register({
    name: "first",
    version: "1.0.0",
    factory: () => makeAdapter("first"),
  });
  await registry.start();
  expect(() =>
    registry.register({ name: "late", version: "1.0.0", factory: () => makeAdapter("late") })
  ).toThrow();
  await registry.shutdown();
});

test("AdapterRegistry isolates failing adapter from others", async () => {
  const registry = makeRegistry();
  const good = makeAdapter("good");

  registry.register({
    name: "bad",
    version: "1.0.0",
    factory: () => ({
      name: "bad",
      version: "1.0.0",
      async initialize() {
        throw new Error("init failed");
      },
      async start() {},
      async shutdown() {},
    }),
  });
  registry.register({ name: "good", version: "1.0.0", factory: () => good });

  await registry.start();
  expect(registry.listRunning()).toContain("good");
  expect(registry.listRunning()).not.toContain("bad");

  await registry.shutdown();
});

test("AdapterRegistry getAdapter returns running instance", async () => {
  const registry = makeRegistry();
  const adapter = makeAdapter("lookup");
  registry.register({ name: "lookup", version: "1.0.0", factory: () => adapter });

  await registry.start();
  expect(registry.getAdapter("lookup")).toBe(adapter);
  expect(registry.getAdapter("missing")).toBeUndefined();

  await registry.shutdown();
});

test("AdapterRegistry shutdown is idempotent", async () => {
  const registry = makeRegistry();
  const adapter = makeAdapter("idem");
  registry.register({ name: "idem", version: "1.0.0", factory: () => adapter });

  await registry.start();
  await registry.shutdown();
  await registry.shutdown(); // second call must not throw
  expect(adapter.shutdownCalled).toBe(true);
});
