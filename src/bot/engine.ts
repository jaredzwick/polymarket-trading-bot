import type { IPolymarketClient } from "../client";
import type { IEventBus } from "../core/events";
import type { IStore } from "../core/store";
import type { ILogger } from "../core/logger";
import type { IMarketDataService } from "../services/market-data";
import type { IOrderManager } from "../services/order-manager";
import type { IRiskManager } from "../services/risk-manager";
import type { IStrategy } from "../strategies/base";
import { Events, type TradeSignal, type BotConfig, type OrderType } from "../types";

export interface BotDependencies {
  client: IPolymarketClient;
  events: IEventBus;
  store: IStore;
  logger: ILogger;
  marketData: IMarketDataService;
  orderManager: IOrderManager;
  riskManager: IRiskManager;
}

export class TradingBot {
  private deps: BotDependencies;
  private strategies = new Map<string, IStrategy>();
  private config: BotConfig;
  private running = false;
  private tokenIds: string[] = [];
  private evaluationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deps: BotDependencies, config: BotConfig) {
    this.deps = deps;
    this.config = config;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.deps.events.on(Events.ORDERBOOK_UPDATE, async (event) => {
      if (!this.running) return;
      const { tokenId, orderBook } = event.data as { tokenId: string; orderBook: any };
      await this.evaluateStrategies(tokenId, orderBook);
    });

    this.deps.events.on(Events.ORDER_FILLED, (event) => {
      const { orderId, order, result } = event.data as any;
      for (const strategy of this.strategies.values()) {
        strategy.onOrderFilled(orderId, order.tokenId, order.price, result.filledSize ?? order.size);
      }
    });

    this.deps.events.on(Events.RISK_BREACH, async () => {
      this.deps.logger.info("Risk breach detected, cancelling all orders");
      await this.deps.orderManager.cancelAllOrders();
    });
  }

  registerStrategy(strategy: IStrategy): void {
    this.strategies.set(strategy.name, strategy);
    this.deps.logger.info("Strategy registered", { name: strategy.name });
  }

  unregisterStrategy(name: string): void {
    const strategy = this.strategies.get(name);
    if (strategy) {
      strategy.shutdown();
      this.strategies.delete(name);
    }
  }

  setTokens(tokenIds: string[]): void {
    this.tokenIds = tokenIds;
    this.deps.marketData.subscribe(tokenIds);
  }

  addTokens(tokenIds: string[]): void {
    const newTokens = tokenIds.filter((id) => !this.tokenIds.includes(id));
    if (newTokens.length === 0) return;
    this.tokenIds.push(...newTokens);
    this.deps.marketData.subscribe(newTokens);
    this.deps.logger.debug("Added tokens", { count: newTokens.length });
  }

  getStrategy(name: string): IStrategy | undefined {
    return this.strategies.get(name);
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.deps.logger.info("Starting trading bot", {
      strategies: Array.from(this.strategies.keys()),
      tokens: this.tokenIds.length,
      dryRun: this.config.dryRun,
    });

    for (const strategy of this.strategies.values()) {
      await strategy.initialize();
    }

    await this.deps.marketData.start();

    await this.deps.orderManager.syncOrders();

    this.running = true;
    this.deps.logger.info("Trading bot started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
    }

    await this.deps.orderManager.cancelAllOrders();

    this.deps.marketData.stop();

    for (const strategy of this.strategies.values()) {
      await strategy.shutdown();
    }

    this.deps.logger.info("Trading bot stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  destroy(): void {
    this.deps.store.close();
  }

  private async evaluateStrategies(tokenId: string, orderBook: any): Promise<void> {
    if (this.deps.riskManager.isHalted()) return;

    const signals: TradeSignal[] = [];

    for (const strategy of this.strategies.values()) {
      if (!strategy.enabled) continue;

      try {
        const strategySignals = strategy.evaluate(tokenId, orderBook);
        for (const signal of strategySignals) {
          if (signal.confidence > 0.5) {
            signals.push(signal);
          }
        }
      } catch (err) {
        this.deps.logger.error("Strategy evaluation error", {
          strategy: strategy.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    for (const signal of signals) {
      await this.executeSignal(signal);
    }
  }

  private async executeSignal(signal: TradeSignal): Promise<void> {
    this.deps.logger.info("Executing signal", {
      tokenId: signal.tokenId,
      side: signal.side,
      price: signal.targetPrice,
      size: signal.size,
      reason: signal.reason,
    });

    this.deps.events.emit(Events.STRATEGY_SIGNAL, signal);

    const result = await this.deps.orderManager.submitOrder({
      tokenId: signal.tokenId,
      side: signal.side,
      price: signal.targetPrice,
      size: signal.size,
      type: "GTC" as OrderType,
    });

    if (!result.success) {
      this.deps.logger.warn("Signal execution failed", { error: result.error });
    }
  }

  getStatus(): {
    running: boolean;
    strategies: { name: string; enabled: boolean; metrics: ReturnType<IStrategy["getMetrics"]> }[];
    positions: ReturnType<IOrderManager["getAllPositions"]>;
    openOrders: ReturnType<IOrderManager["getOpenOrders"]>;
    riskLimits: ReturnType<IRiskManager["getLimits"]>;
    exposure: ReturnType<IRiskManager["getExposure"]>;
  } {
    return {
      running: this.running,
      strategies: Array.from(this.strategies.values()).map((s) => ({
        name: s.name,
        enabled: s.enabled,
        metrics: s.getMetrics(),
      })),
      positions: this.deps.orderManager.getAllPositions(),
      openOrders: this.deps.orderManager.getOpenOrders(),
      riskLimits: this.deps.riskManager.getLimits(),
      exposure: this.deps.riskManager.getExposure(),
    };
  }
}
