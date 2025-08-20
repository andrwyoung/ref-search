# server.py
import os, io, json, platform, subprocess
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")
from typing import Optional
import uuid
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from PIL import Image
import numpy as np
import sqlite3
import uvicorn
import threading
import time
from PIL import Image, ImageOps

# ---- CONFIG ----
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_STORE = os.path.join(PROJECT_ROOT, "store")

# Allow override via env var; expand ~ and make absolute
STORE_DIR = os.path.abspath(os.path.expanduser(os.environ.get("REFSEARCH_STORE", DEFAULT_STORE)))
PORT = int(os.environ.get("REFSEARCH_PORT", "54999"))
THUMB_DIR = os.path.join(STORE_DIR, "thumbs")
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(STORE_DIR, exist_ok=True)

# ---- LOAD CORE (your existing code) ----
from core.commands.nuke import _wipe_store
from core.helpers.helpers import _detect_overlaps, _norm_path
from core.models import load_model, embed_texts, embed_images  # you already have these
import faiss

class SearchFilters(BaseModel):
    folder: Optional[str] = None
    orientation: Optional[str] = None

class SearchTextBody(BaseModel):
    q: str
    topk: int = 50
    filters: Optional[SearchFilters] = None

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:54998", "http://127.0.0.1:54998", "tauri://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- GLOBALS (stay warm) ----
STATE = {
    "device": None,
    "model": None,
    "preprocess": None,
    "tokenizer": None,
    "index": None,
    "ids": None,
    "con": None,
    "dim": 0
}
STATE["cancel_event"] = threading.Event()
STATE["swap_lock"]   = threading.RLock()

def pick_device():
    import torch
    if torch.cuda.is_available(): return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available(): return "mps"
    return "cpu"

def try_load_store():
    try:
        return load_store()  
    except Exception:
        return None, None, None  # if no index yet

def load_store():
    idx_path = os.path.join(STORE_DIR, "index.faiss")
    ids_path = os.path.join(STORE_DIR, "ids.npy")
    db_path  = os.path.join(STORE_DIR, "meta.sqlite")
    cfg_path = os.path.join(STORE_DIR, "config.json")

    for p in (cfg_path, idx_path, ids_path, db_path):
        if not os.path.exists(p):
            raise RuntimeError(f"{os.path.basename(p)} missing. Rebuild index.")

    cfg = json.load(open(cfg_path))
    index = faiss.read_index(idx_path)
    if cfg.get("dim") != index.d:
        raise RuntimeError("Index/model dimension mismatch. Please reindex.")

    ids = np.load(ids_path, allow_pickle=True)
    con = sqlite3.connect(db_path, check_same_thread=False, timeout=5.0)
    con.execute("PRAGMA busy_timeout=5000;") # give a timeout
    return index, ids, con

# force reset indexes
def _reload_store_from_disk():
    """Reload index/ids/DB from disk and hot-swap into STATE, or clear if missing."""
    try:
        idx, ids, con = load_store()
    except Exception:
        idx, ids, con = None, None, None

    with STATE["swap_lock"]:
        # close old con if we’re swapping to a new one
        old_con = STATE.get("con")
        STATE["index"], STATE["ids"], STATE["con"] = idx, ids, con
        STATE["dim"] = 0 if idx is None else idx.d
        try:
            if old_con and old_con is not con:
                old_con.close()
        except Exception:
            pass

def get_meta(path):
    con = STATE.get("con")
    if con is None:
        return (None, None, None, None)
    cur = con.cursor()
    row = cur.execute("SELECT width,height,orientation,folder FROM images WHERE path=?", (path,)).fetchone()
    if not row: return (None, None, None, None)
    return row # width,height,orientation,folder

def ensure_thumb(path, size=512):
    import hashlib, os
    ver = "v2"  # bump if you change the logic again
    mtime = int(os.path.getmtime(path)) if os.path.exists(path) else 0
    key = hashlib.md5(f"{path}|{size}|{ver}|{mtime}".encode("utf-8")).hexdigest() + ".jpg"
    out = os.path.join(THUMB_DIR, key)
    if not os.path.exists(out):
        try:
            im = Image.open(path)
            # Honor EXIF orientation for JPEGs, etc.
            im = ImageOps.exif_transpose(im)

            # If transparent, composite over white so background isn't black
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                im = im.convert("RGBA")
                bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
                im = Image.alpha_composite(bg, im).convert("RGB")
            else:
                im = im.convert("RGB")

            # Resize thumbnail
            im.thumbnail((size, size), Image.LANCZOS)  # or Resampling.LANCZOS

            # Save as high-quality JPEG
            im.save(out, "JPEG", quality=95, optimize=True, progressive=True)
        except Exception:
            return None
    return out

