import type { Side, OrderType, Trade, OpenOrder, OrderBookSummary } from "@polymarket/clob-client";

// Re-export common types
export { Side, OrderType } from "@polymarket/clob-client";
export type { Trade, OpenOrder, OrderBookSummary, ApiKeyCreds } from "@polymarket/clob-client";

// Core domain types
export interface Market {
  conditionId: string;
  question: string;
  slug: string;
  tokens: TokenInfo[];
  active: boolean;
  closed: boolean;
  endDate?: Date;
}

export interface TokenInfo {
  tokenId: string;
  outcome: string;
  price: number;
}

export interface Position {
  tokenId: string;
  market: string;
  size: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  side: Side;
}

export interface OrderRequest {
  tokenId: string;
  side: Side;
  price: number;
  size: number;
  type: OrderType;
  expiration?: number;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  filledSize?: number;
  avgFillPrice?: number;
}

export interface TradeSignal {
  tokenId: string;
  side: Side;
  confidence: number; // 0-1
  targetPrice: number;
  size: number;
  reason: string;
}

export interface RiskLimits {
  maxPositionSize: number;
  maxTotalExposure: number;
  maxLossPerTrade: number;
  maxDailyLoss: number;
  maxOpenOrders: number;
}

export interface MarketGroup {
  conditionId: string;
  tokenIds: string[];
}

export interface GammaConfig {
  baseUrl: string;
  tags: string[];
  refreshIntervalMs: number;
  active: boolean;
  closed: boolean;
  limit: number;
}

export interface BotConfig {
  host: string;
  chainId: number;
  privateKey: string;
  apiKey?: string;
  apiSecret?: string;
  apiPassphrase?: string;
  riskLimits: RiskLimits;
  strategies: string[];
  dryRun: boolean;
  gamma?: Partial<GammaConfig>;
}

export interface PriceLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  tokenId: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  spread: number;
  midPrice: number;
  timestamp: Date;
}

export interface StrategyState {
  name: string;
  enabled: boolean;
  positions: Map<string, Position>;
  pendingOrders: Map<string, OrderRequest>;
  metrics: StrategyMetrics;
}

export interface StrategyMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export type EventType =
  | "orderbook_update"
  | "trade_executed"
  | "order_filled"
  | "order_cancelled"
  | "position_changed"
  | "strategy_signal"
  | "risk_breach"
  | "market_update"
  | "market_groups_updated";

export const Events = {
  ORDERBOOK_UPDATE: "orderbook_update",
  TRADE_EXECUTED: "trade_executed",
  ORDER_FILLED: "order_filled",
  ORDER_CANCELLED: "order_cancelled",
  POSITION_CHANGED: "position_changed",
  STRATEGY_SIGNAL: "strategy_signal",
  RISK_BREACH: "risk_breach",
  MARKET_UPDATE: "market_update",
  MARKET_GROUPS_UPDATED: "market_groups_updated",
} as const satisfies Record<string, EventType>;

export interface BotEvent<T = unknown> {
  type: EventType;
  timestamp: Date;
  data: T;
}
