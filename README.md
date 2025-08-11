refsearch/
├── refsearch.py # CLI entry
├── indexer.py # walks folders, embeds, builds FAISS
├── searcher.py # loads index, runs text/image queries
├── models.py # model/transform loaders
└── store/
──├── index.faiss # FAISS index
── ├── ids.npy # FAISS id -> row mapping
── ├── meta.sqlite # paths, sizes, mtime, folder, orientation, optional color
── └── config.json # model name, transform params, index type

```
# running python server on one terminal
conda activate refsearch311
python -m uvicorn core.server:app --port 54999 --reload


# in refsearch-ui/ on another terminal
npm run dev
```
