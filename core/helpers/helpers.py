import os


def _norm_path(p: str) -> str:
    # normalize for comparisons: expand ~, resolve symlinks, absolutize, collapse separators
    p = os.path.expanduser(p)
    p = os.path.abspath(os.path.realpath(p))
    # on Windows, make case-insensitive comparisons stable
    return os.path.normcase(p).rstrip(os.sep)

def _is_subpath(child: str, parent: str) -> bool:
    child = _norm_path(child); parent = _norm_path(parent)
    try:
        return os.path.commonpath([child, parent]) == parent
    except Exception:
        return False

def _minimal_roots(roots: list[str]) -> list[str]:
    """Return a deduped list where no root is a subpath of another."""
    normed = sorted({_norm_path(r) for r in roots if r}, key=lambda p: (p.count(os.sep), p))
    kept: list[str] = []
    for r in normed:
        if not any(_is_subpath(r, k) for k in kept):
            kept.append(r)
    return kept

def _detect_overlaps(existing: list[str], incoming: list[str]):
    """Return (incoming_within_existing, existing_within_incoming) as lists of tuples (inner, outer)."""
    ex = [_norm_path(r) for r in existing]
    inc = [_norm_path(r) for r in incoming]

    inc_in_ex = []
    ex_in_inc = []

    for i in inc:
        for e in ex:
            if _is_subpath(i, e):
                inc_in_ex.append((i, e))     # i is redundant (inside existing e)

    for e in ex:
        for i in inc:
            if _is_subpath(e, i):
                ex_in_inc.append((e, i))     # e would be swallowed by new i

    # also block duplicates within incoming itself (e.g., /A and /A/B in one request)
    inc_self = []
    for i in inc:
        for j in inc:
            if i == j:
                continue
            if _is_subpath(j, i):
                inc_self.append((j, i))      # j redundant because i included

    return inc_in_ex, ex_in_inc, inc_self