@app.on_event("startup")
def startup():
    STATE["device"] = pick_device()
    STATE["model"], STATE["preprocess"], STATE["tokenizer"] = load_model(device=STATE["device"])

    try:
        import torch
        from PIL import Image
        import numpy as np
        # tiny 1×1 RGB to tickle encode_image path
        dummy = Image.new("RGB", (1, 1))
        q = STATE["preprocess"](dummy)
        with torch.no_grad():
            _ = STATE["model"].encode_image(torch.stack([q]).to(STATE["device"]))
    except Exception:
        pass

    idx, ids, con = try_load_store()
    STATE["index"], STATE["ids"], STATE["con"] = idx, ids, con
    STATE["dim"] = 0 if idx is None else idx.d

@app.get("/ready")
def ready():
    has_index = STATE["index"] is not None and STATE["ids"] is not None and STATE["con"] is not None
    return {
        "ok": True,
        "indexed": int(STATE["index"].ntotal) if has_index else 0,
        "has_index": has_index,
        "device": STATE["device"],
        "dim": STATE["dim"]
    }

def _post_filter(items, filters: Optional[SearchFilters]):
    if not filters: return items
    out = []
    for p, score in items:
        w,h,ori,folder = get_meta(p)
        if filters.folder and folder != filters.folder: continue
        if filters.orientation and ori != filters.orientation: continue
        out.append({
            "path": p, "score": score,
            "width": w, "height": h, "orientation": ori, "folder": folder
        })
    return out

# make sure an index actually exists before running
def _require_index():
    if not (STATE["index"] is not None and STATE["ids"] is not None and STATE["con"] is not None):
        raise HTTPException(status_code=409, detail="Index not built yet. Please run /reindex.")

# this is what happens when we give our server some text to run
@app.post("/search_text")
def search_text(body: SearchTextBody):
    _require_index()
    qvec = embed_texts(STATE["model"], STATE["tokenizer"], [body.q], device=STATE["device"]).astype("float32")
    D, I = STATE["index"].search(qvec, body.topk)
    items = [(STATE["ids"][i], float(d)) for i, d in zip(I[0], D[0]) if i != -1]
    return {"items": _post_filter(items, body.filters)}

@app.post("/search_image")
async def search_image(file: UploadFile = File(...), filters: Optional[str] = Form(None), topk: int = Form(50)):
    _require_index()  # protect
    # parse filters json if present
    fobj = None
    if filters:
        try: fobj = SearchFilters(**json.loads(filters))
        except Exception: fobj = None
    raw = await file.read()
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    qvec = embed_images(STATE["model"], [STATE["preprocess"](im)], device=STATE["device"]).astype("float32")
    D, I = STATE["index"].search(qvec, topk)
    items = [(STATE["ids"][i], float(d)) for i, d in zip(I[0], D[0]) if i != -1]
    return {"items": _post_filter(items, fobj)}

def _is_indexed_path(p: str) -> bool:
    if STATE["con"] is None: return False
    cur = STATE["con"].cursor()
    return cur.execute("SELECT 1 FROM images WHERE path=? LIMIT 1", (p,)).fetchone() is not None

@app.get("/thumb")
def thumb(path: str):
    if not _is_indexed_path(path): raise HTTPException(404, "Unknown path")
    
    t = ensure_thumb(path)
    if not t: raise HTTPException(404, "No thumbnail")
    return FileResponse(t, media_type="image/jpeg")

