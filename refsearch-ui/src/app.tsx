import { useEffect, useRef, useState } from "react";
import { FixedSizeGrid as Grid } from "react-window";
import {
  searchText,
  searchImage,
  thumbURL,
  openPath,
  type Item,
  type Ready,
  type ReindexStatus,
  ready,
  startReindex,
  reindexStatus,
  getFolders,
  type RootBucket,
  removeRoots,
  nukeAll,
} from "./api";
import { Progress } from "./ui/progress-bar";
import FolderCount from "./ui/folder-count";

export default function App() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const [rootsInput, setRootsInput] = useState(""); // text field for a folder path
  const [status, setStatus] = useState<ReindexStatus | null>(null);
  const [appReady, setAppReady] = useState<Ready | null>(null);
  const prevIndexedRef = useRef<number>(0);

  const pollRef = useRef<number | null>(null); // prevent multiple reindexes from happening

  // folders
  const [foldersData, setFoldersData] = useState<{
    total_images: number;
    roots: RootBucket[];
  } | null>(null);

  useEffect(() => {
    // load at start and whenever indexing finishes
    ready()
      .then(setAppReady)
      .catch(() => setAppReady(null));
    getFolders()
      .then(setFoldersData)
      .catch(() => setFoldersData(null));
  }, []);

  async function onStartIndex() {
    const clean = rootsInput.trim();
    if (!clean || status?.state === "running") return;

    const r = await ready().catch(() => null);
    prevIndexedRef.current = r?.indexed ?? 0;

    const started = await startReindex([clean]);
    setStatus(started);

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollRef.current = window.setInterval(async () => {
      const s = await reindexStatus().catch(() => null);
      if (!s) return;
      setStatus(s);
      if (s.state === "done" || s.state === "error") {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        const now = await ready().catch(() => null);
        setAppReady(now);
        getFolders()
          .then(setFoldersData)
          .catch(() => setFoldersData(null)); // ← refresh list
      }
    }, 1000);
  }

  async function doSearch() {
    if (!q.trim()) return;
    setLoading(true);
    try {
      setItems(await searchText(q.trim(), { topk: 60 }));
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setLoading(true);
    try {
      setItems(await searchImage(f, { topk: 60 }));
    } finally {
      setLoading(false);
      e.currentTarget.value = "";
    }
  }

  async function onRemoveRoot(root: string) {
    if (!root || status?.state === "running") return;
    const ok = window.confirm(`Remove this folder from the index?\n\n${root}`);
    if (!ok) return;

    // kick off remove job (server rebuilds with survivors)
    try {
      await removeRoots([root]);
      // start polling exactly like reindex
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      // mark as running so UI disables buttons
      setStatus({ state: "running", processed: 0, total: 0 } as any);

      pollRef.current = window.setInterval(async () => {
        const s = await reindexStatus().catch(() => null);
        if (!s) return;
        setStatus(s);
        if (s.state === "done" || s.state === "error") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          const now = await ready().catch(() => null);
          setAppReady(now);
          getFolders()
            .then(setFoldersData)
            .catch(() => setFoldersData(null));
        }
      }, 1000);
    } catch (e: any) {
      alert(e?.message || "Failed to remove folder");
    }
  }

  async function onNukeAll() {
    if (status?.state === "running") {
      alert("Indexing is in progress. Please wait or cancel before nuking.");
      return;
    }
    const ok = window.confirm(
      "This will delete the index, vectors, config, thumbnails, and clear the DB.\n\nType NUKE in the next prompt to confirm."
    );
    if (!ok) return;
    const typed = window.prompt('Type "NUKE" to confirm:');
    if (typed !== "NUKE") return;

    try {
      await nukeAll("NUKE");
      setStatus({ state: "idle", processed: 0, total: 0 } as any);
      const now = await ready().catch(() => null);
      setAppReady(now);
      getFolders()
        .then(setFoldersData)
        .catch(() => setFoldersData(null));
    } catch (e: any) {
      alert(e?.message || "Failed to wipe index");
    }
  }

  const cellW = 180,
    cellH = 180,
    cols = 5;
  function Cell({ columnIndex, rowIndex, style }: any) {
    const idx = rowIndex * cols + columnIndex;
    if (idx >= items.length) return <div style={style} />;
    const it = items[idx];
    return (
      <div
        style={{ ...style, padding: 6 }}
        onDoubleClick={() => openPath(it.path)}
        title={`${it.path}\n${it.score.toFixed(3)}`}
      >
        <img
          src={thumbURL(it.path)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: 8,
          }}
        />
      </div>
    );
  }

  const rows = Math.ceil(items.length / cols);

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: "0 12px",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
        RefSearch
      </h1>
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          border: "1px solid #ddd",
          borderRadius: 8,
        }}
      >
        <div style={{ marginBottom: 8, fontWeight: 600 }}>
          Index your library
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={rootsInput}
            onChange={(e) => setRootsInput(e.target.value)}
            placeholder="Paste a folder path (e.g., /Users/you/Pictures/Refs)"
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={onStartIndex}
            disabled={status?.state === "running"}
            style={{ padding: "8px 12px", borderRadius: 6 }}
          >
            {status?.state === "running" ? "Indexing…" : "Start indexing"}
          </button>

          {status?.state === "error" && (
            <div style={{ color: "#b00020", fontSize: 12, marginTop: 6 }}>
              {status.error || "Indexing failed."}
            </div>
          )}
        </div>

        {/* Status + totals */}
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {status && <Progress s={status} />}
          {/* <div style={{ fontSize: 12, opacity: 0.8 }}>
            {appReady?.has_index ? (
              <>
                Total indexed: <b>{appReady.indexed}</b>
              </>
            ) : (
              <>No index yet</>
            )}
          </div> */}
        </div>

        {/* “These images have been indexed” message */}
        {status?.state === "done" && appReady && (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Newly indexed this run:{" "}
            <b>{Math.max(0, appReady.indexed - prevIndexedRef.current)}</b>
          </div>
        )}

        <FolderCount
          foldersData={foldersData}
          onRemoveRoot={onRemoveRoot}
          onNukeAll={onNukeAll}
          running={status?.state === "running"}
        />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="Type to search… (drop an image below)"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #ccc",
          }}
        />
        <button
          onClick={doSearch}
          disabled={loading}
          style={{ padding: "10px 16px", borderRadius: 8 }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      <div style={{ margin: "12px 0" }}>
        <input type="file" accept="image/*" onChange={onFile} />
      </div>

      <Grid
        columnCount={cols}
        columnWidth={cellW}
        height={600}
        rowCount={rows}
        rowHeight={cellH}
        width={cellW * cols + 12}
      >
        {Cell}
      </Grid>
    </div>
  );
}
