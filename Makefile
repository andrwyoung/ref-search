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
