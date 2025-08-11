import { useState } from "react";
import type { RootBucket } from "../api";

export default function FolderCount({
  foldersData,
  onRemoveRoot,
  onResetIndex,
  running,
}: {
  foldersData: {
    total_images: number;
    roots: RootBucket[];
  } | null;
  onRemoveRoot?: (root: string) => void;
  onResetIndex?: () => void;
  running?: boolean;
}) {
  const [openRoots, setOpenRoots] = useState<Record<string, boolean>>({});
  function toggleRoot(root: string) {
    setOpenRoots((p) => ({ ...p, [root]: !p[root] }));
  }

  if (!foldersData) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "1rem", // Tailwind's mb-4 is 1rem
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          Indexed folders ({foldersData.total_images} images total)
        </div>
        <button
          onClick={onResetIndex}
          disabled={running}
          title="Removes the local index and thumbnails. Your images are untouched."
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #bdbdbd",
            color: "#333",
            background: "white",
          }}
        >
          Reset index
        </button>
      </div>
      {foldersData.roots.map((r) => (
        <div
          key={r.root}
          style={{ border: "1px solid #eee", borderRadius: 6, marginBottom: 6 }}
        >
          <div
            onClick={() => toggleRoot(r.root)}
            style={{
              padding: "8px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
            title={r.root}
          >
            <div
              style={{
                flex: 1,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 680,
                }}
              >
                {openRoots[r.root] ? "▾" : "▸"} {r.root}
              </div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{r.count}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemoveRoot?.(r.root);
              }}
              disabled={!onRemoveRoot || running}
              title="Remove this folder from the index"
              style={{
                border: "1px solid #ddd",
                background: "white",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 12,
                opacity: running ? 0.6 : 1,
                cursor: running ? "not-allowed" : "pointer",
              }}
            >
              ✖
            </button>
          </div>
          {openRoots[r.root] && (
            <div style={{ padding: "4px 12px" }}>
              {r.folders.map((f) => (
                <div
                  key={f.name}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "2px 0",
                    fontSize: 12,
                  }}
                >
                  <div>{f.name}</div>
                  <div>{f.count}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
