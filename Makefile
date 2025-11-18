# E3 - East Execution Engine
# Top-level Makefile for building all components

.PHONY: all build test clean install dev help lint
.PHONY: build-js build-python build-julia
.PHONY: test-js test-python test-julia
.PHONY: install-js install-python install-julia
.PHONY: lint-js

# Default target
all: build

help:
	@echo "E3 - East Execution Engine"
	@echo ""
	@echo "Available targets:"
	@echo "  make build          - Build all components"
	@echo "  make test           - Run all tests"
	@echo "  make lint           - Run linters on all components"
	@echo "  make install        - Install all dependencies"
	@echo "  make clean          - Clean all build artifacts"
	@echo "  make dev            - Install dependencies and build for development"
	@echo ""
	@echo "Language-specific targets:"
	@echo "  make build-js       - Build JavaScript/TypeScript packages"
	@echo "  make build-python   - Build Python packages"
	@echo "  make build-julia    - Build Julia packages"
	@echo "  make test-js        - Test JavaScript packages"
	@echo "  make test-python    - Test Python packages"
	@echo "  make test-julia     - Test Julia packages"
	@echo "  make lint-js        - Lint JavaScript packages"

# Install all dependencies
install: install-js install-python install-julia

install-js:
	@echo "Installing JavaScript dependencies..."
	cd javascript/e3-types && npm install
	cd javascript/e3dk && npm install
	cd javascript/e3cli && npm install
	cd javascript/e3-runner-node && npm install

install-python:
	@echo "Installing Python dependencies..."
	cd python/e3-runner-python && uv sync

install-julia:
	@echo "Installing Julia dependencies..."
	cd julia/E3Runner && julia --project=. -e 'using Pkg; Pkg.instantiate()'

# Build all components
build: build-js build-python build-julia

build-js:
	@echo "Building JavaScript packages..."
	cd javascript/e3-types && npm run build
	cd javascript/e3dk && npm run build
	cd javascript/e3cli && npm run build
	cd javascript/e3-runner-node && npm run build

build-python:
	@echo "Python packages don't require building (interpreted)"

build-julia:
	@echo "Julia packages don't require building (JIT compiled)"

# Run all tests
test: test-js test-python test-julia

test-js:
	@echo "Testing JavaScript packages..."
	cd javascript/e3dk && npm test
	cd javascript/e3cli && npm test
	cd javascript/e3-runner-node && npm test

test-python:
	@echo "Testing Python packages..."
	cd python/e3-runner-python && uv run pytest

test-julia:
	@echo "Testing Julia packages..."
	cd julia/E3Runner && julia --project=. -e 'using Pkg; Pkg.test()'

# Run all linters
lint: lint-js

lint-js:
	@echo "Linting JavaScript packages..."
	cd javascript/e3-types && npm run lint
	cd javascript/e3dk && npm run lint
	cd javascript/e3cli && npm run lint
	cd javascript/e3-runner-node && npm run lint

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf javascript/e3dk/dist javascript/e3dk/node_modules
	rm -rf javascript/e3cli/dist javascript/e3cli/node_modules
	rm -rf javascript/e3-runner-node/dist javascript/e3-runner-node/node_modules
	rm -rf python/e3-runner-python/.venv
	rm -rf python/e3-runner-python/__pycache__
	rm -rf python/e3-runner-python/**/__pycache__
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	@echo "Clean complete"

# Development setup
dev: install build
	@echo ""
	@echo "Development environment ready!"
	@echo ""
	@echo "To run the CLI:"
	@echo "  cd javascript/e3cli && npm run dev"
	@echo ""
	@echo "To run runners:"
	@echo "  cd javascript/e3-runner-node && npm run dev"
	@echo "  cd python/e3-runner-python && uv run e3-runner-python"
	@echo "  cd julia/E3Runner && julia --project=. -e 'using E3Runner; E3Runner.main()'"
