import { useApi } from "../hooks/use-api";

interface MarketGroup {
  conditionId: string;
  tokenIds: string[];
}

export function MarketGroups() {
  const { data: groups, loading } = useApi<MarketGroup[]>("/api/markets", 30000);

  if (loading && !groups) return <div className="loading">Loading market groups...</div>;
  if (!groups?.length) return <div className="card empty-state">No market groups discovered</div>;

  return (
    <div className="card">
      <div className="card-title">
        {groups.length} Groups / {groups.reduce((s, g) => s + g.tokenIds.length, 0)} Tokens
      </div>
      {groups.map((g) => (
        <div className="market-group" key={g.conditionId}>
          <div className="market-group-id">{g.conditionId}</div>
          <div className="market-group-count">
            {g.tokenIds.length} tokens: {g.tokenIds.map((t) => t.slice(0, 8)).join(", ")}
          </div>
        </div>
      ))}
    </div>
  );
}
