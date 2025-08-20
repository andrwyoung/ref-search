import os, torch, open_clip

def load_model(device="cpu", name="ViT-B-32", ckpt="laion2b_s34b_b79k"):
    """
    If REFSEARCH_MODEL_DIR is set, load weights from that directory only.
    Otherwise, use open_clip's normal cache (still offline if already cached).
    """
    model_dir = os.environ.get("REFSEARCH_MODEL_DIR")  # e.g. resources/models/ViT-B-32
    cache_dir = os.environ.get("REFSEARCH_CACHE_DIR")  # optional: force a cache location

    if model_dir:
        # allow pretrained as a local file path
        pretrained = os.path.join(model_dir, "open_clip_pytorch_model.bin")
        if not os.path.exists(pretrained):
            # some builds ship as .pt
            pretrained = os.path.join(model_dir, "model.pt")
        if not os.path.exists(pretrained):
            raise RuntimeError(f"Local model weights not found in {model_dir}")
        model, _, preprocess = open_clip.create_model_and_transforms(
            name=name, pretrained=pretrained, device=device
        )
    else:
        # use local cache only; optionally pin cache_dir so it’s inside your app data
        kwargs = {"device": device}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        model, _, preprocess = open_clip.create_model_and_transforms(
            name=name, pretrained=ckpt, **kwargs
        )

    tokenizer = open_clip.get_tokenizer(name)
    model.eval()
    return model, preprocess, tokenizer

@torch.no_grad()
def embed_images(model, images, device="cpu"):
    # images: list of preprocessed tensors [3,H,W]
    import torch.nn.functional as F
    batch = torch.stack(images).to(device)
    feats = model.encode_image(batch)
    feats = F.normalize(feats, dim=-1)
    return feats.cpu().numpy()

@torch.no_grad()
def embed_texts(model, tokenizer, texts, device="cpu"):
    import torch.nn.functional as F
    toks = tokenizer(texts)
    if hasattr(toks, "to"):
        toks = toks.to(device)
    feats = model.encode_text(toks)
    feats = F.normalize(feats, dim=-1)
    return feats.cpu().numpy()
