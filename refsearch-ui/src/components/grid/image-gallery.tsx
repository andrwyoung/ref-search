import { openPath, thumbURL, type Item } from "../../api";
import { DEFAULT_COLUMNS, DEFAULT_GAP } from "../../lib/gallery-constants";

export function ImageGallery({
  items,
  cols = DEFAULT_COLUMNS, // fixed columns
  gap = DEFAULT_GAP, // px gap between squares
  className = "",
}: {
  items: Item[];
  cols?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid ${className}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap,
      }}
    >
      {items.map((it) => (
        <SquareThumb key={it.path} item={it} />
      ))}
    </div>
  );
}

// Square, fixed-size thumb that preserves aspect by cropping (object-cover)
export function SquareThumb({ item }: { item: Item }) {
  return (
    <div
      role="button"
      tabIndex={0}
      // onDoubleClick={() => openPath(item.path)}
      onClick={() => openPath(item.path)}
      onKeyDown={(e) => e.key === "Enter" && openPath(item.path)}
      title={`${item.path}`}
      // title={`${item.path}\n${item.score.toFixed(3)}`}
      className="relative w-full overflow-hidden rounded-lg outline-none 
      hover:ring-primary hover:ring-4 cursor-pointer transition-all duration-200
      focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Open ${item.path}`}
    >
      {/* Square box via CSS aspect-ratio; no separate scroll container */}
      <div className="aspect-square relative">
        <img
          src={thumbURL(item.path)}
          alt=""
          draggable
          className="absolute inset-0 w-full h-full object-cover "
        />
      </div>
    </div>
  );
}
