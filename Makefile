# E3 - East Execution Engine
# Top-level Makefile for building all components

.PHONY: all build test clean install dev help lint link unlink

# Default target
all: build

help:
	@echo "E3 - East Execution Engine"
	@echo ""
	@echo "Available targets:"
	@echo "  make build          - Build all packages"
	@echo "  make test           - Run all tests"
	@echo "  make lint           - Run linters"
	@echo "  make install        - Install all dependencies"
	@echo "  make clean          - Clean all build artifacts"
	@echo "  make dev            - Install dependencies and build for development"
	@echo "  make link           - Link e3 CLI to PATH (makes 'e3' command available)"
	@echo "  make unlink         - Unlink e3 CLI from PATH"

# Install all dependencies (using npm workspaces)
install:
	@echo "Installing dependencies via npm workspaces..."
	npm install

# Build all packages
build:
	@echo "Building all packages..."
	npm run build

# Run all tests
test:
	@echo "Running tests..."
	npm run test

# Run all linters
lint:
	@echo "Linting all packages..."
	npm run lint

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	npm run clean
	@echo "Clean complete"

# Development setup
dev: install build
	@echo ""
	@echo "Development environment ready!"
	@echo ""
	@echo "To run the CLI:"
	@echo "  cd e3-cli && npm run dev"
	@echo ""
	@echo "To run the Node.js runner:"
	@echo "  cd e3-runner-node && npm run dev"
	@echo ""
	@echo "To make 'e3' available globally:"
	@echo "  make link"

# Link CLI to PATH
link: build
	@echo "Linking e3 CLI to PATH..."
	cd e3-cli && npm link --force
	@echo ""
	@echo "✓ e3 CLI is now available globally"
	@echo "  Run 'e3 --help' to verify"

# Unlink CLI from PATH
unlink:
	@echo "Unlinking e3 CLI from PATH..."
	cd e3-cli && npm unlink -g @elaraai/e3-cli || true
	@echo "✓ e3 CLI has been unlinked"
