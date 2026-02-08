import { Wallet } from "@ethersproject/wallet";
import { ClobClient, type ApiKeyCreds, Chain, Side, OrderType } from "@polymarket/clob-client";
import type { OrderBook, OrderRequest, OrderResult, Market, PriceLevel } from "../types";
import type { ILogger } from "../core/logger";

export interface IPolymarketClient {
  getMarkets(cursor?: string): Promise<{ markets: Market[]; nextCursor?: string }>;
  getMarket(conditionId: string): Promise<Market | null>;
  getOrderBook(tokenId: string): Promise<OrderBook>;
  getMidPrice(tokenId: string): Promise<number>;
  getSpread(tokenId: string): Promise<{ bid: number; ask: number }>;
  placeOrder(order: OrderRequest): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  cancelAllOrders(): Promise<boolean>;
  getOpenOrders(market?: string): Promise<{ orderId: string; tokenId: string; side: Side; price: number; size: number }[]>;
  getBalances(): Promise<{ collateral: number; allowance: number }>;
}

export class PolymarketClient implements IPolymarketClient {
  private client: ClobClient;
  private logger: ILogger;

  constructor(
    host: string,
    chainId: Chain,
    privateKey: string,
    creds?: ApiKeyCreds,
    logger?: ILogger
  ) {
    const wallet = new Wallet(privateKey);
    this.client = new ClobClient(host, chainId, wallet, creds);
    this.logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => this.logger! };
  }

  async getMarkets(cursor?: string): Promise<{ markets: Market[]; nextCursor?: string }> {
    const response = await this.client.getMarkets(cursor);
    const markets: Market[] = response.data.map((m: any) => ({
      conditionId: m.condition_id,
      question: m.question,
      slug: m.market_slug,
      tokens: m.tokens?.map((t: any) => ({
        tokenId: t.token_id,
        outcome: t.outcome,
        price: t.price,
      })) ?? [],
      active: m.active,
      closed: m.closed,
      endDate: m.end_date_iso ? new Date(m.end_date_iso) : undefined,
    }));
    return { markets, nextCursor: response.next_cursor || undefined };
  }

  async getMarket(conditionId: string): Promise<Market | null> {
    try {
      const m = await this.client.getMarket(conditionId);
      return {
        conditionId: m.condition_id,
        question: m.question,
        slug: m.market_slug,
        tokens: m.tokens?.map((t: any) => ({
          tokenId: t.token_id,
          outcome: t.outcome,
          price: t.price,
        })) ?? [],
        active: m.active,
        closed: m.closed,
        endDate: m.end_date_iso ? new Date(m.end_date_iso) : undefined,
      };
    } catch {
      return null;
    }
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    const ob = await this.client.getOrderBook(tokenId);
    const bids: PriceLevel[] = ob.bids.map((b) => ({
      price: parseFloat(b.price),
      size: parseFloat(b.size),
    }));
    const asks: PriceLevel[] = ob.asks.map((a) => ({
      price: parseFloat(a.price),
      size: parseFloat(a.size),
    }));
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 1;
    return {
      tokenId,
      bids,
      asks,
      spread: bestAsk - bestBid,
      midPrice: (bestBid + bestAsk) / 2,
      timestamp: new Date(ob.timestamp),
    };
  }

  async getMidPrice(tokenId: string): Promise<number> {
    const result = await this.client.getMidpoint(tokenId);
    return parseFloat(result.mid);
  }

  async getSpread(tokenId: string): Promise<{ bid: number; ask: number }> {
    const result = await this.client.getSpread(tokenId);
    return { bid: parseFloat(result.bid), ask: parseFloat(result.ask) };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    try {
      this.logger.info("Placing order", { tokenId: order.tokenId, side: order.side, price: order.price, size: order.size });
      const result = await this.client.createAndPostOrder(
        {
          tokenID: order.tokenId,
          side: order.side,
          price: order.price,
          size: order.size,
          expiration: order.expiration,
        },
        undefined,
        order.type as OrderType.GTC | OrderType.GTD
      );
      if (result.success) {
        this.logger.info("Order placed", { orderId: result.orderID });
        return {
          success: true,
          orderId: result.orderID,
          filledSize: result.takingAmount ? parseFloat(result.takingAmount) : undefined,
          avgFillPrice: result.makingAmount && result.takingAmount
            ? parseFloat(result.makingAmount) / parseFloat(result.takingAmount)
            : undefined,
        };
      }
      this.logger.warn("Order failed", { error: result.errorMsg });
      return { success: false, error: result.errorMsg };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error("Order error", { error });
      return { success: false, error };
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.cancelOrder({ orderID: orderId });
      this.logger.info("Order cancelled", { orderId });
      return true;
    } catch (err) {
      this.logger.error("Cancel failed", { orderId, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  async cancelAllOrders(): Promise<boolean> {
    try {
      await this.client.cancelAll();
      this.logger.info("All orders cancelled");
      return true;
    } catch (err) {
      this.logger.error("Cancel all failed", { error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  async getOpenOrders(market?: string): Promise<{ orderId: string; tokenId: string; side: Side; price: number; size: number }[]> {
    const orders = await this.client.getOpenOrders({ market });
    return orders.map((o) => ({
      orderId: o.id,
      tokenId: o.asset_id,
      side: o.side as Side,
      price: parseFloat(o.price),
      size: parseFloat(o.original_size) - parseFloat(o.size_matched),
    }));
  }

  async getBalances(): Promise<{ collateral: number; allowance: number }> {
    const result = await this.client.getBalanceAllowance({ asset_type: "COLLATERAL" as any });
    return {
      collateral: parseFloat(result.balance),
      allowance: parseFloat(result.allowance),
    };
  }
}

// Mock client for testing/dry-run
export class MockPolymarketClient implements IPolymarketClient {
  private orders = new Map<string, { orderId: string; tokenId: string; side: Side; price: number; size: number }>();
  private orderCounter = 0;

  async getMarkets(): Promise<{ markets: Market[]; nextCursor?: string }> {
    return { markets: [] };
  }

  async getMarket(): Promise<Market | null> {
    return null;
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    return {
      tokenId,
      bids: [{ price: 0.49, size: 100 }, { price: 0.48, size: 200 }],
      asks: [{ price: 0.51, size: 100 }, { price: 0.52, size: 200 }],
      spread: 0.02,
      midPrice: 0.5,
      timestamp: new Date(),
    };
  }

  async getMidPrice(): Promise<number> {
    return 0.5;
  }

  async getSpread(): Promise<{ bid: number; ask: number }> {
    return { bid: 0.49, ask: 0.51 };
  }

  async placeOrder(order: OrderRequest): Promise<OrderResult> {
    const orderId = `mock-${++this.orderCounter}`;
    this.orders.set(orderId, {
      orderId,
      tokenId: order.tokenId,
      side: order.side,
      price: order.price,
      size: order.size,
    });
    return { success: true, orderId };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return this.orders.delete(orderId);
  }

  async cancelAllOrders(): Promise<boolean> {
    this.orders.clear();
    return true;
  }

  async getOpenOrders(): Promise<{ orderId: string; tokenId: string; side: Side; price: number; size: number }[]> {
    return Array.from(this.orders.values());
  }

  async getBalances(): Promise<{ collateral: number; allowance: number }> {
    return { collateral: 10000, allowance: 10000 };
  }
}
