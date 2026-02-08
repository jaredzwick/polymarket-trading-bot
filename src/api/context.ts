import type { TradingBot } from "../bot/engine";
import type { BotDependencies } from "../bot/engine";
import type { GammaService } from "../services/gamma";

export interface DashboardContext {
  bot: TradingBot;
  gamma?: GammaService;
  deps: BotDependencies;
}
