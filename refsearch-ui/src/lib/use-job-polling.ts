import { useRef, useEffect } from "react";
import {
  getFolders,
  ready,
  reindexStatus,
  type Ready,
  type ReindexStatus,
} from "../api";
import type { FoldersDataType } from "../app";

const isTerminal = (s: ReindexStatus | null) =>
  !!s && (s.state === "done" || s.state === "error" || s.state === "cancelled");

async function refreshApp(
  setAppReady: (r: Ready | null) => void,
  setFoldersData: React.Dispatch<React.SetStateAction<FoldersDataType | null>>
) {
  const now = await ready().catch(() => null);
  setAppReady(now);
  getFolders()
    .then(setFoldersData)
    .catch(() => setFoldersData(null));
}

export function useJobPolling({
  setStatus,
  setAppReady,
  setFoldersData,
}: {
  setStatus: (s: ReindexStatus | null) => void;
  setAppReady: (r: Ready | null) => void;
  setFoldersData: React.Dispatch<React.SetStateAction<FoldersDataType | null>>;
}) {
  const pollRef = useRef<number | null>(null);

  // cleanup once
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      const s = await reindexStatus().catch(() => null);
      if (!s) return;
      setStatus(s);
      if (isTerminal(s)) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        await refreshApp(setAppReady, setFoldersData);
      }
    }, 1000);
  };

  return {
    startPolling,
    clearPolling: () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    },
  };
}
