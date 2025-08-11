import typer, os, platform, subprocess
from models import load_model
from core.commands.indexer import build_index
from core.commands.searcher import search_text, search_image
import time

app = typer.Typer(add_completion=False)

def open_paths(paths):
    if not paths: return
    sys = platform.system()
    for p in paths:
        try:
            if sys == "Darwin": subprocess.run(["open", "-R", p])
            elif sys == "Windows": subprocess.run(["explorer", "/select,", p])
            else: subprocess.run(["xdg-open", os.path.dirname(p)])
        except Exception:
            pass

@app.command()
def index(
    folder: list[str] = typer.Argument(..., help="One or more folders to index"),
    store: str = typer.Option("store", help="Where to store the index"),
    device: str = typer.Option("cpu", help="cpu or cuda")
):
    model, preprocess, _ = load_model(device=device)
    build_index(folder, store, model, preprocess, device=device)
    typer.echo(f"Indexed into {store}/")

@app.command()
def search(
    text: str = typer.Option(None, help="Text query"),
    image: str = typer.Option(None, help="Image path query"),
    topk: int = typer.Option(20, help="Number of results"),
    folder: str = typer.Option(None, help="Filter: folder equals"),
    orientation: str = typer.Option(None, help="Filter: landscape|portrait|square"),
    store: str = typer.Option("store", help="Index store dir"),
    open_: int = typer.Option(0, "--open", help="Open top N results in OS")
):
    device = "cpu"
    model, preprocess, tokenizer = load_model(device=device)
    start_time = time.time()
    if text:
        hits = search_text(store, model, tokenizer, text, topk, folder, orientation, device)
    elif image:
        hits = search_image(store, model, preprocess, image, topk, folder, orientation, device)
    else:
        raise typer.BadParameter("Provide --text or --image")
    
    elapsed = time.time() - start_time
    typer.echo(f"Search took {elapsed:.3f} seconds")

    for _, path, score in hits:
        typer.echo(f"{score:.3f}\t{path}")
    if open_ > 0:
        open_paths([p for _, p, _ in hits[:open_]])

if __name__ == "__main__":
    app()
