/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import type { TestContext as NodeTestContext } from 'node:test';

/**
 * Factory that creates a fresh test context and registers cleanup via t.after().
 * Each test calls `const ctx = await setup(t)` — fully self-contained, no shared state.
 */
export type TestSetup<T> = (t: NodeTestContext) => Promise<T>;
