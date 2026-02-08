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
    <div className="card table-wrapper">
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
  );
}
