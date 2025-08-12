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
    <div>
      <div className="flex gap-2 items-center">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()}
          placeholder="Type to search… (drop an image below)"
          className="flex-1 m-2 p-2 rounded-md border-2 border-black"
        />
        <button
          onClick={doSearch}
          disabled={searching}
          className="flex bg-primary rounded-lg py-1 px-4 cursor-pointer
          hover:bg-primary-hover font-header text-lg"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      <ImageGallery items={queryResults} cols={DEFAULT_COLUMNS} />
    </div>
  );
}
