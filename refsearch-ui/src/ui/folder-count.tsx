import { useState } from "react";
import type { RootBucket } from "../api";

export default function FolderCount({
  foldersData,
}: {
  foldersData: {
    total_images: number;
    roots: RootBucket[];
  } | null;
}) {
  const [openRoots, setOpenRoots] = useState<Record<string, boolean>>({});

  function toggleRoot(root: string) {
    setOpenRoots((m) => ({ ...m, [root]: !m[root] }));
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        border: "1px solid #ddd",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div style={{ fontWeight: 600 }}>Indexed folders</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Total images: <b>{foldersData?.total_images ?? 0}</b>
        </div>
      </div>

      {!foldersData || foldersData.roots.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          No folders yet.
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {foldersData.roots.map((r) => (
            <div
              key={r.root}
              style={{ border: "1px solid #eee", borderRadius: 8 }}
            >
              <div
                onClick={() => toggleRoot(r.root)}
                style={{
                  padding: "8px 10px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                }}
                title={r.root}
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

              {openRoots[r.root] && r.folders.length > 0 && (
                <div style={{ padding: "6px 10px 10px 24px" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      rowGap: 4,
                    }}
                  >
                    {r.folders.map((f) => (
                      <div
                        key={`${r.root}__${f.name}`}
                        style={{ display: "contents" }}
                      >
                        <div style={{ fontSize: 13 }}>{f.name || "(root)"}</div>
                        <div
                          style={{
                            fontSize: 12,
                            textAlign: "right",
                            opacity: 0.8,
                          }}
                        >
                          {f.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
