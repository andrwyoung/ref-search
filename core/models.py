import torch, open_clip

def load_model(device="cpu", name="ViT-B-32", ckpt="laion2b_s34b_b79k"):
    model, _, preprocess = open_clip.create_model_and_transforms(name, pretrained=ckpt, device=device)
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
