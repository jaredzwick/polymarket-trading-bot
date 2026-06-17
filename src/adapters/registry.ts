import type { SignalAdapter, AdapterDescriptor, AdapterContext } from "../types/adapter";
import type { IMarketDataService } from "../services/market-data";
import type { IEventBus } from "../core/events";
import type { ILogger } from "../core/logger";

export interface AdapterRegistryOptions {
  marketData: IMarketDataService;
  events: IEventBus;
  logger: ILogger;
  /** Per-adapter config blobs keyed by adapter name. */
  configs?: Record<string, Record<string, unknown>>;
}

export class AdapterRegistry {
  private descriptors = new Map<string, AdapterDescriptor>();
  private instances = new Map<string, SignalAdapter>();
  private options: AdapterRegistryOptions;
  private running = false;

  constructor(options: AdapterRegistryOptions) {
    this.options = options;
  }

  register(descriptor: AdapterDescriptor): void {
    if (this.running) {
      throw new Error(`Cannot register adapter "${descriptor.name}" while registry is running`);
    }
    if (this.descriptors.has(descriptor.name)) {
      throw new Error(`Adapter "${descriptor.name}" is already registered`);
    }
    this.descriptors.set(descriptor.name, descriptor);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    for (const [name, descriptor] of this.descriptors) {
      const config = this.options.configs?.[name] ?? {};
      const adapter = descriptor.factory(config);
      const ctx: AdapterContext = {
        marketData: this.options.marketData,
        events: this.options.events,
        logger: this.options.logger.child({ adapter: name }),
        config,
      };

      try {
        await adapter.initialize(ctx);
        await adapter.start(ctx);
        this.instances.set(name, adapter);
        this.options.logger.info("Adapter started", { adapter: name });
      } catch (err) {
        this.options.logger.error("Adapter failed to start", {
          adapter: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    await Promise.all(
      [...this.instances.values()].map((adapter) =>
        adapter.shutdown().catch((err) => {
          this.options.logger.error("Adapter shutdown error", {
            adapter: adapter.name,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      )
    );
    this.instances.clear();
  }

  getAdapter(name: string): SignalAdapter | undefined {
    return this.instances.get(name);
  }

  listRegistered(): string[] {
    return [...this.descriptors.keys()];
  }

  listRunning(): string[] {
    return [...this.instances.keys()];
  }

  isRunning(): boolean {
    return this.running;
  }
}
