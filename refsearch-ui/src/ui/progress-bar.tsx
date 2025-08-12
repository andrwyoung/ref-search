import type { ReindexStatus } from "../api";

export function Progress({ status }: { status: ReindexStatus }) {
  const percentDone =
    status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;

  const label =
    status.state === "running"
      ? `Indexing… ${status.processed}/${status.total} (${percentDone}%)`
      : status.state === "done"
      ? "Indexing complete!"
      : status.state === "error"
      ? `Error: ${status.error ?? "unknown"}`
      : "Idle";

  return (
    <div className="my-4 flex flex-col items-center">
      <div className="text-xs font-body text-gray-600">{label}</div>

      <div
        className="min-w-lg w-lg h-4 bg-white rounded-lg overflow-hidden mt-1"
        role="progressbar"
        aria-valuenow={percentDone}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Indexing progress"
      >
        <div
          className="h-full bg-primary transition-all duration-200"
          style={{ width: `${percentDone}%` }}
        />
      </div>
    </div>
  );
}
