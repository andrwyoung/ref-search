import os, sqlite3, numpy as np
# import faiss
from PIL import Image

from core.numpy_index import NumpyIndex

# def load_store(store_dir):
#     index = faiss.read_index(os.path.join(store_dir, "index.faiss"))
#     ids = np.load(os.path.join(store_dir, "ids.npy"), allow_pickle=True)
#     con = sqlite3.connect(os.path.join(store_dir, "meta.sqlite"))
#     return index, ids, con

def load_store(store_dir):
    vecs_path = os.path.join(store_dir, "vectors.npy")
    ids_path = os.path.join(store_dir, "ids.npy")
    db_path  = os.path.join(store_dir, "meta.sqlite")

    if not (os.path.exists(vecs_path) and os.path.exists(ids_path) and os.path.exists(db_path)):
        raise RuntimeError("Store files missing. Rebuild index.")

    X = np.load(vecs_path, mmap_mode="r")
    index = NumpyIndex(X)
    ids = np.load(ids_path, allow_pickle=True)
    con = sqlite3.connect(db_path)
    return index, ids, con

def post_filter(rows, con, folder=None, orientation=None):
    if not folder and not orientation:
        return rows
    keep = []
    q = "SELECT folder, orientation FROM images WHERE path=?"
    cur = con.cursor()
    for i, path, score in rows:
        f, o = cur.execute(q, (path,)).fetchone()
        if (folder is None or f==folder) and (orientation is None or o==orientation):
            keep.append((i, path, score))
    return keep

def search_by_vector(index, ids, qvec, topk=20):
    D, I = index.search(qvec.astype("float32"), topk*5)  # over-fetch a bit for later filters
    hits = []
    for score, idx in zip(D[0], I[0]):
        if idx == -1: continue
        hits.append((int(idx), ids[idx], float(score)))
    return hits

def search_text(store_dir, model, tokenizer, text, topk=20, folder=None, orientation=None, device="cpu"):
    from models import embed_texts
    qvec = embed_texts(model, tokenizer, [text], device=device)
    index, ids, con = load_store(store_dir)
    hits = search_by_vector(index, ids, qvec, topk=topk)
    hits = post_filter(hits, con, folder, orientation)
    con.close()
    return hits[:topk]

def search_image(store_dir, model, preprocess, image_path, topk=20, folder=None, orientation=None, device="cpu"):
    from models import embed_images
    from PIL import Image
    im = Image.open(image_path).convert("RGB")
    qvec = embed_images(model, [preprocess(im)], device=device)
    index, ids, con = load_store(store_dir)
    hits = search_by_vector(index, ids, qvec, topk=topk)
    hits = post_filter(hits, con, folder, orientation)
    con.close()
    return hits[:topk]
