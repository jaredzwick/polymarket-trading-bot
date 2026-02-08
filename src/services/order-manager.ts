import type { IPolymarketClient } from "../client";
import type { IEventBus } from "../core/events";
import type { IStore } from "../core/store";
import type { ILogger } from "../core/logger";
import type { IRiskManager } from "./risk-manager";
import type { OrderRequest, OrderResult, Position } from "../types";
import { Side, OrderType, Events } from "../types";

export interface IOrderManager {
  submitOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  cancelAllOrders(): Promise<boolean>;
  getOpenOrders(): { orderId: string; tokenId: string; side: Side; price: number; size: number }[];
  getPosition(tokenId: string): Position | null;
  getAllPositions(): Position[];
  syncOrders(): Promise<void>;
}

export class OrderManager implements IOrderManager {
  private client: IPolymarketClient;
  private store: IStore;
  private events: IEventBus;
  private logger: ILogger;
  private riskManager: IRiskManager;
  private dryRun: boolean;

  constructor(
    client: IPolymarketClient,
    store: IStore,
    events: IEventBus,
    logger: ILogger,
    riskManager: IRiskManager,
    dryRun = false
  ) {
    this.client = client;
    this.store = store;
    this.events = events;
    this.logger = logger.child({ service: "OrderManager" });
    this.riskManager = riskManager;
    this.dryRun = dryRun;
  }

  async submitOrder(order: OrderRequest): Promise<OrderResult> {
    // Risk check
    const riskCheck = this.riskManager.checkOrder(order);
    if (!riskCheck.allowed) {
      this.logger.warn("Order rejected by risk manager", { reason: riskCheck.reason });
      return { success: false, error: riskCheck.reason };
    }

    if (this.dryRun) {
      const orderId = `dry-${Date.now()}`;
      this.logger.info("Dry run order", { orderId, ...order });
      return { success: true, orderId };
    }

    const result = await this.client.placeOrder(order);

    if (result.success && result.orderId) {
      this.store.saveOrder({ ...order, orderId: result.orderId, status: "open" });
      this.events.emit(Events.ORDER_FILLED, { orderId: result.orderId, order, result });

      // Update position if filled
      if (result.filledSize && result.filledSize > 0) {
        this.updatePosition(order.tokenId, order.side, result.filledSize, result.avgFillPrice ?? order.price);
      }
    }

    return result;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (this.dryRun) {
      this.logger.info("Dry run cancel", { orderId });
      return true;
    }

    const success = await this.client.cancelOrder(orderId);
    if (success) {
      this.store.updateOrderStatus(orderId, "cancelled");
      this.events.emit(Events.ORDER_CANCELLED, { orderId });
    }
    return success;
  }

  async cancelAllOrders(): Promise<boolean> {
    if (this.dryRun) {
      this.logger.info("Dry run cancel all");
      return true;
    }

    const success = await this.client.cancelAllOrders();
    if (success) {
      const openOrders = this.store.getOpenOrders();
      for (const order of openOrders) {
        this.store.updateOrderStatus(order.orderId, "cancelled");
      }
    }
    return success;
  }

  getOpenOrders(): { orderId: string; tokenId: string; side: Side; price: number; size: number }[] {
    return this.store.getOpenOrders().map((o) => ({
      orderId: o.orderId,
      tokenId: o.tokenId,
      side: o.side,
      price: o.price,
      size: o.size,
    }));
  }

  getPosition(tokenId: string): Position | null {
    return this.store.getPosition(tokenId);
  }

  getAllPositions(): Position[] {
    return this.store.getAllPositions();
  }

  async syncOrders(): Promise<void> {
    const remoteOrders = await this.client.getOpenOrders();
    const localOrders = this.store.getOpenOrders();
    const remoteIds = new Set(remoteOrders.map((o) => o.orderId));

    for (const local of localOrders) {
      if (!remoteIds.has(local.orderId)) {
        this.store.updateOrderStatus(local.orderId, "filled_or_cancelled");
      }
    }
    this.logger.debug("Orders synced", { remote: remoteOrders.length, local: localOrders.length });
  }

  private updatePosition(tokenId: string, side: Side, size: number, price: number): void {
    const existing = this.store.getPosition(tokenId);
    let newPosition: Position;

    if (!existing || existing.size === 0) {
      newPosition = {
        tokenId,
        market: "",
        size: side === Side.BUY ? size : -size,
        avgEntryPrice: price,
        currentPrice: price,
        unrealizedPnl: 0,
        realizedPnl: 0,
        side,
      };
    } else {
      const isSameSide = (existing.side === Side.BUY && side === Side.BUY) ||
                         (existing.side === Side.SELL && side === Side.SELL);
      if (isSameSide) {
        const totalSize = existing.size + (side === Side.BUY ? size : -size);
        const totalCost = (existing.size * existing.avgEntryPrice) + (size * price);
        newPosition = {
          ...existing,
          size: totalSize,
          avgEntryPrice: totalCost / Math.abs(totalSize),
          currentPrice: price,
        };
      } else {
        const netSize = existing.size + (side === Side.BUY ? size : -size);
        const realizedPnl = existing.realizedPnl + (size * (price - existing.avgEntryPrice)) * (existing.side === Side.BUY ? 1 : -1);
        newPosition = {
          ...existing,
          size: netSize,
          realizedPnl,
          currentPrice: price,
          side: netSize >= 0 ? Side.BUY : Side.SELL,
        };
      }
    }

    newPosition.unrealizedPnl = (newPosition.currentPrice - newPosition.avgEntryPrice) * newPosition.size;
    this.store.savePosition(newPosition);
    this.events.emit(Events.POSITION_CHANGED, { tokenId, position: newPosition });
  }
}
