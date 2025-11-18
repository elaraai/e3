# E3 Python Runner

East Execution Engine Python Runner - Execute East tasks in the Python runtime.

## Installation

```bash
uv sync
```

**Note**: Dependencies are fetched from GitHub using HTTPS. Ensure you have GitHub authentication configured (e.g., via `gh auth login`).

## Usage

```bash
# Run the Python runner
uv run e3-runner-python

# Or with environment variable for custom repo location
E3_REPO=/path/to/repo uv run e3-runner-python
```

## Development

```bash
# Run tests
uv run pytest

# Run linter
uv run ruff check .

# Type checking
uv run mypy e3_runner
```
