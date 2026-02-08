import { BaseStrategy, type StrategyContext } from "./base";
import type { TradeSignal, OrderBook } from "../types";
import { Side } from "../types";

export interface MarketMakerConfig {
  spreadThreshold: number; // Minimum spread to place orders
  orderSize: number;       // Size per order
  maxPositionSize: number; // Max position per token
  priceOffset: number;     // Offset from mid for limit orders
  inventorySkew: number;   // How much to skew price based on inventory
}

export class MarketMakerStrategy extends BaseStrategy {
  readonly name = "market-maker";
  private config: MarketMakerConfig;
  private inventory = new Map<string, number>();

  constructor(ctx: StrategyContext, config: Partial<MarketMakerConfig> = {}) {
    super(ctx);
    this.config = {
      spreadThreshold: 0.02,
      orderSize: 10,
      maxPositionSize: 100,
      priceOffset: 0.005,
      inventorySkew: 0.001,
      ...config,
    };
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal[] {
    if (!this._enabled) return [];

    const { spread, midPrice, bids, asks } = orderBook;

    // Only trade if spread is wide enough
    if (spread < this.config.spreadThreshold) {
      return [];
    }

    const position = this.ctx.orderManager.getPosition(tokenId);
    const currentInventory = position?.size ?? 0;

    // Inventory management: skew quotes based on position
    const skew = currentInventory * this.config.inventorySkew;

    // Determine which side to quote more aggressively
    if (Math.abs(currentInventory) >= this.config.maxPositionSize) {
      // Reduce position
      const side = currentInventory > 0 ? Side.SELL : Side.BUY;
      return [{
        tokenId,
        side,
        confidence: 0.8,
        targetPrice: side === Side.SELL
          ? midPrice + this.config.priceOffset / 2
          : midPrice - this.config.priceOffset / 2,
        size: Math.min(this.config.orderSize, Math.abs(currentInventory)),
        reason: "Inventory reduction",
      }];
    }

    // Place order on the side with more depth (capture spread)
    const bidDepth = bids.reduce((sum, b) => sum + b.size, 0);
    const askDepth = asks.reduce((sum, a) => sum + a.size, 0);

    const side = bidDepth > askDepth ? Side.SELL : Side.BUY;
    const price = side === Side.BUY
      ? midPrice - this.config.priceOffset - skew
      : midPrice + this.config.priceOffset - skew;

    return [{
      tokenId,
      side,
      confidence: Math.min(spread / this.config.spreadThreshold, 1),
      targetPrice: Math.max(0.01, Math.min(0.99, price)),
      size: this.config.orderSize,
      reason: `Spread capture (${(spread * 100).toFixed(2)}%)`,
    }];
  }

  onOrderFilled(orderId: string, tokenId: string, price: number, size: number): void {
    super.onOrderFilled(orderId, tokenId, price, size);
    const current = this.inventory.get(tokenId) ?? 0;
    this.inventory.set(tokenId, current + size);
  }
}
