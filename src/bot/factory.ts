import { Chain } from "@polymarket/clob-client";
import { PolymarketClient, MockPolymarketClient, type IPolymarketClient } from "../client";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import { SQLiteStore } from "../core/store";
import { MarketDataService } from "../services/market-data";
import { OrderManager } from "../services/order-manager";
import { RiskManager } from "../services/risk-manager";
import { GammaService } from "../services/gamma";
import { TradingBot, type BotDependencies } from "./engine";
import {
  MarketMakerStrategy,
  MomentumStrategy,
  MeanReversionStrategy,
  BregmanArbStrategy,
  type StrategyContext,
} from "../strategies";
import { Events, type BotConfig, type RiskLimits, type MarketGroup } from "../types";

const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSize: 100,
  maxTotalExposure: 1000,
  maxLossPerTrade: 10,
  maxDailyLoss: 50,
  maxOpenOrders: 10,
};

export function createBot(config: Partial<BotConfig> = {}): { bot: TradingBot; gamma?: GammaService } {
  if (!config.strategies || config.strategies.length === 0) {
    throw new Error("At least one strategy must be specified in the config, specify with STRATEGIES env var (e.g. STRATEGIES=market-maker,momentum)");
  }
  const fullConfig: BotConfig = {
    host: config.host ?? "https://clob.polymarket.com",
    chainId: config.chainId ?? Chain.POLYGON,
    privateKey: config.privateKey ?? "",
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    apiPassphrase: config.apiPassphrase,
    riskLimits: { ...DEFAULT_RISK_LIMITS, ...config.riskLimits },
    strategies: config.strategies ?? ["market-maker"],
    dryRun: config.dryRun ?? true,
  };

  const logger = new Logger(fullConfig.dryRun ? "debug" : "info");
  const events = new EventBus();
  const store = new SQLiteStore(fullConfig.dryRun ? ":memory:" : "bot.db");

  let client: IPolymarketClient;
  if (fullConfig.dryRun || !fullConfig.privateKey) {
    client = new MockPolymarketClient();
    logger.info("Using mock client (dry run mode)");
  } else {
    client = new PolymarketClient(
      fullConfig.host,
      fullConfig.chainId as Chain,
      fullConfig.privateKey,
      fullConfig.apiKey && fullConfig.apiSecret && fullConfig.apiPassphrase
        ? { key: fullConfig.apiKey, secret: fullConfig.apiSecret, passphrase: fullConfig.apiPassphrase }
        : undefined,
      logger
    );
  }

  const riskManager = new RiskManager(fullConfig.riskLimits, store, events, logger);
  const marketData = new MarketDataService(client, events, logger);
  const orderManager = new OrderManager(client, store, events, logger, riskManager, fullConfig.dryRun);

  const deps: BotDependencies = {
    client,
    events,
    store,
    logger,
    marketData,
    orderManager,
    riskManager,
  };

  const bot = new TradingBot(deps, fullConfig);

  // Register strategies
  const strategyCtx: StrategyContext = {
    marketData,
    orderManager,
    events,
    logger,
  };

  let gamma: GammaService | undefined;

  for (const strategyName of fullConfig.strategies) {
    switch (strategyName) {
      case "market-maker":
        bot.registerStrategy(new MarketMakerStrategy(strategyCtx));
        break;
      case "momentum":
        bot.registerStrategy(new MomentumStrategy(strategyCtx));
        break;
      case "mean-reversion":
        bot.registerStrategy(new MeanReversionStrategy(strategyCtx));
        break;
      case "bregman-arb": {
        const bregmanStrategy = new BregmanArbStrategy(strategyCtx, []);
        bot.registerStrategy(bregmanStrategy);

        gamma = new GammaService(events, logger, fullConfig.gamma);
        events.on(Events.MARKET_GROUPS_UPDATED, (event) => {
          const { groups } = event.data as { groups: MarketGroup[] };
          bregmanStrategy.updateMarketGroups(groups);
          const allTokenIds = groups.flatMap((g) => g.tokenIds);
          bot.addTokens(allTokenIds);
        });
        break;
      }
      default:
        logger.warn("Unknown strategy", { name: strategyName });
    }
  }

  return { bot, gamma };
}

export function loadConfigFromEnv(): Partial<BotConfig> {
  return {
    host: process.env.POLYMARKET_HOST,
    chainId: process.env.POLYMARKET_CHAIN_ID ? parseInt(process.env.POLYMARKET_CHAIN_ID) : undefined,
    privateKey: process.env.PRIVATE_KEY,
    apiKey: process.env.POLYMARKET_API_KEY,
    apiSecret: process.env.POLYMARKET_API_SECRET,
    apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE,
    dryRun: process.env.DRY_RUN !== "false",
    strategies: process.env.STRATEGIES?.split(",") ?? undefined,
    gamma: {
      tags: process.env.GAMMA_TAGS?.split(","),
      refreshIntervalMs: process.env.GAMMA_REFRESH_INTERVAL ? parseInt(process.env.GAMMA_REFRESH_INTERVAL) : undefined,
      baseUrl: process.env.GAMMA_BASE_URL,
      limit: process.env.GAMMA_LIMIT ? parseInt(process.env.GAMMA_LIMIT) : undefined,
    },
    riskLimits: {
      maxPositionSize: process.env.MAX_POSITION_SIZE ? parseFloat(process.env.MAX_POSITION_SIZE) : undefined,
      maxTotalExposure: process.env.MAX_TOTAL_EXPOSURE ? parseFloat(process.env.MAX_TOTAL_EXPOSURE) : undefined,
      maxLossPerTrade: process.env.MAX_LOSS_PER_TRADE ? parseFloat(process.env.MAX_LOSS_PER_TRADE) : undefined,
      maxDailyLoss: process.env.MAX_DAILY_LOSS ? parseFloat(process.env.MAX_DAILY_LOSS) : undefined,
      maxOpenOrders: process.env.MAX_OPEN_ORDERS ? parseInt(process.env.MAX_OPEN_ORDERS) : undefined,
    } as RiskLimits,
  };
}
