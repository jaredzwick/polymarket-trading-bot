# client

Polymarket API abstraction layer.

## What it does

Provides a clean interface (`IPolymarketClient`) over the Polymarket CLOB API for fetching markets, orderbooks, prices, placing/canceling orders, and querying balances.

## Files

- **index.ts** — Defines the `IPolymarketClient` interface plus two implementations:
  - `PolymarketClient` — Real API client backed by `@polymarket/clob-client`
  - `MockPolymarketClient` — In-memory mock for dry-run mode and testing. Simulates orderbooks and tracks orders locally.

## Usage

```ts
// Real client
const client = new PolymarketClient({ host, chainId, signer, creds });

// Dry-run / testing
const mock = new MockPolymarketClient();

const book = await client.getOrderBook(tokenId);
await client.placeOrder({ tokenId, side: "BUY", price: 0.55, size: 10 });
```
