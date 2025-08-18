import { useState } from "react";
import { FaCaretDown, FaFolderOpen, FaImages, FaXmark } from "react-icons/fa6";
import type { Ready, RootBucket } from "../../api";

export default function FolderCount({
  appReady,
  foldersData,
  onRemoveRoot,
  onOpenFile,
  running,
}: {
  appReady: Ready | null;
  foldersData: {
    total_images: number;
    roots: RootBucket[];
  } | null;
  onRemoveRoot: (root: string) => void;
  onOpenFile: (pathname: string) => void;
  running?: boolean;
}) {
  const [openRoots, setOpenRoots] = useState<Record<string, boolean>>({});
  function toggleRoot(root: string) {
    setOpenRoots((p) => ({ ...p, [root]: !p[root] }));
  }

  return (
    <div className="mt-3">
      {appReady ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "1rem", // Tailwind's mb-4 is 1rem
            }}
          >
            <h1 className="font-body text-sm">
              Total Images: {foldersData?.total_images ?? "-"}
            </h1>
          </div>
          {foldersData && foldersData.total_images !== 0 ? (
            foldersData.roots.map((r) => (
              <div
                key={r.root}
                className="border border-gray-200 rounded mb-1.5"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleRoot(r.root)}
                  className="px-2.5 py-2 flex items-center gap-2 w-full text-left cursor-pointer"
                  title={r.root}
                >
                  <div className="flex-1 flex justify-between gap-3 text-sm font-body">
                    <div className="flex items-center gap-1 truncate max-w-2xl">
                      <FaCaretDown
                        className={`${
                          openRoots[r.root] ? "" : "-rotate-90"
                        } transition-transform duration-200`}
                      />
                      {r.root}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-row items-center gap-2 text-md font-header mr-2">
                        <FaImages />
                        {r.count}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log("opening root: ", r.root);
                          onOpenFile(r.root);
                        }}
                        type="button"
                        title="Open this folder"
                        className="text-gray-400 hover:text-blue-500 cursor-pointer 
                            transition-all duration-200 text-md
                            hover:scale-110 rounded-full "
                      >
                        <FaFolderOpen />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveRoot?.(r.root);
                        }}
                        disabled={!onRemoveRoot || running}
                        type="button"
                        title="Forget this folder"
                        className="text-border hover:text-error cursor-pointer hover:scale-115
                   rounded-full text-lg"
                      >
                        <FaXmark />
                      </button>
                    </div>
                  </div>
                </div>

                {openRoots[r.root] && (
                  <div className="px-3 py-1">
                    {r.folders.map((f) => (
                      <div
                        key={f.name}
                        className="flex justify-between py-0.5 text-xs font-body px-4"
                      >
                        <div>{f.name}</div>
                        {!/\.(jpe?g|png|gif|bmp|webp|tiff)$/i.test(f.name) && (
                          <div>{f.count}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div
              className="w-full flex items-center justify-center h-12 
           font-body "
            >
              No Folders Indexed. Choose a folder to Index
            </div>
          )}
        </>
      ) : (
        <div
          className="w-full flex items-center justify-center h-12 
          font-body mt-8"
        >
          Loading folders...
        </div>
      )}
    </div>
  );
}
