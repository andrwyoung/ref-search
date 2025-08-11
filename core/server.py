# server.py
import os, io, json, platform, subprocess
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from PIL import Image
import numpy as np
import sqlite3
import uvicorn
import threading

# ---- CONFIG ----
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_STORE = os.path.join(PROJECT_ROOT, "store")

# Allow override via env var; expand ~ and make absolute
STORE_DIR = os.path.abspath(os.path.expanduser(os.environ.get("REFSEARCH_STORE", DEFAULT_STORE)))
PORT = int(os.environ.get("REFSEARCH_PORT", "5179"))
THUMB_DIR = os.path.join(STORE_DIR, "thumbs")
os.makedirs(THUMB_DIR, exist_ok=True)
os.makedirs(STORE_DIR, exist_ok=True)

# ---- LOAD CORE (your existing code) ----
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost"],
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
    con = sqlite3.connect(db_path, check_same_thread=False)
    return index, ids, con

def get_meta(path):
    cur = STATE["con"].cursor()
    row = cur.execute("SELECT width,height,orientation,folder FROM images WHERE path=?", (path,)).fetchone()
    if not row: return (None, None, None, None)
    return row  # width,height,orientation,folder

def ensure_thumb(path, size=256):
    # cache thumbs by hashing path
    import hashlib
    key = hashlib.md5(path.encode("utf-8")).hexdigest() + ".jpg"
    out = os.path.join(THUMB_DIR, key)
    if not os.path.exists(out):
        try:
            im = Image.open(path).convert("RGB")
            im.thumbnail((size, size))
            im.save(out, "JPEG", quality=85)
        except Exception:
            return None
    return out

@app.on_event("startup")
def startup():
    STATE["device"] = pick_device()
    STATE["model"], STATE["preprocess"], STATE["tokenizer"] = load_model(device=STATE["device"])
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
    if STATE["index"] is None:
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
    # protect
    if STATE["con"] is None:
        return {"total_images": 0, "folders": []}

    cur = STATE["con"].cursor()
    rows = cur.execute("""
        SELECT folder, COUNT(*) as n
        FROM images
        GROUP BY folder
        ORDER BY n DESC
    """).fetchall()
    total = cur.execute("SELECT COUNT(*) FROM images").fetchone()[0]
    return {
        "total_images": total,
        "folders": [{"name": r[0] or "", "count": r[1]} for r in rows]
    }

@app.post("/open_path")
def open_path(body: dict):
    path = body.get("path")
    if not path or not _is_indexed_path(path): raise HTTPException(404, "Unknown path")
    os_name = platform.system()
    try:
        if os_name == "Darwin": subprocess.Popen(["open", "-R", path])
        elif os_name == "Windows": subprocess.Popen(["explorer", "/select,", path])
        else: subprocess.Popen(["xdg-open", os.path.dirname(path)])
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"ok": True}

# Stub — wire your existing indexer later as a background task
STATE["reindex"] = {"running": False, "processed": 0, "total": 0, "error": None}

def _reindex_worker(roots: list[str]):
    try:
        STATE["reindex"].update({"running": True, "processed": 0, "total": 0, "error": None})
        # ---- build index (instrumented) ----
        # reuse your build_index but add a callback
        from core.indexer import build_index_with_progress

        def on_progress(done, total):
            STATE["reindex"].update({"processed": done, "total": total})

        build_index_with_progress(roots, STORE_DIR, STATE["model"], STATE["preprocess"], on_progress, device=STATE["device"])
        # after success, hot-reload store
        idx, ids, con = load_store()
        STATE["index"], STATE["ids"] = idx, ids
        if STATE["con"]: STATE["con"].close()
        STATE["con"] = con
        STATE["dim"] = idx.d
    except Exception as e:
        STATE["reindex"]["error"] = str(e)
    finally:
        STATE["reindex"]["running"] = False

@app.post("/reindex")
def reindex(body: dict):
    roots = body.get("roots") or []
    if not roots: raise HTTPException(400, "Provide roots: string[]")
    if STATE["reindex"]["running"]:
        return {"state": "running", **STATE["reindex"]}
    t = threading.Thread(target=_reindex_worker, args=(roots,), daemon=True)
    t.start()
    return {"state": "started", **STATE["reindex"]}

@app.get("/reindex_status")
def reindex_status():
    state = "running" if STATE["reindex"]["running"] else ("error" if STATE["reindex"]["error"] else "done" if STATE["reindex"]["total"]>0 else "idle")
    return {"state": state, **STATE["reindex"]}

if __name__ == "__main__":
    uvicorn.run("core.server:app", host="127.0.0.1", port=PORT, reload=True)