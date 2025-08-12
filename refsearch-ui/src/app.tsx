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
import { confirm, ask } from "@tauri-apps/plugin-dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("backend-log", (e) => {
      // you can show this in a log pane; for now just console
      // eslint-disable-next-line no-console
      console.log("[backend-log]", e.payload);
    }).then((off) => (unlisten = off));
    return () => {
      try {
        unlisten && unlisten();
      } catch {}
    };
  }, []);

  async function pickFolder() {
    try {
      const sel = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose a folder to index",
      });
      if (typeof sel === "string" && sel) {
        setRootsInput(sel);
        // optionally: start immediately
        // setTimeout(() => onStartIndex(), 0);
      }
    } catch (e) {
      console.error("openDialog failed:", e);
    }
  }

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

    const ok = await confirm(
      `Remove this folder from the index so it won't appear in search?\n\n${root}\n\nYour files are NOT deleted.`,
      { title: "Forget folder", kind: "warning" }
    );
    if (!ok) return;

    try {
      await removeRoots([root]);
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
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

  async function onResetIndex() {
    if (status?.state === "running") {
      alert("Indexing is in progress. Please wait or cancel before resetting.");
      return;
    }
    const ok1 = await ask(
      "This clears the local index and thumbnails so you can re-index from scratch.\n\nYour original images are NOT deleted.\n\nContinue?",
      { title: "Reset index", kind: "warning" }
    );
    if (!ok1) return;

    const ok2 = await confirm(
      "Only cached index data will be removed. Your image files stay on disk.\nProceed?",
      { title: "Confirm reset", kind: "warning" }
    );
    if (!ok2) return;

    try {
      await nukeAll("NUKE"); // backend endpoint can stay the same
      setStatus({ state: "idle", processed: 0, total: 0 } as any);
      const now = await ready().catch(() => null);
      setAppReady(now);
      getFolders()
        .then(setFoldersData)
        .catch(() => setFoldersData(null));
    } catch (e: any) {
      alert(e?.message || "Failed to reset index");
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
    <div className="max-w-4xl mx-auto my-10 px-3">
      <div className="flex justify-between items-center mb-6">
        <h1 className="font-header text-lg font-medium">Refsearch</h1>
        <span id="refresh-help" className="sr-only">
          Reloads the interface only. Your image files and index are unaffected.
        </span>

        <button
          type="button"
          onClick={() => window.location.reload()}
          aria-label="Reload interface"
          aria-describedby="refresh-help"
          title="Reload interface (does not affect your index)"
          className="font-body text-xs px-3 py-1 rounded-md cursor-pointer
             hover:text-primary focus:outline-none focus-visible:ring-2
             focus-visible:ring-primary focus-visible:ring-offset-2
             focus-visible:ring-offset-white"
        >
          Reload View
        </button>
      </div>

      <div className="bg-secondary-bg mb-2 p-4 rounded-md ">
        <div className="flex justify-between">
          <h1 className="font-header text-2xl">Indexed Folders:</h1>
          <button
            type="button"
            onClick={onResetIndex}
            disabled={status?.state === "running"}
            title="Removes the local index and thumbnails. Your images are untouched."
            className="border-2 border-error px-3 pb-0.5 pt-1
            cursor-pointer hover:bg-rose-200 bg-rose-50 font-body text-sm 
            rounded-md h-fit text-error transition-all duration-200"
          >
            Reset Index
          </button>
        </div>

        {/* Status + totals */}

        <div className="mb-12">
          <FolderCount
            foldersData={foldersData}
            onRemoveRoot={onRemoveRoot}
            running={status?.state === "running"}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onStartIndex();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="rootPath" className="font-header text-lg block">
            Add Images:
          </label>

          <div className="flex gap-2">
            {/* Keep this as a non-submit button so it doesn't trigger form submit */}

            <button
              type="button"
              onClick={pickFolder}
              disabled={status?.state === "running"}
              className="border-2 border-primary cursor-pointer hover:bg-primary-hover
              font-body px-4 py-0.5 rounded-md"
              aria-label="Choose a folder to index"
            >
              Choose Folder
            </button>
            <input
              id="rootPath"
              name="rootPath"
              value={rootsInput}
              onChange={(e) => setRootsInput(e.target.value)}
              placeholder="Choose a folder path"
              className="flex-1 px-3 py-1 rounded-lg font-body bg-white border-0
                 focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="off"
              aria-describedby="rootPathHint"
            />
          </div>

          <button
            type="submit"
            disabled={status?.state === "running"}
            className="bg-primary cursor-pointer hover:bg-primary-hover 
            w-40 font-body px-4 py-1 rounded-md self-end"
            aria-label="Choose a folder to index"
          >
            {status?.state === "running" ? "Indexing…" : "Import Images!"}
          </button>

          {/* Hidden submit so pressing Enter in the input always works cross-browser */}
          <button type="submit" className="sr-only">
            Start indexing
          </button>

          {/* <div id="rootPathHint" className="text-sm text-gray-500">
            Your original files are untouched; this only updates the local
            index.
          </div> */}
        </form>
        {status?.state === "error" && (
          <div style={{ color: "#b00020", fontSize: 12, marginTop: 6 }}>
            {status.error || "Indexing failed."}
          </div>
        )}

        <div className="mt-4 w-full">
          {status && <Progress status={status} />}
        </div>

        {/* “These images have been indexed” message */}
        {status?.state === "done" && appReady && (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Newly indexed this run:{" "}
            <b>{Math.max(0, appReady.indexed - prevIndexedRef.current)}</b>
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="Type to search… (drop an image below)"
          className="flex-1 m-2 p-2 rounded-md border-2 border-black"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="flex bg-emerald-200 rounded-lg py-1 px-4 cursor-pointer"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {/* <div style={{ margin: "12px 0" }}>
        <input type="file" accept="image/*" onChange={onFile} />
      </div> */}

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
