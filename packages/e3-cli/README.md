# @elaraai/e3-cli

Command-line interface for e3 (East Execution Engine).

## Installation

```bash
npm install -g @elaraai/e3-cli
```

## Commands

### Repository

```bash
e3 init <repo>                    # Initialize a new repository
e3 status <repo>                  # Show repository status
e3 gc <repo> [--dry-run]          # Remove unreferenced objects
```

### Packages

```bash
e3 package import <repo> <zip>    # Import package from .zip
e3 package export <repo> <pkg> <zip>  # Export package to .zip
e3 package list <repo>            # List installed packages
e3 package remove <repo> <pkg>    # Remove a package
```

### Workspaces

```bash
e3 workspace create <repo> <name>     # Create empty workspace
e3 workspace deploy <repo> <ws> <pkg> # Deploy package to workspace
e3 workspace export <repo> <ws> <zip> # Export workspace as package
e3 workspace list <repo>              # List workspaces
e3 workspace remove <repo> <ws>       # Remove workspace
```

### Data

```bash
e3 list <repo> [path]             # List workspaces or tree contents
e3 get <repo> <path> [-f format]  # Get dataset value (east/json/beast2)
e3 set <repo> <path> <file>       # Set dataset value from file
```

### Execution

```bash
e3 run <repo> <task> [inputs...]  # Run task ad-hoc
e3 start <repo> <ws>              # Execute tasks in workspace
e3 logs <repo> <path> [--follow]  # View task logs
```

### Utilities

```bash
e3 convert [input] --to <format>  # Convert between .east/.json/.beast2
```

## Example

```bash
# Initialize repository and import a package
e3 init ./my-project
e3 package import ./my-project ./greeting-pkg-1.0.0.zip

# Create workspace and deploy package
e3 workspace create ./my-project dev
e3 workspace deploy ./my-project dev greeting-pkg@1.0.0

# Set input and run
e3 set ./my-project dev.inputs.name ./name.east
e3 start ./my-project dev

# Get results
e3 get ./my-project dev.tasks.shout.output
```

## Related Repos

- **[east](https://github.com/elaraai/east)** - East language core
- **[east-node](https://github.com/elaraai/east-node)** - Node.js runtime and platform functions
- **[east-py](https://github.com/elaraai/east-py)** - Python runtime and data science

## About Elara

e3-cli is developed by [Elara AI](https://elaraai.com/), an AI-powered platform that creates economic digital twins of businesses. e3 powers the execution layer of Elara solutions, enabling durable and efficient execution of East programs across multiple runtimes.

## License

BSL 1.1. See [LICENSE.md](./LICENSE.md).
