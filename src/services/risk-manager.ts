import type { IEventBus } from "../core/events";
import type { IStore } from "../core/store";
import type { ILogger } from "../core/logger";
import { Events, type OrderRequest, type RiskLimits, type Position } from "../types";

export interface IRiskManager {
  checkOrder(order: OrderRequest): { allowed: boolean; reason?: string };
  updateLimits(limits: Partial<RiskLimits>): void;
  getLimits(): RiskLimits;
  getExposure(): { total: number; byToken: Map<string, number> };
  getDailyPnl(): number;
  isHalted(): boolean;
  halt(reason: string): void;
  resume(): void;
}

export class RiskManager implements IRiskManager {
  private limits: RiskLimits;
  private store: IStore;
  private events: IEventBus;
  private logger: ILogger;
  private halted = false;
  private haltReason?: string;

  constructor(limits: RiskLimits, store: IStore, events: IEventBus, logger: ILogger) {
    this.limits = { ...limits };
    this.store = store;
    this.events = events;
    this.logger = logger.child({ service: "RiskManager" });
  }

  checkOrder(order: OrderRequest): { allowed: boolean; reason?: string } {
    if (this.halted) {
      return { allowed: false, reason: `Trading halted: ${this.haltReason}` };
    }

    // Check position size
    const orderValue = order.price * order.size;
    if (orderValue > this.limits.maxPositionSize) {
      return { allowed: false, reason: `Order value ${orderValue} exceeds max position size ${this.limits.maxPositionSize}` };
    }

    // Check total exposure
    const exposure = this.getExposure();
    if (exposure.total + orderValue > this.limits.maxTotalExposure) {
      return { allowed: false, reason: `Would exceed max total exposure ${this.limits.maxTotalExposure}` };
    }

    // Check open orders count
    const openOrders = this.store.getOpenOrders();
    if (openOrders.length >= this.limits.maxOpenOrders) {
      return { allowed: false, reason: `Max open orders (${this.limits.maxOpenOrders}) reached` };
    }

    // Check daily loss
    const dailyPnl = this.getDailyPnl();
    if (dailyPnl < -this.limits.maxDailyLoss) {
      this.halt("Daily loss limit exceeded");
      return { allowed: false, reason: `Daily loss limit (${this.limits.maxDailyLoss}) exceeded` };
    }

    return { allowed: true };
  }

  updateLimits(limits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.logger.info("Risk limits updated", { limits: this.limits });
  }

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  getExposure(): { total: number; byToken: Map<string, number> } {
    const positions = this.store.getAllPositions();
    const byToken = new Map<string, number>();
    let total = 0;

    for (const pos of positions) {
      const value = Math.abs(pos.size * pos.currentPrice);
      byToken.set(pos.tokenId, value);
      total += value;
    }

    // Add open orders
    const openOrders = this.store.getOpenOrders();
    for (const order of openOrders) {
      const value = order.price * order.size;
      const current = byToken.get(order.tokenId) ?? 0;
      byToken.set(order.tokenId, current + value);
      total += value;
    }

    return { total, byToken };
  }

  getDailyPnl(): number {
    return this.store.getDailyPnl(new Date());
  }

  isHalted(): boolean {
    return this.halted;
  }

  halt(reason: string): void {
    this.halted = true;
    this.haltReason = reason;
    this.logger.warn("Trading halted", { reason });
    this.events.emit(Events.RISK_BREACH, { reason, timestamp: new Date() });
  }

  resume(): void {
    this.halted = false;
    this.haltReason = undefined;
    this.logger.info("Trading resumed");
  }
}
