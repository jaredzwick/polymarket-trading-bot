import { BaseStrategy, type StrategyContext } from "./base";
import type { ILogger } from "../core/logger";
import type { TradeSignal, OrderBook, MarketGroup } from "../types";
import { Side } from "../types";

export interface BregmanArbConfig {
  divergenceThreshold: number; // Min KL-divergence to trigger projection arb
  orderSize: number;
  maxPositionSize: number;
  minEdge: number;             // Min profit per dollar after fees
  feeRate: number;             // Polymarket taker fee
  maxStalenessMs: number;      // Reject stale order books
  statsIntervalMs: number;     // How often to log evaluation summary
}

export interface BregmanArbStats {
  evaluations: number;
  skippedNoGroup: number;
  skippedMissingBook: number;
  skippedStaleBook: number;
  simpleArbSignals: number;
  bregmanArbSignals: number;
  noArbFound: number;
}

export class BregmanArbStrategy extends BaseStrategy {
  readonly name = "bregman-arb";
  private config: BregmanArbConfig;
  private marketGroups: MarketGroup[];
  private tokenToGroup = new Map<string, MarketGroup>();
  private log: ILogger;
  private stats: BregmanArbStats = {
    evaluations: 0,
    skippedNoGroup: 0,
    skippedMissingBook: 0,
    skippedStaleBook: 0,
    simpleArbSignals: 0,
    bregmanArbSignals: 0,
    noArbFound: 0,
  };
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: StrategyContext, marketGroups: MarketGroup[], config: Partial<BregmanArbConfig> = {}) {
    super(ctx);
    this.log = ctx.logger.child({ strategy: "bregman-arb" });
    this.marketGroups = marketGroups;
    this.config = {
      divergenceThreshold: 0.05,
      orderSize: 10,
      maxPositionSize: 50,
      minEdge: 0.01,
      feeRate: 0.02,
      maxStalenessMs: 5000,
      statsIntervalMs: 30_000,
      ...config,
    };

    // Build token → group lookup
    for (const group of marketGroups) {
      for (const tokenId of group.tokenIds) {
        this.tokenToGroup.set(tokenId, group);
      }
    }
  }

  override async initialize(): Promise<void> {
    await super.initialize();
    this.statsInterval = setInterval(() => this.logStats(), this.config.statsIntervalMs);
  }

  override async shutdown(): Promise<void> {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.logStats();
    await super.shutdown();
  }

  getStats(): BregmanArbStats {
    return { ...this.stats };
  }

  updateMarketGroups(groups: MarketGroup[]): void {
    this.marketGroups = groups;
    this.tokenToGroup.clear();
    for (const group of groups) {
      for (const tokenId of group.tokenIds) {
        this.tokenToGroup.set(tokenId, group);
      }
    }
    this.log.info("Market groups replaced", {
      groups: groups.length,
      tokens: this.tokenToGroup.size,
    });
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal[] {
    this.stats.evaluations++;

    if (!this._enabled) return [];

    const group = this.tokenToGroup.get(tokenId);
    if (!group) {
      this.stats.skippedNoGroup++;
      return [];
    }

    // Fetch order books for all sibling tokens
    const books = new Map<string, OrderBook>();
    const now = Date.now();
    for (const siblingId of group.tokenIds) {
      const book = siblingId === tokenId
        ? orderBook
        : this.ctx.marketData.getOrderBook(siblingId);
      if (!book) {
        this.stats.skippedMissingBook++;
        this.log.debug("Missing sibling book", {
          trigger: tokenId.slice(0, 8),
          missingSibling: siblingId.slice(0, 8),
          conditionId: group.conditionId.slice(0, 8),
        });
        return [];
      }
      const staleness = now - book.timestamp.getTime();
      if (staleness > this.config.maxStalenessMs) {
        this.stats.skippedStaleBook++;
        this.log.debug("Stale sibling book", {
          sibling: siblingId.slice(0, 8),
          stalenessMs: staleness,
          maxMs: this.config.maxStalenessMs,
        });
        return [];
      }
      books.set(siblingId, book);
    }

    // Simple arb check: if sum(bestAsk) * (1 + feeRate) < 1.0, buy all
    const simpleArbSignals = this.checkSimpleArb(group, books);
    if (simpleArbSignals.length > 0) {
      this.stats.simpleArbSignals += simpleArbSignals.length;
      return simpleArbSignals;
    }

    // Bregman projection arb
    const bregmanSignals = this.checkBregmanArb(group, books);
    if (bregmanSignals.length > 0) {
      this.stats.bregmanArbSignals += bregmanSignals.length;
    } else {
      this.stats.noArbFound++;
    }
    return bregmanSignals;
  }

  private checkSimpleArb(group: MarketGroup, books: Map<string, OrderBook>): TradeSignal[] {
    let askSum = 0;
    const askPrices = new Map<string, number>();
    const askSizes = new Map<string, number>();

    for (const tokenId of group.tokenIds) {
      const book = books.get(tokenId)!;
      if (book.asks.length === 0) return [];
      const bestAsk = book.asks[0];
      askSum += bestAsk.price;
      askPrices.set(tokenId, bestAsk.price);
      askSizes.set(tokenId, bestAsk.size);
    }

    const totalCost = askSum * (1 + this.config.feeRate);
    const edge = 1.0 - totalCost;

    this.log.debug("Simple arb check", {
      conditionId: group.conditionId.slice(0, 8),
      outcomes: group.tokenIds.length,
      askSum: +askSum.toFixed(4),
      totalCost: +totalCost.toFixed(4),
      edge: +(edge * 100).toFixed(2),
      threshold: +(this.config.minEdge * 100).toFixed(2),
    });

    if (edge < this.config.minEdge) return [];

    this.log.info("Simple arb opportunity found", {
      conditionId: group.conditionId.slice(0, 8),
      askSum: +askSum.toFixed(4),
      edge: `${(edge * 100).toFixed(2)}%`,
      outcomes: group.tokenIds.length,
    });

    // Guaranteed profit: buy all outcomes
    const minLiquidity = Math.min(...Array.from(askSizes.values()));
    let size = Math.min(this.config.orderSize, minLiquidity);

    // Cap size at remaining position capacity across all tokens
    for (const tokenId of group.tokenIds) {
      const position = this.ctx.orderManager.getPosition(tokenId);
      const currentSize = position?.size ?? 0;
      const remaining = this.config.maxPositionSize - currentSize;
      size = Math.min(size, remaining);
    }

    if (size <= 0) return [];

    return group.tokenIds.map((tokenId) => ({
      tokenId,
      side: Side.BUY,
      confidence: Math.min(edge / this.config.minEdge, 1),
      targetPrice: askPrices.get(tokenId)!,
      size,
      reason: `Simple arb: askSum=${askSum.toFixed(4)} edge=${(edge * 100).toFixed(2)}%`,
    }));
  }

  private checkBregmanArb(group: MarketGroup, books: Map<string, OrderBook>): TradeSignal[] {
    const n = group.tokenIds.length;

    // Normalize mid-prices to implied probabilities
    const midPrices = group.tokenIds.map((id) => books.get(id)!.midPrice);
    const priceSum = midPrices.reduce((a, b) => a + b, 0);
    if (priceSum === 0) return [];

    const impliedProbs = midPrices.map((p) => p / priceSum);
    const uniform = 1 / n;

    // Compute KL-divergence from uniform prior: D_KL(uniform || implied)
    let klDiv = 0;
    for (const q of impliedProbs) {
      if (q <= 0) return []; // Degenerate prices
      klDiv += uniform * Math.log(uniform / q);
    }

    this.log.debug("Bregman arb check", {
      conditionId: group.conditionId.slice(0, 8),
      outcomes: n,
      midPrices: midPrices.map((p) => +p.toFixed(4)),
      impliedProbs: impliedProbs.map((p) => +p.toFixed(4)),
      klDivergence: +klDiv.toFixed(6),
      threshold: this.config.divergenceThreshold,
      aboveThreshold: klDiv >= this.config.divergenceThreshold,
    });

    if (klDiv < this.config.divergenceThreshold) return [];

    // Find the most underpriced token (highest uniform/q ratio → lowest implied prob)
    let minProbIdx = 0;
    for (let i = 1; i < n; i++) {
      if (impliedProbs[i] < impliedProbs[minProbIdx]) {
        minProbIdx = i;
      }
    }

    const targetTokenId = group.tokenIds[minProbIdx];
    const book = books.get(targetTokenId)!;

    // Check position limits
    const position = this.ctx.orderManager.getPosition(targetTokenId);
    const currentSize = position?.size ?? 0;
    if (currentSize >= this.config.maxPositionSize) return [];

    // Frank-Wolfe sizing: scale order size by divergence magnitude, cap at 2x base
    const sizeMultiplier = Math.min(klDiv / this.config.divergenceThreshold, 2);
    const availableLiquidity = book.asks.length > 0 ? book.asks[0].size : 0;
    const remainingCapacity = this.config.maxPositionSize - currentSize;
    const size = Math.min(
      this.config.orderSize * sizeMultiplier,
      availableLiquidity,
      remainingCapacity
    );

    if (size <= 0) return [];

    const targetPrice = book.asks.length > 0 ? book.asks[0].price : book.midPrice;
    const confidence = Math.min(klDiv / (this.config.divergenceThreshold * 2), 1);

    this.log.info("Bregman arb opportunity found", {
      conditionId: group.conditionId.slice(0, 8),
      klDivergence: +klDiv.toFixed(4),
      underpricedToken: targetTokenId.slice(0, 8),
      impliedProb: +impliedProbs[minProbIdx].toFixed(4),
      targetPrice: +targetPrice.toFixed(4),
      size: +size.toFixed(2),
      confidence: +confidence.toFixed(2),
    });

    return [{
      tokenId: targetTokenId,
      side: Side.BUY,
      confidence,
      targetPrice,
      size,
      reason: `Bregman projection: KL=${klDiv.toFixed(4)} underpriced=${targetTokenId.slice(0, 8)}`,
    }];
  }

  private logStats(): void {
    const s = this.stats;
    const checked = s.evaluations - s.skippedNoGroup - s.skippedMissingBook - s.skippedStaleBook;
    this.log.info("Evaluation summary", {
      evaluations: s.evaluations,
      skippedNoGroup: s.skippedNoGroup,
      skippedMissingBook: s.skippedMissingBook,
      skippedStaleBook: s.skippedStaleBook,
      fullChecks: checked,
      simpleArbSignals: s.simpleArbSignals,
      bregmanArbSignals: s.bregmanArbSignals,
      noArbFound: s.noArbFound,
      activeGroups: this.marketGroups.length,
      trackedTokens: this.tokenToGroup.size,
    });
  }
}
