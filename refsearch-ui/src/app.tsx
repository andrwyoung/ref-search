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

  // on startup. poll until app is ready
  useEffect(() => {
    let mounted = true;
    let attempts = 0;

    const load = async () => {
      attempts++;
      try {
        const [rdy, folders] = await Promise.all([ready(), getFolders()]);
        if (!mounted) return;
        setAppReady(rdy);
        setFoldersData(folders);
      } catch {
        if (attempts < 20) {
          // exponential backoff: 500ms, 1s, 2s, 4s... capped at 30s
          const delay = Math.min(500 * 2 ** (attempts - 1), 30000);
          setTimeout(load, delay);
        }
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  // grabbing logs from backend
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("backend-log", (e) => {
      console.log("[backend-log]", e.payload);
    }).then((off) => (unlisten = off));

    return () => {
      if (unlisten) {
        try {
          unlisten();
        } catch (e) {
          console.log("Backend Log Error: ", e);
        }
      }
    };
  }, []);

  return (
    <div className="my-10 px-3">
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center mb-6 w-full max-w-4xl mx-auto">
          <h1 className="font-header text-lg font-medium px-3">Refsearch</h1>
          <span id="refresh-help" className="sr-only">
            Reloads the interface only. Your image files and index are
            unaffected.
          </span>

          <button
            type="button"
            onClick={() => window.location.reload()}
            aria-label="Reload Window"
            aria-describedby="refresh-help"
            title="Reload Window (Does not affect Index)"
            className="font-body text-xs px-3 py-1 rounded-md cursor-pointer
             hover:text-primary focus:outline-none focus-visible:ring-2
             focus-visible:ring-primary focus-visible:ring-offset-2
             focus-visible:ring-offset-white"
          >
            Reload Window
          </button>
        </div>

        <div className="w-full max-w-4xl mx-auto flex gap-2 font-body">
          <button
            type="button"
            onClick={() => setAppMode("search")}
            className={`px-3 py-1 rounded-md  ${
              appMode === "search" ? "text-primary" : "bg-white cursor-pointer"
            }`}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setAppMode("index")}
            className={`px-3 py-1 rounded-t-md ${
              appMode === "index"
                ? "bg-secondary-bg text-text"
                : "bg-white cursor-pointer"
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
        <SearchMode appReady={appReady} foldersData={foldersData} />
      </div>
    </div>
  );
}
