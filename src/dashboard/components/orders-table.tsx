import { useApi } from "../hooks/use-api";

interface Order {
  orderId: string;
  tokenId: string;
  side: string;
  price: number;
  size: number;
}

export function OrdersTable() {
  const { data: orders, loading } = useApi<Order[]>("/api/orders", 5000);

  if (loading && !orders) return <div className="loading">Loading orders...</div>;
  if (!orders?.length) return <div className="card empty-state">No open orders</div>;

  return (
    <>
      {/* Desktop table */}
      <div className="card table-wrapper mobile-table">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Token</th>
              <th>Side</th>
              <th>Price</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.orderId}>
                <td>{o.orderId.slice(0, 12)}...</td>
                <td>{o.tokenId.slice(0, 12)}...</td>
                <td>
                  <span className={o.side === "BUY" ? "positive" : "negative"}>{o.side}</span>
                </td>
                <td>${o.price.toFixed(4)}</td>
                <td>{o.size.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="mobile-cards data-cards">
        {orders.map((o) => (
          <div className="card data-card" key={o.orderId}>
            <div className="data-card-header">
              <span className="mono" style={{ fontSize: 12 }}>{o.tokenId.slice(0, 14)}...</span>
              <span className={`signal-badge ${o.side === "BUY" ? "buy" : "sell"}`}>{o.side}</span>
            </div>
            <span className="data-card-label">Order</span>
            <span className="data-card-value">{o.orderId.slice(0, 12)}...</span>
            <span className="data-card-label">Price</span>
            <span className="data-card-value">${o.price.toFixed(4)}</span>
            <span className="data-card-label">Size</span>
            <span className="data-card-value">{o.size.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
