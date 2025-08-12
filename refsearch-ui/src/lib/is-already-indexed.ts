import type { FoldersDataType } from "../app";

export type CoverageHit =
  | { root: string; relation: "same" } // selectedPath === root
  | { root: string; relation: "child" } // selectedPath is inside root
  | { root: string; relation: "parent" }; // selectedPath is a parent of an existing root

function norm(p: string) {
  // normalize trailing slashes; keep case as-is (Mac/Win may be case-insensitive, adjust if needed)
  return p.replace(/\/+$/, "");
}

/**
 * Finds the first indexed root that relates to `selectedPath`.
 * Returns null if there is no relationship.
 */
export function findCoveringRoot(
  selectedPath: string,
  foldersData: FoldersDataType | null
): CoverageHit | null {
  if (!foldersData || !selectedPath) return null;

  const sel = norm(selectedPath);
  // Prefer exact/child matches; keep parent detection last so you can decide what to do with it
  for (const r of foldersData.roots) {
    const root = norm(r.root);
    if (sel === root) return { root, relation: "same" };
    if (sel.startsWith(root + "/")) return { root, relation: "child" };
  }
  // Optional: detect when user selects a parent of an already indexed root
  for (const r of foldersData.roots) {
    const root = norm(r.root);
    if (root.startsWith(sel + "/")) return { root, relation: "parent" };
  }
  return null;
}
