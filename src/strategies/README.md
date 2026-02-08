# strategies

Trading strategy implementations.

## What it does

Each strategy receives orderbook snapshots, analyzes market conditions, and returns trade signals. All strategies extend `BaseStrategy` which handles metrics tracking (Sharpe ratio, max drawdown, win rate).

## Files

- **base.ts** — `BaseStrategy` abstract class. Lifecycle management (init/evaluate/shutdown), enable/disable, and automatic performance metrics.
- **market-maker.ts** — `MarketMakerStrategy`. Places limit orders on both sides of the book to capture spread. Skews quotes based on inventory and respects position limits.
- **momentum.ts** — `MomentumStrategy`. Tracks price history over a rolling window. Buys on upward momentum, sells on downward momentum when movement exceeds a configurable threshold.
- **mean-reversion.ts** — `MeanReversionStrategy`. Calculates z-scores from rolling mean/stddev. Buys when price is oversold (negative z-score), sells when overbought (positive z-score).

## Adding a strategy

```ts
class MyStrategy extends BaseStrategy {
  async evaluate(tokenId: string, orderbook: OrderBook): Promise<TradeSignal | null> {
    // your logic here
    return { tokenId, side: "BUY", price: 0.5, size: 10 };
  }
}
```
