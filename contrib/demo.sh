#!/usr/bin/env bash
#
# demo.sh - Comprehensive e3 smoke test / demo
#
# Demonstrates the full e3 execution engine including:
#   - Package creation with diamond dependencies and mixed task types
#   - Multi-workspace deployment
#   - Dataflow execution with partial failures
#   - Input mutation and re-execution
#   - Package version upgrades
#   - Garbage collection
#
# Usage: ./contrib/demo.sh
#
# Run from the e3 monorepo root directory.
# Requires: npm run build && npm link -w @elaraai/e3-cli -w @elaraai/e3-api-server
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Script directory and e3 root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E3_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# CLI tools (assumes npm link has been run)
E3_CLI="e3"
E3_SERVER="e3-api-server"

# Temp directory for test data
TEMP_DIR=""
SERVER_PID=""
CREDENTIALS_PATH=""

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"

    # Stop server if running
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Stopping server (PID: $SERVER_PID)"
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi

    # Remove temp directory
    if [[ -n "$TEMP_DIR" ]] && [[ -d "$TEMP_DIR" ]]; then
        echo "Removing temp directory: $TEMP_DIR"
        rm -rf "$TEMP_DIR"
    fi

    echo -e "${GREEN}Cleanup complete${NC}"
}

trap cleanup EXIT

header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

step() {
    echo -e "\n${GREEN}▶ $1${NC}"
}

info() {
    echo -e "${DIM}  $1${NC}"
}

run_cmd() {
    echo -e "${YELLOW}\$ $*${NC}"
    E3_CREDENTIALS_PATH="$CREDENTIALS_PATH" "$@"
}

# Like run_cmd, but tolerates non-zero exit (for expected failures)
run_cmd_allow_fail() {
    echo -e "${YELLOW}\$ $*${NC}"
    E3_CREDENTIALS_PATH="$CREDENTIALS_PATH" "$@" || true
}

# Check we're in the right directory
if [[ ! -f "$E3_ROOT/package.json" ]]; then
    echo -e "${RED}Error: Must run from e3 monorepo root${NC}"
    exit 1
fi

# Check CLI tools are available
if ! command -v e3 &> /dev/null || ! command -v e3-api-server &> /dev/null; then
    echo -e "${RED}Error: e3 and e3-api-server must be in PATH${NC}"
    echo -e "Run: ${YELLOW}npm run build && npm link -w @elaraai/e3-cli -w @elaraai/e3-api-server${NC}"
    exit 1
fi

# =============================================================================
# Phase 1: Setup
# =============================================================================

header "Phase 1: Setup"

step "Creating test environment..."
TEMP_DIR=$(mktemp -d)
REPOS_DIR="$TEMP_DIR/repos"
REPO_NAME="demo-repo"
CREDENTIALS_PATH="$TEMP_DIR/credentials.json"

mkdir -p "$REPOS_DIR"
echo "Temp directory: $TEMP_DIR"
echo "Repos directory: $REPOS_DIR"

step "Starting e3-api-server with OIDC (auto-approve)..."
PORT=9876
SERVER_LOG="$TEMP_DIR/server.log"
E3_AUTH_AUTO_APPROVE=1 $E3_SERVER --repos "$REPOS_DIR" --port $PORT --oidc > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

echo "Waiting for server to start..."
for i in {1..30}; do
    if curl -s "http://localhost:$PORT/api/repos" > /dev/null 2>&1; then
        echo -e "${GREEN}Server ready!${NC}"
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "${RED}Server failed to start. Log:${NC}"
        cat "$SERVER_LOG"
        exit 1
    fi
    sleep 0.1
done

SERVER_URL="http://localhost:$PORT"
REMOTE_URL="$SERVER_URL/repos/$REPO_NAME"

step "Authenticating..."
E3_CREDENTIALS_PATH="$CREDENTIALS_PATH" $E3_CLI login --no-browser "$SERVER_URL"

step "Creating repository..."
run_cmd $E3_CLI repo create "$REMOTE_URL"

# =============================================================================
# Phase 2: Build & Import Packages
# =============================================================================

header "Phase 2: Build & Import Packages"

