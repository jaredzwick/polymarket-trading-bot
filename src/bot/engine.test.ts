import { test, expect, beforeEach, mock } from "bun:test";
import { TradingBot, type BotDependencies } from "./engine";
import { EventBus } from "../core/events";
import { SQLiteStore } from "../core/store";
import { Logger } from "../core/logger";
import { MarketDataService } from "../services/market-data";
import { OrderManager } from "../services/order-manager";
import { RiskManager } from "../services/risk-manager";
import { MockPolymarketClient } from "../client";
import { MarketMakerStrategy } from "../strategies/market-maker";
import { Events, type BotConfig } from "../types";

let bot: TradingBot;
let deps: BotDependencies;

beforeEach(() => {
  const logger = new Logger("error");
  const events = new EventBus();
  const store = new SQLiteStore(":memory:");
  const client = new MockPolymarketClient();
  const marketData = new MarketDataService(client, events, logger, 100);
  const riskManager = new RiskManager(
    { maxPositionSize: 100, maxTotalExposure: 1000, maxLossPerTrade: 10, maxDailyLoss: 50, maxOpenOrders: 10 },
    store, events, logger
  );
  const orderManager = new OrderManager(client, store, events, logger, riskManager, true);

  deps = {
    client,
    events,
    store,
    logger,
    marketData,
    orderManager,
    riskManager,
  };

  const config: BotConfig = {
    host: "https://clob.polymarket.com",
    chainId: 137,
    privateKey: "",
    riskLimits: riskManager.getLimits(),
    strategies: [],
    dryRun: true,
  };

  bot = new TradingBot(deps, config);
});

test("TradingBot registers and unregisters strategies", () => {
  const strategy = new MarketMakerStrategy({
    marketData: deps.marketData,
    orderManager: deps.orderManager,
    events: deps.events,
    logger: deps.logger,
  });

  bot.registerStrategy(strategy);
  const status = bot.getStatus();
  expect(status.strategies.length).toBe(1);
  expect(status.strategies[0].name).toBe("market-maker");

  bot.unregisterStrategy("market-maker");
  const status2 = bot.getStatus();
  expect(status2.strategies.length).toBe(0);
});

test("TradingBot starts and stops", async () => {
  bot.setTokens(["token-1"]);

  await bot.start();
  expect(bot.isRunning()).toBe(true);

  await bot.stop();
  expect(bot.isRunning()).toBe(false);
});

test("TradingBot reports status correctly", () => {
  const status = bot.getStatus();

  expect(status).toHaveProperty("running");
  expect(status).toHaveProperty("strategies");
  expect(status).toHaveProperty("positions");
  expect(status).toHaveProperty("openOrders");
  expect(status).toHaveProperty("riskLimits");
  expect(status).toHaveProperty("exposure");
});

test("TradingBot cancels orders on risk breach", async () => {
  const cancelMock = mock(() => Promise.resolve(true));
  deps.orderManager.cancelAllOrders = cancelMock;

  deps.events.emit(Events.RISK_BREACH, { reason: "test" });

  // Give async handler time to run
  await new Promise((r) => setTimeout(r, 10));

  expect(cancelMock).toHaveBeenCalled();
});
