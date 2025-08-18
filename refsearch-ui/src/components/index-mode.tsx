import { useEffect, useRef, useState } from "react";
import {
  cancelReindex,
  getFolders,
  nukeAll,
  openPath,
  ready,
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
import { findCoveringRoot } from "../lib/is-already-indexed";
import { currentRoots } from "../lib/get-current-roots";
import { useJobPolling } from "../lib/use-job-polling";

export default function IndexMode({
  appReady,
  setAppReady,
  foldersData,
  setFoldersData,
}: {
  appReady: Ready | null;
  setAppReady: React.Dispatch<React.SetStateAction<Ready | null>>;
  foldersData: FoldersDataType | null;
  setFoldersData: React.Dispatch<React.SetStateAction<FoldersDataType | null>>;
}) {
  const [status, setStatus] = useState<ReindexStatus | null>(null);
  const prevIndexedRef = useRef<number>(0);
  const [rootsInput, setRootsInput] = useState(""); // text field for a folder path

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null); // prevent multiple reindexes from happening

  const { startPolling } = useJobPolling({
    setStatus,
    setAppReady,
    setFoldersData,
  });

  const running = status?.state === "running";
  const phase = status?.phase ?? "idle";
  const canCancel = running && !!status?.job_id && phase !== "finalizing";

  // clean up poll ref
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  async function onStartIndex() {
    const clean = rootsInput.trim();
    if (!clean) return setErrorMessage("No folder path chosen");
    if (running) return;

    const hit = findCoveringRoot(clean, foldersData);
    if (hit) {
      setErrorMessage(
        hit.relation === "same"
          ? "This folder is already indexed"
          : hit.relation === "child"
          ? `This folder is already indexed by: ${hit.root}`
          : "This folder is partially indexed. Remove the child and re-add the parent."
      );
      return;
    }

    const r = await ready().catch(() => null);
    prevIndexedRef.current = r?.indexed ?? 0;

    const started = await startReindex([clean]).catch((e) => {
      setErrorMessage(e?.message || "Failed to start indexing");
      return null;
    });
    if (!started) return;

    setStatus(started);
    startPolling();
  }

  async function onCancelIndex() {
    if (!status?.job_id) {
      console.warn("No job_id to cancel");
      return;
    }
    if (!canCancel) return;
    try {
      await cancelReindex(status.job_id);
    } catch (e) {
      console.error("Cancel failed", e);
    }
  }

  async function pickFolder() {
    setErrorMessage(null);

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
    if (!root || running) return;

    const ok = await confirm(
      `Remove this folder from the index so it won't appear in search?\n\n${root}\n\nYour files are NOT deleted.`,
      { title: "Forget folder", kind: "warning" }
    );
    if (!ok) return;

    try {
      await removeRoots([root]);
      // mark running (no job_id → non-cancellable) and poll
      setStatus({ state: "running", processed: 0, total: 0 } as any);
      startPolling();
    } catch (e: any) {
      alert(e?.message || "Failed to remove folder");
    }
  }

  async function onRescanAll() {
    if (running) return;
    const roots = currentRoots(foldersData);
    if (!roots.length) return setErrorMessage("No indexed folders to rescan.");

    const r = await ready().catch(() => null);
    prevIndexedRef.current = r?.indexed ?? 0;

    const started = await startReindex(roots).catch((e) => {
      setErrorMessage(e?.message || "Failed to start rescan");
      return null;
    });
    if (!started) return;

    setStatus(started);
    startPolling();
  }

  async function onResetIndex() {
    if (running) {
      alert("Indexing is in progress. Please wait or cancel before resetting.");
      return;
    }
    const ok1 = await ask(
      "Clear the local index and thumbnails so you can re-index from scratch.\n\n(Original images are NOT deleted.)\n\nContinue?",
      { title: "Reset index", kind: "warning" }
    );
    if (!ok1) return;

    // const ok2 = await confirm(
    //   "Only cached index data will be removed. Your image files stay on disk.\nProceed?",
    //   { title: "Confirm reset", kind: "warning" }
    // );
    // if (!ok2) return;

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRescanAll}
            disabled={running || !currentRoots(foldersData).length}
            title={
              !currentRoots(foldersData).length
                ? "No indexed folders to rescan"
                : "Re-scan all indexed folders for new/changed files"
            }
            className="border-2 border-emerald-600 px-3 pb-0.5 pt-1 bg-emerald-50
              cursor-pointer hover:bg-primary-hover font-body text-sm 
              rounded-md h-fit text-emerald-700 transition-all duration-200
              disabled:border-gray-300 disabled:text-gray-400 disabled:bg-gray-100
              disabled:cursor-not-allowed disabled:hover:bg-gray-100"
          >
            Rescan Folders
          </button>

          <button
            type="button"
            onClick={onResetIndex}
            disabled={running}
            title="Removes the local index and thumbnails. Your images are untouched."
            className="border-2 border-error px-3 pb-0.5 pt-1
              cursor-pointer hover:bg-rose-200 bg-rose-50 font-body text-sm 
              rounded-md h-fit text-error transition-all duration-200
              disabled:bg-rose-100 disabled:text-rose-400 disabled:cursor-not-allowed"
          >
            Reset Index
          </button>
        </div>
      </div>

      {/* Status + totals */}

      <div className="mb-12">
        <FolderCount
          appReady={appReady}
          foldersData={foldersData}
          onRemoveRoot={onRemoveRoot}
          onOpenFile={openPath}
          running={running}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStartIndex();
        }}
        className="flex flex-col gap-2"
        aria-busy={running ? "true" : "false"}
      >
        <label htmlFor="rootPath" className="font-header text-lg block">
          Add Images:
        </label>

        <div className="flex gap-2">
          {/* Keep this as a non-submit button so it doesn't trigger form submit */}

          <button
            type="button"
            onClick={pickFolder}
            disabled={running}
            className="border-2 border-primary cursor-pointer hover:bg-primary-hover
              font-body px-4 py-0.5 rounded-md disabled:border-gray-300 disabled:text-gray-400 disabled:bg-gray-100
              disabled:cursor-not-allowed disabled:hover:bg-gray-100"
            aria-label="Choose a folder to index"
          >
            Choose Folder
          </button>
          <input
            id="rootPath"
            name="rootPath"
            value={rootsInput}
            onChange={(e) => {
              setErrorMessage(null);
              setRootsInput(e.target.value);
            }}
            placeholder="Choose a folder path"
            className="flex-1 px-3 py-1 rounded-lg font-body bg-white border-0
                 focus:outline-none focus:ring-2 focus:ring-primary"
            autoComplete="off"
            aria-describedby="rootPathHint"
          />
        </div>

        <div className="flex flex-row-reverse gap-4 items-center">
          <button
            type="button"
            onClick={() => {
              if (running) {
                if (canCancel) onCancelIndex();
              } else {
                onStartIndex();
              }
            }}
            disabled={running && !canCancel}
            className={`w-40 font-body px-4 py-1 rounded-md cursor-pointer ${
              running
                ? canCancel
                  ? "bg-rose-500 hover:bg-rose-600 text-white"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-primary hover:bg-primary-hover"
            }
            disabled:bg-gray-200 disabled:text-gray-500
              disabled:cursor-not-allowed disabled:hover:bg-gray-200`}
            title={
              running
                ? canCancel
                  ? "Cancel current indexing"
                  : "Working… cannot cancel"
                : "Index Images in Selected Folder"
            }
          >
            {running ? (canCancel ? "Cancel" : "Working…") : "Index Images!"}
          </button>

          <div className="font-body text-rose-500 text-sm">{errorMessage}</div>
        </div>

        {/* Hidden submit so pressing Enter in the input always works cross-browser */}
        <button type="submit" className="sr-only">
          Start indexing
        </button>

        <span className="sr-only" aria-live="polite">
          {running
            ? "Indexing has started."
            : status?.state === "done"
            ? "Indexing complete."
            : ""}
        </span>
      </form>
      {status?.state === "error" && (
        <div className="font-body text-rose-500 text-sm text-end mt-2 w-full">
          Server Error: {status.error || "Indexing failed."}
        </div>
      )}

      <div className="mt-4 w-full">
        {status && <Progress status={status} />}
      </div>

      {/* “These images have been indexed” message */}
      {/* {status?.state === "done" && appReady && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          Newly indexed this run:{" "}
          <b>{Math.max(0, appReady.indexed - prevIndexedRef.current)}</b>
        </div>
      )} */}
    </div>
  );
}
