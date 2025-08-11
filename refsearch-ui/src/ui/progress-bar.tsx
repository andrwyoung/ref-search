import type { ReindexStatus } from "../api";

export function Progress({ s }: { s: ReindexStatus }) {
  const pct = s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {s.state === "running"
          ? `Indexing… ${s.processed}/${s.total} (${pct}%)`
          : s.state === "done"
          ? "Indexing complete"
          : s.state === "error"
          ? `Error: ${s.error ?? "unknown"}`
          : "Idle"}
      </div>
      <div
        style={{
          width: 300,
          height: 8,
          background: "#eee",
          borderRadius: 999,
          overflow: "hidden",
          marginTop: 4,
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "#888" }} />
      </div>
    </div>
  );
}
