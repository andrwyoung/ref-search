## RefSearch

Search images on your computer by describing what they look like.

**Quickstart:**

```
make dev
```

Supporting Document: [RefSearch Notes on Notion](https://jondrew.notion.site/Refsearch-2562e809fa4e8053a598f13d51dbbef8?source=copy_link)

⸻

## Things to Know

We use a Tauri-based frontend (Rust + React) that runs a Python backend (FastAPI + Pytorch). All image data is stored at STORE_DIR

Ports are currently hard coded:

- Frontend: 54998
- Backend: 54999

### Requirements

- **Python 3.10+** (recommended to use a virtualenv)
- **Node.js 18+** and `npm`
- **Rust & Cargo** (installed via [rustup](https://rustup.rs))
- macOS or Linux (Windows builds possible but not covered here)

### Folder Overview

- **core/** → Processes images and searches them (Python Backend)
- **refsearch-ui/** → What the app looks like (React Frontend)
- **src-tauri/** → Puts everything together (Tauri Rust Layer: runs frontend in browser window. Spins up backend as a sidecar)
- **scripts/** → Helper script to start up the backend
