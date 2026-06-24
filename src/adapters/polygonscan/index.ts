import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import { Events } from "../../types";

export interface PolygonscanAdapterConfig {
  /** Polygonscan API key. Required — adapter no-ops when absent. */
  apiKey?: string;
  /** USDC contract on Polygon. Default: canonical USDC address. */
  usdcContract: string;
  /** Minimum USDC transfer size (in units, not wei) to flag as whale. Default: 100_000. */
  whaleThresholdUsdc: number;
  /** Poll interval in ms. Default: 60_000. */
  refreshIntervalMs: number;
  /** How many blocks back to scan per poll. Default: 20. */
  blockWindow: number;
}

const DEFAULT_CONFIG: PolygonscanAdapterConfig = {
  usdcContract: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  whaleThresholdUsdc: 100_000,
  refreshIntervalMs: 60_000,
  blockWindow: 20,
};

interface TokenTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  timeStamp: string;
  blockNumber: string;
}

interface PolygonscanResponse {
  status: string;
  result?: TokenTx[] | string;
}

export interface WhalePayload {
  txHash: string;
  from: string;
  to: string;
  amountUsdc: number;
  direction: "inflow" | "outflow";
}

export class PolygonscanAdapter implements SignalAdapter {
  readonly name = "polygonscan-whale";
  readonly version = "1.0.0";

  private config: PolygonscanAdapterConfig = { ...DEFAULT_CONFIG };
  private ctx?: AdapterContext;
  private timer?: ReturnType<typeof setInterval>;
  private seenTxHashes = new Set<string>();
  private stopped = false;
  private healthy = true;
  private lastBlock = 0;

  async initialize(ctx: AdapterContext): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...(ctx.config as Partial<PolygonscanAdapterConfig>) };
    const key = this.config.apiKey ?? Bun.env.POLYGONSCAN_API_KEY;
    if (!key) {
      ctx.logger.warn("POLYGONSCAN_API_KEY not set — PolygonscanAdapter will not emit signals");
    }
    this.config.apiKey = key;
    this.stopped = false;
    ctx.logger.info("PolygonscanAdapter initialized", {
      whaleThresholdUsdc: this.config.whaleThresholdUsdc,
    });
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    if (!this.config.apiKey) return; // Guard: no key = silent no-op

    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        ctx.logger.error("Polygonscan poll error", { error: String(err) });
        this.healthy = false;
      });
    }, this.config.refreshIntervalMs);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  diagnostics(): Record<string, unknown> {
    return {
      seenTxHashes: this.seenTxHashes.size,
      lastBlock: this.lastBlock,
      whaleThresholdUsdc: this.config.whaleThresholdUsdc,
    };
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.ctx || !this.config.apiKey) return;

    const url = new URL("https://api.polygonscan.com/api");
    url.searchParams.set("module", "account");
    url.searchParams.set("action", "tokentx");
    url.searchParams.set("contractaddress", this.config.usdcContract);
    url.searchParams.set("sort", "desc");
    url.searchParams.set("offset", "50");
    url.searchParams.set("page", "1");
    url.searchParams.set("apikey", this.config.apiKey);

    let txList: TokenTx[];
    try {
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        this.ctx.logger.warn("Polygonscan API non-200", { status: resp.status });
        return;
      }
      const data = (await resp.json()) as PolygonscanResponse;
      if (data.status !== "1" || !Array.isArray(data.result)) {
        this.ctx.logger.debug("Polygonscan no results");
        this.healthy = true;
        return;
      }
      txList = data.result;
      this.healthy = true;
    } catch {
      this.ctx.logger.warn("Polygonscan fetch failed");
      this.healthy = false;
      return;
    }

    for (const tx of txList) {
      if (this.seenTxHashes.has(tx.hash)) continue;
      this.seenTxHashes.add(tx.hash);

      const decimals = parseInt(tx.tokenDecimal, 10) || 6;
      const amountUsdc = parseFloat(tx.value) / 10 ** decimals;

      if (amountUsdc < this.config.whaleThresholdUsdc) continue;

      const confidence = Math.min(amountUsdc / (this.config.whaleThresholdUsdc * 10), 1);

      const signal: Signal<WhalePayload> = {
        id: crypto.randomUUID(),
        kind: "risk",
        source: this.name,
        confidence,
        payload: {
          txHash: tx.hash,
          from: tx.from,
          to: tx.to,
          amountUsdc,
          direction: "inflow",
        },
        timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        metadata: { blockNumber: tx.blockNumber },
      };

      this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
      this.ctx.logger.info("Whale transfer detected", {
        amountUsdc: amountUsdc.toFixed(0),
        from: tx.from.slice(0, 10),
      });
    }
  }
}

export const polygonscanDescriptor: AdapterDescriptor = {
  name: "polygonscan-whale",
  version: "1.0.0",
  description: "Watches Polygon USDC transfers for whale activity; requires POLYGONSCAN_API_KEY.",
  factory: (_config) => new PolygonscanAdapter(),
};
