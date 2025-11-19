# E3 - East Execution Engine
# Top-level Makefile for building all components

.PHONY: all build test clean install dev help lint

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
	@echo "  cd e3cli && npm run dev"
	@echo ""
	@echo "To run the Node.js runner:"
	@echo "  cd e3-runner-node && npm run dev"
