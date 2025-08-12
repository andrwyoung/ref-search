import { useEffect, useState } from "react";
import { type Ready, ready, getFolders, type RootBucket } from "./api";
import { listen } from "@tauri-apps/api/event";
import IndexMode from "./components/index-mode";
import SearchMode from "./components/search-mode";

export type FoldersDataType = { total_images: number; roots: RootBucket[] };
export type AppMode = "search" | "index";

export default function App() {
  const [appReady, setAppReady] = useState<Ready | null>(null);
  const [foldersData, setFoldersData] = useState<FoldersDataType | null>(null);

  const [appMode, setAppMode] = useState<AppMode>("search");

  useEffect(() => {
    // load at start and whenever indexing finishes
    ready()
      .then(setAppReady)
      .catch(() => setAppReady(null));
    getFolders()
      .then(setFoldersData)
      .catch(() => setFoldersData(null));
  }, []);

  // grabbing logs from backend
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

  return (
    <div className="my-10 px-3">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center mb-6 max-w-4xl mx-auto">
          <h1 className="font-header text-lg font-medium">Refsearch</h1>
          <span id="refresh-help" className="sr-only">
            Reloads the interface only. Your image files and index are
            unaffected.
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

        <div className="max-w-4xl mx-auto mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setAppMode("search")}
            className={`px-3 py-1 rounded-md border ${
              appMode === "search" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setAppMode("index")}
            className={`px-3 py-1 rounded-md border ${
              appMode === "index" ? "bg-black text-white" : "bg-white"
            }`}
          >
            Index
          </button>
        </div>
      </div>

      <div
        className={appMode === "index" ? "block" : "hidden"}
        aria-hidden={appMode !== "index"}
      >
        <IndexMode
          appReady={appReady}
          setAppReady={setAppReady}
          foldersData={foldersData}
          setFoldersData={setFoldersData}
        />
      </div>

      <div
        className={appMode === "search" ? "block" : "hidden"}
        aria-hidden={appMode !== "search"}
      >
        <SearchMode />
      </div>
    </div>
  );
}
