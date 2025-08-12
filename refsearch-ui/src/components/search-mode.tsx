import { useState } from "react";
import { type Item, searchText } from "../api";
import { DEFAULT_COLUMNS } from "../lib/gallery-constants";
import { ImageGallery } from "./grid/image-gallery";

export default function SearchMode() {
  const [searchQuery, setSearchQuery] = useState("");
  const [queryResults, setQueryResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);

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
          disabled={searching}
          className="flex justify-center bg-primary rounded-lg py-2 w-36 cursor-pointer
          hover:bg-primary-hover font-header text-xl"
        >
          {searching ? "Searching" : "Search"}
        </button>
      </div>

      <div className="max-w-6xl mx-auto">
        <ImageGallery items={queryResults} cols={DEFAULT_COLUMNS} />
      </div>
    </div>
  );
}
