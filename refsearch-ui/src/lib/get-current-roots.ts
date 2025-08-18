import type { FoldersDataType } from "../app";

export function currentRoots(foldersData: FoldersDataType | null): string[] {
  if (!foldersData?.roots?.length) return [];
  // The API already returns normalized roots
  return foldersData.roots.map((r) => r.root);
}
