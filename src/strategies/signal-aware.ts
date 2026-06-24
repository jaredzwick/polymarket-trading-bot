import { BaseStrategy, type StrategyContext } from "./base";
import type { TradeSignal, OrderBook, BotEvent } from "../types";
import type { Signal } from "../types/signal";
import { Events, Side } from "../types";
import { isSignalFresh } from "../types/guards";

export interface SignalAwareConfig {
  /** How long to retain signals in the buffer (ms). Default: 120_000. */
  signalTtlMs: number;
  /** Minimum signal confidence to consider. Default: 0.5. */
  minSignalConfidence: number;
  /** Order size when a signal fires. Default: 10. */
  orderSize: number;
  /** Base price offset for limit orders. Default: 0.01. */
  priceOffset: number;
}

const DEFAULT_CONFIG: SignalAwareConfig = {
  signalTtlMs: 120_000,
  minSignalConfidence: 0.5,
  orderSize: 10,
  priceOffset: 0.01,
};

/**
 * A strategy that subscribes to the signal bus and incorporates incoming
 * signals into its order decisions. Demonstrates how adapters wire into
 * existing strategies via the EventBus.
 *
 * Signal types handled:
 *   - "trade" / "inference" → BUY or SELL based on suggestedSide / payload
 *   - "news" / "sentiment"  → raise bid/ask confidence proportionally
 *   - "risk"                → suppress order size proportionally
 */
export class SignalAwareStrategy extends BaseStrategy {
  readonly name = "signal-aware";

  private config: SignalAwareConfig;
  private signalBuffer = new Map<string, Signal[]>();
  private unsubscribe?: () => void;

  constructor(ctx: StrategyContext, config: Partial<SignalAwareConfig> = {}) {
    super(ctx);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  override async initialize(): Promise<void> {
    await super.initialize();

    this.unsubscribe = this.ctx.events.on<Signal>(
      Events.SIGNAL_EMITTED,
      (event: BotEvent<Signal>) => this.onSignal(event.data)
    );
  }

  override async shutdown(): Promise<void> {
    this.unsubscribe?.();
    await super.shutdown();
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal[] {
    if (!this._enabled) return [];

    this.pruneExpiredSignals();

    const signals = this.getRelevantSignals(tokenId);
    if (signals.length === 0) return [];

    const riskSignals = signals.filter((s) => s.kind === "risk");
    const actionSignals = signals.filter(
      (s) => s.kind === "trade" || s.kind === "inference"
    );

    // Risk signals suppress sizing
    const riskMultiplier = riskSignals.reduce((acc, s) => acc * (1 - s.confidence * 0.5), 1);
    if (riskMultiplier < 0.2) {
      this.ctx.logger.warn("Signal-aware: risk signals suppressing all orders", { tokenId });
      return [];
    }

    const signals_ = actionSignals;
    if (signals_.length === 0) return [];

    // Aggregate signal votes
    let buyVotes = 0;
    let sellVotes = 0;

    for (const sig of signals_) {
      const side = this.extractSide(sig);
      if (side === "BUY") buyVotes += sig.confidence;
      else if (side === "SELL") sellVotes += sig.confidence;
    }

    const totalVotes = buyVotes + sellVotes;
    if (totalVotes === 0) return [];

    const netBias = (buyVotes - sellVotes) / totalVotes; // -1 to +1
    if (Math.abs(netBias) < 0.2) return []; // Too ambiguous

    const side = netBias > 0 ? Side.BUY : Side.SELL;
    const confidence = Math.abs(netBias);
    const adjustedSize = Math.max(
      1,
      Math.floor(this.config.orderSize * riskMultiplier * confidence)
    );

    const targetPrice =
      side === Side.BUY
        ? orderBook.midPrice + this.config.priceOffset
        : orderBook.midPrice - this.config.priceOffset;

    return [
      {
        tokenId,
        side,
        confidence,
        targetPrice,
        size: adjustedSize,
        reason: `Signal consensus: buy=${buyVotes.toFixed(2)} sell=${sellVotes.toFixed(2)} risk×${riskMultiplier.toFixed(2)}`,
        triggeringSignalIds: signals_.map((s) => s.id),
      },
    ];
  }

  getSignalBuffer(): Map<string, Signal[]> {
    return this.signalBuffer;
  }

  private onSignal(signal: Signal): void {
    if (signal.confidence < this.config.minSignalConfidence) return;

    const key = signal.tokenId ?? "__global__";
    if (!this.signalBuffer.has(key)) {
      this.signalBuffer.set(key, []);
    }
    this.signalBuffer.get(key)!.push(signal);

    this.ctx.logger.debug("Signal-aware: buffered signal", {
      kind: signal.kind,
      source: signal.source,
      tokenId: signal.tokenId,
      confidence: signal.confidence,
    });
  }

  private pruneExpiredSignals(): void {
    const cutoff = new Date(Date.now() - this.config.signalTtlMs);
    for (const [key, signals] of this.signalBuffer) {
      const fresh = signals.filter(
        (s) => s.timestamp >= cutoff && isSignalFresh(s)
      );
      if (fresh.length === 0) this.signalBuffer.delete(key);
      else this.signalBuffer.set(key, fresh);
    }
  }

  private getRelevantSignals(tokenId: string): Signal[] {
    const specific = this.signalBuffer.get(tokenId) ?? [];
    const global = this.signalBuffer.get("__global__") ?? [];
    return [...specific, ...global];
  }

  private extractSide(signal: Signal): "BUY" | "SELL" | null {
    if (signal.kind === "trade") {
      const p = signal.payload as { side?: string };
      if (p.side === "BUY" || p.side === "SELL") return p.side;
    }
    if (signal.kind === "inference") {
      const meta = signal.metadata as { suggestedSide?: string } | undefined;
      if (meta?.suggestedSide === "BUY" || meta?.suggestedSide === "SELL") {
        return meta.suggestedSide;
      }
    }
    return null;
  }
}
