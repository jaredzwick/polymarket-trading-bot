import type { TradingBot } from "../bot/engine";
import type { BotDependencies } from "../bot/engine";
import type { GammaService } from "../services/gamma";
import type { Signal } from "../types/signal";

export interface DashboardContext {
  bot: TradingBot;
  gamma?: GammaService;
  deps: BotDependencies;
  /** Ring buffer of last N signals; populated by setupWebSocket. */
  signalRing?: Signal[];
}
