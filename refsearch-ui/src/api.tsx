export type Item = {
  path: string;
  score: number;
  width: number;
  height: number;
  folder: string;
  orientation: "landscape" | "portrait" | "square";
};

const BASE = "http://localhost:5179";

export type Ready = {
  ok: boolean;
  has_index: boolean;
  indexed: number;
  mode: "faiss" | "numpy" | null;
};

export type ReindexStatus = {
  state: "running" | "done" | "error" | "idle";
  processed: number;
  total: number;
  error?: string | null;
};

export async function ready(): Promise<Ready> {
  const r = await fetch(`${BASE}/ready`);
  return r.json();
}

export async function startReindex(roots: string[]): Promise<ReindexStatus> {
  const r = await fetch(`${BASE}/reindex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roots }),
  });
  return r.json();
}

export async function reindexStatus(): Promise<ReindexStatus> {
  const r = await fetch(`${BASE}/reindex_status`);
  return r.json();
}

export async function searchText(
  q: string,
  opts?: { topk?: number; folder?: string; orientation?: string }
) {
  const r = await fetch(`${BASE}/search_text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q,
      topk: opts?.topk ?? 50,
      filters: { folder: opts?.folder, orientation: opts?.orientation },
    }),
  });
  return (await r.json()).items as Item[];
}

export async function searchImage(
  file: File,
  opts?: { topk?: number; folder?: string; orientation?: string }
) {
  const fd = new FormData();
  fd.append("file", file);
  if (opts)
    fd.append(
      "filters",
      JSON.stringify({ folder: opts.folder, orientation: opts.orientation })
    );
  const r = await fetch(`${BASE}/search_image`, { method: "POST", body: fd });
  return (await r.json()).items as Item[];
}

export function thumbURL(path: string) {
  return `${BASE}/thumb?path=${encodeURIComponent(path)}`;
}

export async function openPath(path: string) {
  await fetch(`${BASE}/open_path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}
