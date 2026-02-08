import { createBot, loadConfigFromEnv } from "./bot/factory";

async function main() {
  const config = loadConfigFromEnv();
  const bot = createBot(config);

  // Example: trade on a specific market (replace with actual token IDs)
  const tokenIds = process.env.TOKEN_IDS?.split(",") ?? [];
  if (tokenIds.length === 0) {
    console.log("No TOKEN_IDS specified. Running in discovery mode...");
    // In production, you'd fetch active markets and select based on criteria
  }

  bot.setTokens(tokenIds);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

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
  }, 30000);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