@app.get("/folders")
def folders():
    if STATE["con"] is None:
        return {"total_images": 0, "roots": []}

    cur = STATE["con"].cursor()
    total = cur.execute("SELECT COUNT(*) FROM images").fetchone()[0]
    by_root = cur.execute("""
        SELECT root, COUNT(*) as n
        FROM images GROUP BY root ORDER BY n DESC
    """).fetchall()
    by_root_top = cur.execute("""
        SELECT root, top_folder, COUNT(*) as n
        FROM images GROUP BY root, top_folder
        ORDER BY root ASC, n DESC
    """).fetchall()

    children = {}
    for r, f, n in by_root_top:
        name = (f or "") or "(root)"
        children.setdefault(r or "", []).append({"name": name, "count": n})
 
    roots = [{"root": r or "", "count": n, "folders": children.get(r or "", [])}
             for r, n in by_root]

    return {"total_images": total, "roots": roots}

@app.post("/open_path")
def open_path(body: dict):
    path = body.get("path")
    if not path:
        raise HTTPException(400, "Missing path")

    path = _norm_path(path)
    is_dir = os.path.isdir(path)

    # Allow: any indexed FILE, or any DIRECTORY that is one of (or under) current roots
    if is_dir:
        roots = set(map(_norm_path, _current_roots()))
        under_root = any(path == r or path.startswith(r + os.sep) for r in roots)
        if not under_root:
            raise HTTPException(403, "Folder is not under an indexed root")
    else:
        if not _is_indexed_path(path):
            raise HTTPException(404, "Unknown file")

    try:
        os_name = platform.system()
        if os_name == "Darwin":
            if is_dir:
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["open", "-R", path])  # reveal file
        elif os_name == "Windows":
            if is_dir:
                subprocess.Popen(["explorer", path])
            else:
                subprocess.Popen(["explorer", "/select,", path])
        else:
            # Linux/BSD: open folder, or containing folder for files
            target = path if is_dir else os.path.dirname(path)
            subprocess.Popen(["xdg-open", target])
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"ok": True}

# Stub — wire your existing indexer later as a background task
STATE["reindex"] = {
    "state": "idle",          # idle|running|finalizing|cancelled|error|done
    "phase": "idle",          # scanning|embedding|finalizing (only meaningful when running/finalizing)
    "running": False,
    "processed": 0,
    "total": 0,
    "error": None,
    "cancelled": False,
    "job_id": None,
    "cancellable": False,     # explicit, no guessing in the client
    "started_at": None,       # unix seconds
    "ended_at": None,         # unix seconds (when terminal)
}

def _reindex_worker(roots: list[str]):
    try:
        job_id = uuid.uuid4().hex
        STATE["reindex"].update({
            "state": "running",
            "phase": "scanning",
            "running": True,
            "processed": 0,
            "total": 0,
            "error": None,
            "cancelled": False,
            "job_id": job_id,
            "cancellable": True,          # allow cancel during scanning/embedding
            "started_at": time.time(),
            "ended_at": None,
        })
        STATE["cancel_event"].clear()

        from core.commands.indexer import build_index_with_progress, CancelledError

        def on_progress(done, total):
            # first progress tick -> embedding phase
            if STATE["reindex"].get("phase") == "scanning":
                STATE["reindex"]["phase"] = "embedding"
            STATE["reindex"].update({"processed": done, "total": total})

        build_index_with_progress(
            roots, STORE_DIR, STATE["model"], STATE["preprocess"],
            progress_cb=on_progress,
            device=STATE["device"],
            stop_event=STATE["cancel_event"]
        )

        # finalizing: lock out cancel
        STATE["reindex"].update({"phase": "finalizing", "state": "finalizing", "cancellable": False})

        # hot-swap
        idx_new, ids_new, con_new = load_store()
        with STATE["swap_lock"]:
            idx_old, ids_old, con_old = STATE["index"], STATE["ids"], STATE["con"]
            STATE["index"], STATE["ids"], STATE["con"] = idx_new, ids_new, con_new
            STATE["dim"] = idx_new.d
        try:
            if con_old: con_old.close()
        except Exception:
            pass

        STATE["reindex"].update({
            "phase": "done",
            "state": "done",
            "ended_at": time.time(),
        })

    except CancelledError:
        STATE["reindex"].update({
            "error": None,
            "cancelled": True,
            "phase": "cancelled",
            "state": "cancelled",
            "cancellable": False,
            "ended_at": time.time(),
        })
        _reload_store_from_disk()

    except Exception as e:
        STATE["reindex"].update({
            "error": str(e),
            "phase": "error",
            "state": "error",
            "cancellable": False,
            "ended_at": time.time(),
        })
        _reload_store_from_disk()

    finally:
        STATE["reindex"]["running"] = False

