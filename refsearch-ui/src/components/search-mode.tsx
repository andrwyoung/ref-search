import { useState } from "react";
import { type Item, type Ready, type RootBucket, searchText } from "../api";
import { DEFAULT_COLUMNS } from "../lib/gallery-constants";
import { ImageGallery } from "./grid/image-gallery";

export default function SearchMode({
  appReady,
  foldersData,
}: {
  appReady: Ready | null;

  foldersData: {
    total_images: number;
    roots: RootBucket[];
  } | null;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [queryResults, setQueryResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);

  const nothingIndexed = appReady && foldersData?.total_images === 0;
  const notReady = !!(!appReady || nothingIndexed);

  async function doSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      setQueryResults(await searchText(searchQuery.trim(), { topk: 60 }));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="mt-8">
      <div className="flex gap-4 items-center mx-auto mb-8 max-w-4xl">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="Describe the Image"
          className="flex-1 px-4 py-2
              bg-white border-2 text-lg
                focus:outline-none focus:ring-2 focus:ring-primary
                rounded-lg font-body"
        />
        <button
          onClick={doSearch}
          disabled={searching || notReady}
          className="flex justify-center bg-primary rounded-lg py-2 w-36 
          cursor-pointerhover:bg-primary-hover font-header text-xl
          disabled:bg-gray-300 disabled:text-gray-500
          disabled:cursor-not-allowed disabled:hover:bg-gray-300"
        >
          {searching ? "Searching" : "Search"}
        </button>
      </div>

      {!appReady && (
        <div className="h-12 font-body mx-auto max-w-4xl pl-2">
          Initializing...
        </div>
      )}

      {nothingIndexed && (
        <div className="h-12 font-body mx-auto max-w-4xl ">
          No Images Indexed Yet. Click on the Index Tab
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        <ImageGallery items={queryResults} cols={DEFAULT_COLUMNS} />
      </div>
    </div>
  );
}
