import os, sqlite3, time, numpy as np
from PIL import Image
import faiss
import json, time

def _atomic_write(path, write_fn):
    tmp = f"{path}.tmp"
    write_fn(tmp)
    os.replace(tmp, path)

def _atomic_save_npy(path, array, **kwargs):
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as f:
        # allow_pickle required for dtype=object ids
        np.save(f, array, **kwargs)
    os.replace(tmp, path)

def _collect_paths(roots):
    for root in roots:
        for dirpath, _, files in os.walk(root):
            for f in files:
                if os.path.splitext(f)[1].lower() in {".jpg",".jpeg",".png",".webp",".bmp",".tiff",".tif"}:
                    yield root, os.path.join(dirpath, f)

# so that we don't reindex old files
def _is_file_up_to_date(con, path, mtime):
    row = con.execute("SELECT mtime FROM images WHERE path=?", (path,)).fetchone()
    return row is not None and abs(row[0] - mtime) < 1e-6

def ensure_db(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path, check_same_thread=False)
    # Pragmas for better durability/perf in a local app
    con.execute("PRAGMA journal_mode=WAL;")
    con.execute("PRAGMA synchronous=NORMAL;")
    con.execute("""CREATE TABLE IF NOT EXISTS images(
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE,           -- absolute file path
        root TEXT,                  -- absolute root that was indexed
        subpath TEXT,               -- path relative to root
        top_folder TEXT,            -- first component of subpath
        folder TEXT,                -- legacy alias of top_folder (used by current code)
        mtime REAL,
        width INT,
        height INT,
        orientation TEXT            -- landscape|portrait|square
    );""")
    # Helpful indexes for your /folders endpoint & filters
    con.execute("CREATE INDEX IF NOT EXISTS idx_images_root ON images(root);")
    con.execute("CREATE INDEX IF NOT EXISTS idx_images_top_folder ON images(top_folder);")
    con.execute("CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder);")
    con.execute("CREATE INDEX IF NOT EXISTS idx_images_orientation ON images(orientation);")
    con.commit()
    return con

def upsert_meta(con: sqlite3.Connection, path: str, width: int, height: int, mtime: float, root: str):
    # Derive root/subpath/top_folder robustly
    try:
        rel = os.path.relpath(path, root)
        # if rel starts with '..', the file isn't actually under the root; fallback to basename-only
        if rel.startswith(".."):
            rel = os.path.basename(path)
    except Exception:
        rel = os.path.basename(path)

    parts = rel.split(os.sep) if rel else []
    top = parts[0] if parts else ""
    ori = "square" if width == height else ("landscape" if width > height else "portrait")

    con.execute("""
        INSERT OR REPLACE INTO images(path, root, subpath, top_folder, folder, mtime, width, height, orientation)
        VALUES(?,?,?,?,?,?,?,?,?)
    """, (path, root, rel, top, top, mtime, width, height, ori))

def build_index_with_progress(roots, store_dir, model, preprocess, progress_cb=None, batch_size=64, device="cpu"):
    os.makedirs(store_dir, exist_ok=True)
    db = os.path.join(store_dir, "meta.sqlite")
    con = ensure_db(db)

    from core.models import embed_images
    ids, vecs = [], []

    # --- Load previous vectors/ids for carry-forward ---
    old_ids_path  = os.path.join(store_dir, "ids.npy")
    old_vecs_path = os.path.join(store_dir, "vectors.npy")
    old_map = None
    if os.path.exists(old_ids_path) and os.path.exists(old_vecs_path):
        old_ids  = np.load(old_ids_path, allow_pickle=True)
        old_vecs = np.load(old_vecs_path, mmap_mode="r")  # [N,D]
        old_index = {str(p): i for i, p in enumerate(old_ids)}
        old_map = (old_vecs, old_index)

    # --- Collect current files (single pass) ---
    paths = list(_collect_paths(roots))
    total = len(paths)
    current_set = set(p for _, p in paths)

    # --- Remove DB rows for files no longer present ---
    cur = con.cursor()
    to_del = []
    for (p,) in cur.execute("SELECT path FROM images"):
        if p not in current_set:
            to_del.append((p,))
    if to_del:
        cur.executemany("DELETE FROM images WHERE path=?", to_del)
        con.commit()

    batch_imgs, batch_ids = [], []
    done = 0

    for root, p in paths:
        try:
            mtime = os.path.getmtime(p)

            # If unchanged, carry forward existing vector (if we have it)
            if _is_file_up_to_date(con, p, mtime):
                if old_map is not None:
                    old_vecs, old_index = old_map
                    i = old_index.get(p)
                    if i is not None:
                        ids.append(p)
                        # 1xD to match batch shapes for vstack
                        vecs.append(np.array(old_vecs[i], dtype="float32", copy=True)[None, :])
                # still keep meta fresh (optional; skips I/O if you prefer)
                # (We can skip upsert here since unchanged, but harmless either way.)
                done += 1
                if progress_cb and (done % 50 == 0 or done == total):
                    progress_cb(done, total)
                continue

            # Changed or new: read, upsert meta, queue for embedding
            with Image.open(p) as im_raw:
                im = im_raw.convert("RGB")
                width, height = im.size
            upsert_meta(con, p, width, height, mtime, root)

            t = preprocess(im)
            batch_imgs.append(t); batch_ids.append(p)

            if len(batch_imgs) >= batch_size:
                feats = embed_images(model, batch_imgs, device=device)  # [B,D], normalized
                vecs.append(feats); ids.extend(batch_ids)
                batch_imgs, batch_ids = [], []

        except Exception:
            # optionally log the error with the path
            pass
        finally:
            done += 1
            if progress_cb and (done % 50 == 0 or done == total):
                progress_cb(done, total)

    if batch_imgs:
        feats = embed_images(model, batch_imgs, device=device)
        vecs.append(feats); ids.extend(batch_ids)

    con.commit(); con.close()

    if not vecs:
        raise RuntimeError("No images embedded and no carry-forward vectors.")

    # Stack all chunks (both carry-forward rows and embedded batches)
    X = np.vstack(vecs).astype("float32")

    # Write index + arrays atomically
    index = faiss.IndexFlatIP(X.shape[1])
    index.add(X)

    ids_path   = os.path.join(store_dir, "ids.npy")
    index_path = os.path.join(store_dir, "index.faiss")
    vecs_path  = os.path.join(store_dir, "vectors.npy")

    _atomic_save_npy(ids_path, np.array(ids, dtype=object), allow_pickle=True)
    _atomic_write(index_path, lambda p: faiss.write_index(index, p))
    _atomic_save_npy(vecs_path, X)

    # Save config with merged roots
    cfg = {
        "model": "ViT-B-32/laion2b_s34b_b79k",
        "dim": int(X.shape[1]),
        "created": time.time(),
        "roots": roots,  # ← keep
    }
    _atomic_write(os.path.join(store_dir, "config.json"),
                  lambda p: open(p, "w").write(json.dumps(cfg)))

def build_index(roots, store_dir, model, preprocess, batch_size=64, device="cpu"):
    return build_index_with_progress(
        roots=roots,
        store_dir=store_dir,
        model=model,
        preprocess=preprocess,
        progress_cb=None,
        batch_size=batch_size,
        device=device
    )