@app.post("/reindex")
def reindex(body: dict):
    roots = body.get("roots") or []
    merge = body.get("merge", True)

    # Normalize now for consistent behavior
    roots = [ _norm_path(r) for r in roots if r ]

    # Merge with previous roots from config.json
    cfg_path = os.path.join(STORE_DIR, "config.json")
    prev_roots = []
    if os.path.exists(cfg_path):
        try:
            prev_roots = [ _norm_path(r) for r in json.load(open(cfg_path)).get("roots", []) ]
        except Exception:
            prev_roots = []

    if merge:
        roots = sorted(set(roots + prev_roots))

    if not roots:
        raise HTTPException(400, "Provide roots: string[]")

    # 🔒 Overlap checks
    inc_in_ex, ex_in_inc, inc_self = _detect_overlaps(prev_roots, roots if not merge else [r for r in roots if r not in prev_roots])

    if inc_self:
        # incoming contains nested duplicates within itself
        details = "; ".join([f"{inner} is inside {outer}" for inner, outer in inc_self])
        raise HTTPException(400, f"Request includes overlapping folders: {details}. Remove the broader or the inner one and try again.")

    if inc_in_ex:
        # trying to add a folder that is already covered by an existing root
        details = "; ".join([f"{inner} is already inside existing {outer}" for inner, outer in inc_in_ex])
        raise HTTPException(400, f"Folder already included by existing root(s): {details}.")

    if ex_in_inc:
        # trying to add a broader root that would swallow existing ones
        details = "; ".join([f"existing {inner} would be swallowed by new {outer}" for inner, outer in ex_in_inc])
        raise HTTPException(400, f"New root overlaps existing roots: {details}. Remove the existing narrower root(s) first, or add only the non-overlapping folder.")

    if STATE["reindex"]["running"]:
        return {"state": "running", **STATE["reindex"]}

    t = threading.Thread(target=_reindex_worker, args=(roots,), daemon=True)
    t.start()
    return {"state": "started", **STATE["reindex"]}

@app.get("/reindex_status")
def reindex_status():
    r = STATE["reindex"]
    total = int(r.get("total") or 0)
    done = int(r.get("processed") or 0)
    progress_pct = int(done * 100 / max(total, 1))
    # thin reflector; don't recompute state here
    return {**r, "progress_pct": progress_pct}

class CancelBody(BaseModel):
    job_id: str

@app.post("/cancel_index")
def cancel_index(body: CancelBody):
    r = STATE["reindex"]
    if not r.get("running"):
        raise HTTPException(409, "No indexing job is running.")
    if not r.get("cancellable"):
        raise HTTPException(409, "This job cannot be cancelled right now.")
    if r.get("job_id") != body.job_id:
        raise HTTPException(409, "Job already changed or completed.")
    STATE["cancel_event"].set()
    return {"status": "cancel requested", "job_id": r.get("job_id")}

# get all the current roots
def _current_roots() -> list[str]:
    cfg_path = os.path.join(STORE_DIR, "config.json")
    if not os.path.exists(cfg_path):
        return []
    try:
        return list(map(str, json.load(open(cfg_path)).get("roots", [])))
    except Exception:
        return []

@app.get("/roots")
def roots():
    return {"roots": _current_roots()}


class RemoveRootsBody(BaseModel):
    roots: list[str]  # wipe_if_empty removed

