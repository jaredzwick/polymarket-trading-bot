import { BaseStrategy, type StrategyContext } from "./base";
import type { TradeSignal, OrderBook } from "../types";
import { Side } from "../types";

export interface MomentumConfig {
  windowSize: number;       // Number of price updates to track
  threshold: number;        // Minimum price change to trigger
  orderSize: number;
  maxPositionSize: number;
}

export class MomentumStrategy extends BaseStrategy {
  readonly name = "momentum";
  private config: MomentumConfig;
  private priceHistory = new Map<string, number[]>();

  constructor(ctx: StrategyContext, config: Partial<MomentumConfig> = {}) {
    super(ctx);
    this.config = {
      windowSize: 20,
      threshold: 0.03,
      orderSize: 10,
      maxPositionSize: 50,
      ...config,
    };
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal[] {
    if (!this._enabled) return [];

    const { midPrice } = orderBook;

    // Update price history
    if (!this.priceHistory.has(tokenId)) {
      this.priceHistory.set(tokenId, []);
    }
    const history = this.priceHistory.get(tokenId)!;
    history.push(midPrice);
    if (history.length > this.config.windowSize) {
      history.shift();
    }

    // Need enough data
    if (history.length < this.config.windowSize) {
      return [];
    }

    // Calculate momentum
    const oldest = history[0];
    const priceChange = (midPrice - oldest) / oldest;

    // Check position limits
    const position = this.ctx.orderManager.getPosition(tokenId);
    const currentSize = position?.size ?? 0;

    if (Math.abs(priceChange) < this.config.threshold) {
      return [];
    }

    const side = priceChange > 0 ? Side.BUY : Side.SELL;

    // Don't add to position if already at limit
    if (side === Side.BUY && currentSize >= this.config.maxPositionSize) return [];
    if (side === Side.SELL && currentSize <= -this.config.maxPositionSize) return [];

    const confidence = Math.min(Math.abs(priceChange) / this.config.threshold, 1);

    return [{
      tokenId,
      side,
      confidence,
      targetPrice: side === Side.BUY
        ? midPrice + 0.01  // Pay slightly more for momentum
        : midPrice - 0.01,
      size: this.config.orderSize,
      reason: `Momentum ${priceChange > 0 ? "up" : "down"} ${(priceChange * 100).toFixed(2)}%`,
    }];
  }
}
