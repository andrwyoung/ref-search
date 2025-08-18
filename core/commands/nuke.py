import os
import shutil
import sqlite3
from core.server import  STORE_DIR, THUMB_DIR

def _wipe_store():
    # delete index artifacts + config
    for name in ("index.faiss", "vectors.npy", "ids.npy", "config.json"):
        p = os.path.join(STORE_DIR, name)
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass

    # clear DB rows (keep empty DB file so app doesn’t crash)
    db_path = os.path.join(STORE_DIR, "meta.sqlite")
    try:
        if os.path.exists(db_path):
            with sqlite3.connect(db_path, check_same_thread=False, timeout=5.0) as con:
                con.execute("PRAGMA busy_timeout=5000;")
                con.execute("DELETE FROM images")
                con.commit()
    except Exception:
        pass

    # clear thumbnails directory
    try:
        if os.path.isdir(THUMB_DIR):
            shutil.rmtree(THUMB_DIR, ignore_errors=True)
        os.makedirs(THUMB_DIR, exist_ok=True)
    except Exception:
        pass

