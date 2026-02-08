import { BaseStrategy, type StrategyContext } from "./base";
import type { TradeSignal, OrderBook } from "../types";
import { Side } from "../types";

export interface MeanReversionConfig {
  windowSize: number;
  stdDevThreshold: number; // Number of std devs to trigger
  orderSize: number;
  maxPositionSize: number;
}

export class MeanReversionStrategy extends BaseStrategy {
  readonly name = "mean-reversion";
  private config: MeanReversionConfig;
  private priceHistory = new Map<string, number[]>();

  constructor(ctx: StrategyContext, config: Partial<MeanReversionConfig> = {}) {
    super(ctx);
    this.config = {
      windowSize: 50,
      stdDevThreshold: 2,
      orderSize: 10,
      maxPositionSize: 50,
      ...config,
    };
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal[] {
    if (!this._enabled) return [];

    const { midPrice } = orderBook;

    if (!this.priceHistory.has(tokenId)) {
      this.priceHistory.set(tokenId, []);
    }
    const history = this.priceHistory.get(tokenId)!;
    history.push(midPrice);
    if (history.length > this.config.windowSize) {
      history.shift();
    }

    if (history.length < this.config.windowSize) {
      return [];
    }

    // Calculate mean and std dev
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((sum, p) => sum + (p - mean) ** 2, 0) / history.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return [];

    const zScore = (midPrice - mean) / stdDev;

    // Position check
    const position = this.ctx.orderManager.getPosition(tokenId);
    const currentSize = position?.size ?? 0;

    if (Math.abs(zScore) < this.config.stdDevThreshold) {
      return [];
    }

    // Price is too high, expect it to revert down -> SELL
    // Price is too low, expect it to revert up -> BUY
    const side = zScore > 0 ? Side.SELL : Side.BUY;

    if (side === Side.BUY && currentSize >= this.config.maxPositionSize) return [];
    if (side === Side.SELL && currentSize <= -this.config.maxPositionSize) return [];

    const confidence = Math.min(Math.abs(zScore) / (this.config.stdDevThreshold * 2), 1);

    return [{
      tokenId,
      side,
      confidence,
      targetPrice: mean, // Target the mean
      size: this.config.orderSize,
      reason: `Mean reversion z=${zScore.toFixed(2)} (mean=${mean.toFixed(3)})`,
    }];
  }
}