# Package DAG (5 tasks, diamond dependency):
#
#   input_a (Integer=10)   input_b (Integer=5)
#        \         \         /        /
#         \      task_add  task_mul  /
#          \        \      /       /
#           \     task_merge      /
#            \     /       \    /
#         task_format    task_scale
#         (customTask:   (customTask:
#          always ok)     BROKEN in v1.0.0, FIXED in v1.0.1)
#
# v1.0.0: merge = add + mul, scale = exit 1 (broken)
# v1.0.1: merge = add + mul, scale = cp (fixed)
# v2.0.0: merge = add * mul, scale = cp (new formula)

PACKAGE_V1="$TEMP_DIR/demo-1.0.0.zip"
PACKAGE_V1_FIX="$TEMP_DIR/demo-1.0.1.zip"
PACKAGE_V2="$TEMP_DIR/demo-2.0.0.zip"

step "Building demo@1.0.0 (merge = add + mul, scale BROKEN)..."
(cd "$E3_ROOT" && node --input-type=module -e "
import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';

const input_a = e3.input('a', IntegerType, 10n);
const input_b = e3.input('b', IntegerType, 5n);

// task_add: a + b = 15
const task_add = e3.task(
  'add',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.add(b))
);

// task_mul: a * b = 50
const task_mul = e3.task(
  'mul',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.multiply(b))
);

// task_merge: add + mul = 65 (diamond merge point)
const task_merge = e3.task(
  'merge',
  [task_add.output, task_mul.output],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.add(b))
);

