import { createBot, loadConfigFromEnv } from "./bot/factory";
import type { BregmanArbStrategy } from "./strategies/bregman-arb";

async function main() {
  const config = loadConfigFromEnv();
  const { bot, gamma } = createBot(config);

  const tokenIds = new Set(process.env.TOKEN_IDS?.split(",").filter(Boolean) ?? []);

  if (tokenIds.size === 0 && !gamma) {
    console.log("No TOKEN_IDS specified. Running in discovery mode...");
  }

  bot.setTokens(Array.from(tokenIds));

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    gamma?.stop();
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start Gamma first so groups are populated before bot polling begins
  if (gamma) {
    await gamma.start();
  }

  await bot.start();

  // Status reporting
  setInterval(() => {
    const status = bot.getStatus();
    console.log("\n--- Bot Status ---");
    console.log(`Running: ${status.running}`);
    console.log(`Positions: ${status.positions.length}`);
    console.log(`Open Orders: ${status.openOrders.length}`);
    console.log(`Total Exposure: ${status.exposure.total.toFixed(2)}`);
    for (const s of status.strategies) {
      console.log(`Strategy ${s.name}: trades=${s.metrics.totalTrades} pnl=${s.metrics.totalPnl.toFixed(2)}`);
    }

    // Arb-specific stats
    const bregman = bot.getStrategy("bregman-arb") as BregmanArbStrategy | undefined;
    if (bregman) {
      const arbStats = bregman.getStats();
      console.log(`--- Arb Stats ---`);
      console.log(`Evaluations: ${arbStats.evaluations} | Full checks: ${arbStats.evaluations - arbStats.skippedNoGroup - arbStats.skippedMissingBook - arbStats.skippedStaleBook}`);
      console.log(`Skipped: noGroup=${arbStats.skippedNoGroup} missingBook=${arbStats.skippedMissingBook} stale=${arbStats.skippedStaleBook}`);
      console.log(`Signals: simpleArb=${arbStats.simpleArbSignals} bregmanArb=${arbStats.bregmanArbSignals} noArb=${arbStats.noArbFound}`);
    }

    if (gamma) {
      const groups = gamma.getMarketGroups();
      console.log(`Gamma: ${groups.length} active groups, ${groups.reduce((s, g) => s + g.tokenIds.length, 0)} tokens`);
    }
  }, 30000);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
