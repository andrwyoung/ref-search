import numpy as np

class NumpyIndex:
    """FAISS-like wrapper over a normalized (N, D) float32 matrix."""
    def __init__(self, X: np.ndarray):
        assert X.dtype == np.float32
        self._X = X
        self.d = int(X.shape[1])

    @property
    def ntotal(self) -> int:
        return int(self._X.shape[0])

    def search(self, qvec: np.ndarray, k: int):
        if self.ntotal == 0 or k <= 0:
            return (np.empty((1, 0), dtype=np.float32),
                    np.empty((1, 0), dtype=np.int64))
        q = qvec.astype(np.float32, copy=False)
        sims = (q @ self._X.T)[0]
        k = min(int(k), sims.shape[0])
        part_idx = np.argpartition(-sims, k - 1)[:k]
        part_scores = sims[part_idx]
        order = np.argsort(-part_scores)
        I = part_idx[order].astype(np.int64, copy=False).reshape(1, -1)
        D = part_scores[order].astype(np.float32, copy=False).reshape(1, -1)
        return D, I