// task_format: customTask that copies merge output (always succeeds)
const task_format = e3.customTask(
  'format',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`cp \${inputs.get(0n)} \${output}\`
);

// task_scale: BROKEN - simulates a bug (always fails)
const task_scale = e3.customTask(
  'scale',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`echo 'scale: division by zero' >&2 && exit 1\`
);

const pkg = e3.package('demo', '1.0.0', task_format, task_scale);
await e3.export(pkg, '$PACKAGE_V1');
console.log('Created: $PACKAGE_V1');
")

step "Building demo@1.0.1 (merge = add + mul, scale FIXED)..."
(cd "$E3_ROOT" && node --input-type=module -e "
import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';

const input_a = e3.input('a', IntegerType, 10n);
const input_b = e3.input('b', IntegerType, 5n);

// Same add, mul, merge as v1.0.0
const task_add = e3.task(
  'add',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.add(b))
);
const task_mul = e3.task(
  'mul',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.multiply(b))
);
const task_merge = e3.task(
  'merge',
  [task_add.output, task_mul.output],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.add(b))
);

// Same format
const task_format = e3.customTask(
  'format',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`cp \${inputs.get(0n)} \${output}\`
);

// task_scale: FIXED - now properly copies merge output
const task_scale = e3.customTask(
  'scale',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`cp \${inputs.get(0n)} \${output}\`
);

const pkg = e3.package('demo', '1.0.1', task_format, task_scale);
await e3.export(pkg, '$PACKAGE_V1_FIX');
console.log('Created: $PACKAGE_V1_FIX');
")

step "Building demo@2.0.0 (merge = add * mul, scale ok)..."
(cd "$E3_ROOT" && node --input-type=module -e "
import e3 from '@elaraai/e3';
import { IntegerType, East } from '@elaraai/east';

const input_a = e3.input('a', IntegerType, 10n);
const input_b = e3.input('b', IntegerType, 5n);

const task_add = e3.task(
  'add',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.add(b))
);
const task_mul = e3.task(
  'mul',
  [input_a, input_b],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.multiply(b))
);

// CHANGED: merge = add * mul = 750 (was add + mul = 65)
const task_merge = e3.task(
  'merge',
  [task_add.output, task_mul.output],
  East.function([IntegerType, IntegerType], IntegerType, (\$, a, b) => a.multiply(b))
);

const task_format = e3.customTask(
  'format',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`cp \${inputs.get(0n)} \${output}\`
);
const task_scale = e3.customTask(
  'scale',
  [task_merge.output],
  IntegerType,
  (\$, inputs, output) => East.str\`cp \${inputs.get(0n)} \${output}\`
);

const pkg = e3.package('demo', '2.0.0', task_format, task_scale);
await e3.export(pkg, '$PACKAGE_V2');
console.log('Created: $PACKAGE_V2');
")

step "Importing all package versions..."
run_cmd $E3_CLI package import "$REMOTE_URL" "$PACKAGE_V1"
run_cmd $E3_CLI package import "$REMOTE_URL" "$PACKAGE_V1_FIX"
run_cmd $E3_CLI package import "$REMOTE_URL" "$PACKAGE_V2"

step "Listing packages..."
run_cmd $E3_CLI package list "$REMOTE_URL"

# =============================================================================
# Phase 3: Deploy & Run (Expect Failure)
# =============================================================================

header "Phase 3: Deploy & Run (Partial Failure Expected)"

step "Creating workspaces: dev, staging, prod..."
run_cmd $E3_CLI workspace create "$REMOTE_URL" dev
run_cmd $E3_CLI workspace create "$REMOTE_URL" staging
run_cmd $E3_CLI workspace create "$REMOTE_URL" prod

step "Deploying demo@1.0.0 (buggy) to all workspaces..."
run_cmd $E3_CLI workspace deploy "$REMOTE_URL" dev demo@1.0.0
run_cmd $E3_CLI workspace deploy "$REMOTE_URL" staging demo@1.0.0
run_cmd $E3_CLI workspace deploy "$REMOTE_URL" prod demo@1.0.0

step "Listing workspaces..."
run_cmd $E3_CLI workspace list "$REMOTE_URL"

step "Running dataflow on dev (task_scale will fail)..."
info "Expected: add, mul, merge, format succeed; scale fails with exit 1"
run_cmd_allow_fail $E3_CLI start "$REMOTE_URL" dev

step "Checking workspace status after partial failure..."
run_cmd $E3_CLI workspace status "$REMOTE_URL" dev

# =============================================================================
# Phase 4: Fix & Re-run
# =============================================================================

header "Phase 4: Fix & Re-run (deploy patched v1.0.1)"

step "Deploying demo@1.0.1 (fixed scale task) to dev..."
info "v1.0.1 fixes task_scale; add/mul/merge/format IR unchanged (should cache)"
run_cmd $E3_CLI workspace deploy "$REMOTE_URL" dev demo@1.0.1

step "Running dataflow on dev (all tasks should succeed)..."
info "Expected: add, mul, merge, format cached; scale re-executes and succeeds"
run_cmd $E3_CLI start "$REMOTE_URL" dev

step "Checking workspace status (all up-to-date)..."
run_cmd $E3_CLI workspace status "$REMOTE_URL" dev

step "Verifying outputs..."
info "task_add: a + b = 10 + 5 = 15"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.add.output
info "task_mul: a * b = 10 * 5 = 50"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.mul.output
info "task_merge: add + mul = 15 + 50 = 65"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.merge.output
info "task_format: copy of merge = 65"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.format.output
info "task_scale: copy of merge = 65"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.scale.output

# =============================================================================
# Phase 5: Input Mutation & Re-execution
# =============================================================================

header "Phase 5: Input Mutation & Re-execution"

step "Setting input_a=20 on dev..."
A_FILE="$TEMP_DIR/a_twenty.east"
echo "20" > "$A_FILE"
run_cmd $E3_CLI set "$REMOTE_URL" dev.inputs.a "$A_FILE"

step "Verifying input was changed..."
run_cmd $E3_CLI get "$REMOTE_URL" dev.inputs.a

step "Running dataflow (all tasks re-execute with new inputs)..."
info "Expected: add=25, mul=100, merge=125, format=125, scale=125"
run_cmd $E3_CLI start "$REMOTE_URL" dev

step "Verifying new outputs..."
info "task_add: 20 + 5 = 25"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.add.output
info "task_mul: 20 * 5 = 100"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.mul.output
info "task_merge: 25 + 100 = 125"
run_cmd $E3_CLI get "$REMOTE_URL" dev.tasks.merge.output

# =============================================================================
# Phase 6: Version Upgrade
# =============================================================================

header "Phase 6: Version Upgrade (demo@2.0.0)"

step "Deploying demo@2.0.0 to staging..."
info "v2 changes merge from (add + mul) to (add * mul)"
run_cmd $E3_CLI workspace deploy "$REMOTE_URL" staging demo@2.0.0

step "Running dataflow on staging..."
info "Default inputs: a=10, b=5"
info "Expected: add=15, mul=50, merge=15*50=750, format=750, scale=750"
run_cmd $E3_CLI start "$REMOTE_URL" staging

step "Checking staging status..."
run_cmd $E3_CLI workspace status "$REMOTE_URL" staging

step "Verifying v2 merge output (add * mul = 15 * 50 = 750)..."
run_cmd $E3_CLI get "$REMOTE_URL" staging.tasks.merge.output

step "Changing input_a=20 on staging and re-running..."
run_cmd $E3_CLI set "$REMOTE_URL" staging.inputs.a "$A_FILE"
run_cmd $E3_CLI start "$REMOTE_URL" staging

step "Verifying staging outputs with new inputs..."
info "task_add: 20 + 5 = 25"
run_cmd $E3_CLI get "$REMOTE_URL" staging.tasks.add.output
info "task_merge: 25 * 100 = 2500"
run_cmd $E3_CLI get "$REMOTE_URL" staging.tasks.merge.output

# =============================================================================
# Phase 7: Cleanup & GC
# =============================================================================

header "Phase 7: Cleanup & Garbage Collection"

step "Checking repo status before cleanup..."
run_cmd $E3_CLI repo status "$REMOTE_URL"

step "Removing workspace prod (still on buggy v1.0.0)..."
run_cmd $E3_CLI workspace remove "$REMOTE_URL" prod

step "Removing package demo@1.0.0 (no longer deployed anywhere)..."
info "dev uses v1.0.1, staging uses v2.0.0, prod was removed"
run_cmd $E3_CLI package remove "$REMOTE_URL" demo@1.0.0

step "GC dry-run (show what would be collected)..."
# Note: --min-age 1 (not 0) because the CLI treats 0 as falsy and falls back to default
run_cmd $E3_CLI repo gc "$REMOTE_URL" --dry-run --min-age 1

step "GC for real..."
run_cmd $E3_CLI repo gc "$REMOTE_URL" --min-age 1

step "Verifying dev workspace still works after GC..."
run_cmd $E3_CLI workspace status "$REMOTE_URL" dev

step "Verifying staging workspace still works after GC..."
run_cmd $E3_CLI workspace status "$REMOTE_URL" staging

# =============================================================================
# Phase 8: Summary
# =============================================================================

header "Demo Complete"

echo -e "
${GREEN}Success!${NC} This demo exercised:

  ${CYAN}Package Management${NC}
    - Built 3 package versions with the e3 SDK (inline node)
    - Diamond DAG: add/mul -> merge -> format/scale
    - Mixed task types: East functions + customTask (bash)
    - Imported v1.0.0 (buggy), v1.0.1 (fixed), v2.0.0 (new formula)

  ${CYAN}Workspace Lifecycle${NC}
    - Created 3 workspaces: dev, staging, prod
    - Deployed packages, removed workspace prod

  ${CYAN}Dataflow Execution${NC}
    - Partial failure: scale failed in v1.0.0, other tasks succeeded
    - Hotfix: deployed v1.0.1, only scale re-executed (others cached)
    - Input mutation: changed input_a=20, all dependent tasks re-executed
    - Version upgrade: deployed v2.0.0 to staging (merge: add*mul vs add+mul)

  ${CYAN}Garbage Collection${NC}
    - Removed workspace prod + package v1.0.0 to create unreferenced objects
    - GC dry-run showed what would be collected
    - GC reclaimed orphaned objects
    - Verified remaining workspaces still work

  ${CYAN}Server URL: ${YELLOW}$SERVER_URL${NC}
  ${CYAN}Repository: ${YELLOW}$REMOTE_URL${NC}
"

echo -e "${BLUE}Press Enter to cleanup and exit...${NC}"
read -r || true
