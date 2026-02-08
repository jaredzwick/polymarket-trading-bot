import type { IMarketDataService } from "../services/market-data";
import type { IOrderManager } from "../services/order-manager";
import type { IEventBus } from "../core/events";
import type { ILogger } from "../core/logger";
import type { TradeSignal, StrategyMetrics, OrderBook } from "../types";

export interface IStrategy {
  readonly name: string;
  readonly enabled: boolean;
  initialize(): Promise<void>;
  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal | null;
  onOrderFilled(orderId: string, tokenId: string, price: number, size: number): void;
  getMetrics(): StrategyMetrics;
  enable(): void;
  disable(): void;
  shutdown(): Promise<void>;
}

export interface StrategyContext {
  marketData: IMarketDataService;
  orderManager: IOrderManager;
  events: IEventBus;
  logger: ILogger;
}

export abstract class BaseStrategy implements IStrategy {
  abstract readonly name: string;
  protected _enabled = true;
  protected ctx: StrategyContext;
  protected metrics: StrategyMetrics = {
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    totalPnl: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
  };
  protected pnlHistory: number[] = [];
  protected peakPnl = 0;

  constructor(ctx: StrategyContext) {
    this.ctx = ctx;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  async initialize(): Promise<void> {
    this.ctx.logger.info(`Strategy ${this.name} initialized`);
  }

  abstract evaluate(tokenId: string, orderBook: OrderBook): TradeSignal | null;

  onOrderFilled(orderId: string, tokenId: string, price: number, size: number): void {
    this.metrics.totalTrades++;
    this.ctx.logger.debug("Order filled", { strategy: this.name, orderId, tokenId, price, size });
  }

  recordPnl(pnl: number): void {
    this.pnlHistory.push(pnl);
    this.metrics.totalPnl += pnl;
    if (pnl > 0) this.metrics.winningTrades++;
    else if (pnl < 0) this.metrics.losingTrades++;

    if (this.metrics.totalPnl > this.peakPnl) {
      this.peakPnl = this.metrics.totalPnl;
    }
    const drawdown = this.peakPnl - this.metrics.totalPnl;
    if (drawdown > this.metrics.maxDrawdown) {
      this.metrics.maxDrawdown = drawdown;
    }

    this.updateSharpe();
  }

  private updateSharpe(): void {
    if (this.pnlHistory.length < 2) return;
    const mean = this.pnlHistory.reduce((a, b) => a + b, 0) / this.pnlHistory.length;
    const variance = this.pnlHistory.reduce((sum, p) => sum + (p - mean) ** 2, 0) / this.pnlHistory.length;
    const stdDev = Math.sqrt(variance);
    this.metrics.sharpeRatio = stdDev > 0 ? mean / stdDev : 0;
  }

  getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  enable(): void {
    this._enabled = true;
    this.ctx.logger.info(`Strategy ${this.name} enabled`);
  }

  disable(): void {
    this._enabled = false;
    this.ctx.logger.info(`Strategy ${this.name} disabled`);
  }

  async shutdown(): Promise<void> {
    this.ctx.logger.info(`Strategy ${this.name} shutdown`);
  }
}