@app.post("/remove_roots")
def remove_roots(body: RemoveRootsBody):
    # don’t allow two jobs at once
    if STATE["reindex"]["running"]:
        return {"state": "running", **STATE["reindex"]}

    current = set(_current_roots())
    if not current:
        raise HTTPException(409, "No existing roots to remove from.")

    to_remove = set(map(str, body.roots or []))
    if not to_remove:
        raise HTTPException(400, "Provide roots: string[]")

    survivors = sorted(current - to_remove)

    # If nothing left: wipe EVERYTHING and reset in-memory state
    if not survivors:
        # delete index files and config
        for name in ("index.faiss", "vectors.npy", "ids.npy", "config.json"):
            p = os.path.join(STORE_DIR, name)
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

        # clear the DB so /folders is empty immediately
        db_path = os.path.join(STORE_DIR, "meta.sqlite")
        try:
            if os.path.exists(db_path):
                with sqlite3.connect(db_path, check_same_thread=False, timeout=5.0) as con:
                    con.execute("PRAGMA busy_timeout=5000;")
                    con.execute("DELETE FROM images")
                    con.commit()
        except Exception:
            pass

        # reset server state
        try:
            if STATE.get("con"):
                STATE["con"].close()
        except Exception:
            pass
        STATE.update({
            "index": None,
            "ids": None,
            "con": None,
            "dim": 0
        })

        # if you track numpy fallback state elsewhere, reset it too:
        # STATE["mode"] = None
        # STATE["X"] = None

        return {"state": "done", "removed": list(to_remove), "roots": []}

    # Rebuild the index with survivors ONLY (no merge!)
    def worker():
        try:
            job_id = uuid.uuid4().hex
            STATE["reindex"].update({
                "state": "running",
                "phase": "scanning",
                "running": True,
                "processed": 0,
                "total": 0,
                "error": None,
                "cancelled": False,
                "job_id": job_id,
                "cancellable": False,        # ← explicit: FE won’t offer cancel
                "started_at": time.time(),
                "ended_at": None,
            })
            STATE["cancel_event"].clear()

            from core.commands.indexer import build_index_with_progress, CancelledError

            def on_progress(done, total):
                if STATE["reindex"].get("phase") == "scanning":
                    STATE["reindex"]["phase"] = "embedding"
                STATE["reindex"].update({"processed": done, "total": total})

            build_index_with_progress(
                roots=survivors,
                store_dir=STORE_DIR,
                model=STATE["model"],
                preprocess=STATE["preprocess"],
                progress_cb=on_progress,
                device=STATE["device"],
                stop_event=STATE["cancel_event"],
            )

            STATE["reindex"].update({"phase": "finalizing", "state": "finalizing"})

            idx, ids, con = load_store()
            with STATE["swap_lock"]:
                idx_old, ids_old, con_old = STATE["index"], STATE["ids"], STATE["con"]
                STATE["index"], STATE["ids"], STATE["con"] = idx, ids, con
                STATE["dim"] = idx.d
            try:
                if con_old: con_old.close()
            except Exception:
                pass

            STATE["reindex"].update({"phase": "done", "state": "done", "ended_at": time.time()})

        except CancelledError:
            STATE["reindex"].update({
                "error": None, "cancelled": True, "phase": "cancelled",
                "state": "cancelled", "ended_at": time.time()
            })
            _reload_store_from_disk()   # ← ensure STATE mirrors disk after cancel

        except Exception as e:
            STATE["reindex"].update({
                "error": str(e), "phase": "error", "state": "error",
                "ended_at": time.time()
            })
            _reload_store_from_disk()   # ← ensure STATE mirrors disk after error

        finally:
            STATE["reindex"]["running"] = False

    threading.Thread(target=worker, daemon=True).start()
    return {"state": "started", "removed": list(to_remove), "roots": survivors}

class NukeAllBody(BaseModel):
    confirm: Optional[str] = None  # optional extra guard

@app.post("/nuke_all")
def nuke_all(body: NukeAllBody):
    if STATE["reindex"]["running"]:
        raise HTTPException(423, "Indexing in progress. Stop indexing before nuking.")
    # optional guard: require confirm === "NUKE"
    if body.confirm is not None and body.confirm != "NUKE":
        raise HTTPException(400, "Confirmation failed. Send {\"confirm\":\"NUKE\"} to proceed.")
    _wipe_store()

        # reset in-memory state
    try:
        if STATE.get("con"):
            STATE["con"].close()
    except Exception:
        pass
    STATE.update({
        "index": None,
        "ids": None,
        "con": None,
        "dim": 0
    })
    # if you track numpy fallback:
    # STATE["mode"] = None
    # STATE["X"] = None
    return {"ok": True, "message": "All index data wiped.", "roots": [], "indexed": 0}



if __name__ == "__main__":
    host = "127.0.0.1"
    port = PORT  # already from env; keep it
    uvicorn.run("core.server:app", host=host, port=port)  # no reload in prod