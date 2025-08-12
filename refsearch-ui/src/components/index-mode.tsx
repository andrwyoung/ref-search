import { useRef, useState } from "react";
import {
  getFolders,
  nukeAll,
  openPath,
  ready,
  reindexStatus,
  removeRoots,
  startReindex,
  type Ready,
  type ReindexStatus,
} from "../api";
import FolderCount from "./ui/folder-count";
import { Progress } from "./ui/progress-bar";
import { confirm, ask } from "@tauri-apps/plugin-dialog";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { FoldersDataType } from "../app";

type IndexModeProps = {
  appReady: Ready | null;
  setAppReady: React.Dispatch<React.SetStateAction<Ready | null>>;
  foldersData: FoldersDataType | null;
  setFoldersData: React.Dispatch<React.SetStateAction<FoldersDataType | null>>;
};

export default function IndexMode({
  appReady,
  setAppReady,
  foldersData,
  setFoldersData,
}: IndexModeProps) {
  const [status, setStatus] = useState<ReindexStatus | null>(null);
  const prevIndexedRef = useRef<number>(0);
  const [rootsInput, setRootsInput] = useState(""); // text field for a folder path

  const pollRef = useRef<number | null>(null); // prevent multiple reindexes from happening

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

  return (
    <div className="bg-secondary-bg mb-2 p-4 rounded-md max-w-4xl mx-auto">
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
          onOpenFile={openPath}
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
  );
}
