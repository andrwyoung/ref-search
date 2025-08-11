refsearch/
  refsearch.py            # CLI entry
  indexer.py              # walks folders, embeds, builds FAISS
  searcher.py             # loads index, runs text/image queries
  models.py               # model/transform loaders
  store/
    index.faiss           # FAISS index
    ids.npy               # FAISS id -> row mapping
    meta.sqlite           # paths, sizes, mtime, folder, orientation, optional color
    config.json           # model name, transform params, index type
