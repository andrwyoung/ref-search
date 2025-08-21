# Set up dev environment
.venv: requirements.txt requirements-dev.txt
	python3 -m venv .venv
	.venv/bin/pip install -U pip wheel setuptools
	.venv/bin/pip install -r requirements-dev.txt
	cd refsearch-ui && npm install
setup: .venv

# Run backend
backend: setup
	.venv/bin/python -m scripts.backend_entry

# Run frontend
frontend: setup
	cd refsearch-ui && npm run dev

# Build app
# build:
# 	cargo tauri build

# Test full app
dev: setup
	PYTHON=.venv/bin/python cargo tauri dev

# nuke all dependencies
clean:
	rm -rf .venv refsearch-ui/node_modules




# ---------- UNTESTED x86_64 (Rosetta) build pipeline ----------
# Produces an Intel backend sidecar and a Tauri x86_64 app bundle.

# Paths + knobs
VENV_X86 := .venv-x86
X86_PY   := /usr/bin/python3         # system universal python; we force x86 with `arch -x86_64`
BACKEND  := dist/refsearch-backend
SIDE_X86 := src-tauri/resources/backend/refsearch-backend-x86_64

# PyInstaller flags for your project
PYI_FLAGS := --onefile --name refsearch-backend --paths . \
	--collect-data open_clip \
	--collect-submodules numpy \
	--hidden-import numpy \
	--hidden-import numpy.core._multiarray_umath \
	scripts/backend_entry.py

# Create the Rosetta venv only if missing
$(VENV_X86):
	arch -x86_64 $(X86_PY) -m venv $(VENV_X86)

# Install deps into the x86 venv (numpy<2 first to avoid torch/ABI conflicts)
x86-install: $(VENV_X86)
	arch -x86_64 $(VENV_X86)/bin/pip install -U pip wheel setuptools
	arch -x86_64 $(VENV_X86)/bin/pip install "numpy<2"
	# Either install from your files...
	arch -x86_64 $(VENV_X86)/bin/pip install -r requirements.txt
	# ...and dev tools used for packaging:
	arch -x86_64 $(VENV_X86)/bin/pip install pyinstaller pyinstaller-hooks-contrib
	# Explicit extras you mentioned:
	arch -x86_64 $(VENV_X86)/bin/pip install python-multipart

# Build the Intel backend binary with PyInstaller
x86-backend: x86-install
	arch -x86_64 $(VENV_X86)/bin/python -m PyInstaller $(PYI_FLAGS)

# Quick smoke test: start, ping /ready, kill
x86-test: x86-backend
	arch -x86_64 ./$(BACKEND) & \
	sleep 1 && curl -fsS http://127.0.0.1:54999/ready >/dev/null && kill %1

# Copy the sidecar into Tauri resources (Intel filename)
x86-copy: x86-backend
	mkdir -p $(dir $(SIDE_X86))
	cp $(BACKEND) $(SIDE_X86)
	chmod +x $(SIDE_X86)

# Build the Tauri x86_64 app (ensure create-dmg is on PATH if you want a DMG)
x86-app: x86-copy
	PATH="/opt/homebrew/bin:$$PATH" cargo tauri build --target x86_64-apple-darwin

# Clean Intel artifacts
clean-x86:
	rm -rf $(VENV_X86) dist build __pycache__