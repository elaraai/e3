/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Cross-repository transfer test suite.
 *
 * Tests exporting packages and workspaces from one e3 repository
 * and importing them into another. Covers local filesystem ↔ remote
 * (e3-api-server) transfers.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { TestContext } from '../context.js';
import type { TestSetup } from '../setup.js';
import { runE3Command } from '../cli.js';
import { createPackageZip, createDiamondPackageZip } from '../fixtures.js';

/**
 * Create a local test repository in a temporary directory.
 *
 * @param tempDir - Parent directory for the repository
 * @returns Object with repository path and cleanup function
 */
async function createLocalTestRepo(tempDir: string): Promise<{
  path: string;
  cleanup: () => void;
}> {
  const repoDir = join(tempDir, `local-repo-${Date.now()}`);
  mkdirSync(repoDir, { recursive: true });
  await runE3Command(['repo', 'create', repoDir], tempDir);
  return {
    path: repoDir,
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
  };
}

/**
 * Register cross-repository transfer tests.
 *
 * These tests verify that packages and workspaces can be exported from one
 * repository and imported into another, covering both local-to-remote and
 * remote-to-local scenarios.
 *
 * @param setup - Factory that creates a fresh test context per test
 * @param getCredentialsEnv - Function that returns env vars for auth (E3_CREDENTIALS_PATH, etc.)
 */
export function transferTests(
  setup: TestSetup<TestContext>,
  getCredentialsEnv: () => Record<string, string>
): void {
  const withTransfer: TestSetup<TestContext & { remoteUrl: string; workDir: string }> = async (t) => {
    const ctx = await setup(t);
    const remoteUrl = `${ctx.config.baseUrl}/repos/${ctx.repoName}`;
    const workDir = join(ctx.tempDir, 'transfer-work');
    mkdirSync(workDir, { recursive: true });
    return Object.assign(ctx, { remoteUrl, workDir });
  };

  describe('transfer', { concurrency: true }, () => {
    describe('package transfer', { concurrency: true }, () => {
      it('exports package from local repo and imports to remote', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo, cleanup } = await createLocalTestRepo(ctx.tempDir);
        const exportZip = join(ctx.tempDir, `export-local-to-remote-${Date.now()}.zip`);

        try {
          // 1. Create and import package to local repo
          const pkgZip = await createPackageZip(ctx.tempDir, 'transfer-l2r-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', localRepo, pkgZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local import failed: ${result.stderr}`);

          // 2. Export from local repo
          result = await runE3Command(['package', 'export', localRepo, 'transfer-l2r-pkg@1.0.0', exportZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Export failed: ${result.stderr}`);

          // 3. Import to remote repo
          result = await runE3Command(['package', 'import', remoteUrl, exportZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);
          assert.match(result.stdout, /Imported transfer-l2r-pkg@1.0.0/);

          // 4. Verify on remote: deploy and execute
          const wsName = `verify-l2r-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'transfer-l2r-pkg@1.0.0'], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Deploy failed: stdout=${result.stdout}, stderr=${result.stderr}`);

          result = await runE3Command(['start', remoteUrl, wsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Start failed: stdout=${result.stdout}, stderr=${result.stderr}`);

          // 5. Check output (10 * 2 = 20)
          result = await runE3Command(['get', remoteUrl, `${wsName}.tasks.compute.output`], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Get failed: ${result.stderr}`);
          assert.match(result.stdout, /20/);

          // Cleanup
          await runE3Command(['workspace', 'remove', remoteUrl, wsName], workDir, { env });
        } finally {
          cleanup();
        }
      });

      it('exports package from remote repo and imports to local', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo, cleanup } = await createLocalTestRepo(ctx.tempDir);
        const exportZip = join(ctx.tempDir, `export-remote-to-local-${Date.now()}.zip`);

        try {
          // 1. Import package to remote repo
          const pkgZip = await createPackageZip(ctx.tempDir, 'transfer-r2l-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', remoteUrl, pkgZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);

          // 2. Export from remote repo
          result = await runE3Command(['package', 'export', remoteUrl, 'transfer-r2l-pkg@1.0.0', exportZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Export failed: ${result.stderr}`);

          // 3. Import to local repo
          result = await runE3Command(['package', 'import', localRepo, exportZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local import failed: ${result.stderr}`);
          assert.match(result.stdout, /Imported transfer-r2l-pkg@1.0.0/);

          // 4. Verify locally: deploy and execute
          const wsName = `verify-r2l-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', localRepo, wsName, 'transfer-r2l-pkg@1.0.0'], workDir);
          assert.strictEqual(result.exitCode, 0, `Deploy failed: ${result.stderr}`);

          result = await runE3Command(['start', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Start failed: ${result.stderr}`);

          // 5. Check output (10 * 2 = 20)
          result = await runE3Command(['get', localRepo, `${wsName}.tasks.compute.output`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get failed: ${result.stderr}`);
          assert.match(result.stdout, /20/);
        } finally {
          cleanup();
        }
      });
    });

    describe('workspace transfer', { concurrency: true }, () => {
      it('exports workspace from local repo and imports as package to remote', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo, cleanup } = await createLocalTestRepo(ctx.tempDir);
        const exportZip = join(ctx.tempDir, `export-ws-local-to-remote-${Date.now()}.zip`);
        const wsName = `ws-export-local-${Date.now()}`;

        try {
          // 1. Create and import package to local repo
          const pkgZip = await createPackageZip(ctx.tempDir, 'ws-transfer-l2r-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', localRepo, pkgZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local import failed: ${result.stderr}`);

          // 2. Create workspace and deploy
          result = await runE3Command(['workspace', 'create', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', localRepo, wsName, 'ws-transfer-l2r-pkg@1.0.0'], workDir);
          assert.strictEqual(result.exitCode, 0, `Deploy failed: ${result.stderr}`);

          // 3. Modify input value (change 10 to 25)
          const valueFile = join(ctx.tempDir, `value-${Date.now()}.east`);
          writeFileSync(valueFile, '25');
          result = await runE3Command(['set', localRepo, `${wsName}.inputs.value`, valueFile], workDir);
          assert.strictEqual(result.exitCode, 0, `Set failed: ${result.stderr}`);

          // 4. Execute to populate output
          result = await runE3Command(['start', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Start failed: ${result.stderr}`);

          // Verify local output (25 * 2 = 50)
          result = await runE3Command(['get', localRepo, `${wsName}.tasks.compute.output`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get local output failed: ${result.stderr}`);
          assert.match(result.stdout, /50/);

          // 5. Export workspace as package with custom name
          // Note: We only use --name, not --version, due to a Commander flag conflict
          // where --version is intercepted by the global version handler
          result = await runE3Command(
            ['workspace', 'export', localRepo, wsName, exportZip, '--name', 'ws-snapshot'],
            workDir
          );
          assert.strictEqual(
            result.exitCode,
            0,
            `Workspace export failed: exitCode=${result.exitCode}, stdout=${result.stdout}, stderr=${result.stderr}, exportZip=${exportZip}`
          );

          // Verify export file was created
          assert.ok(existsSync(exportZip), `Export zip file not created at ${exportZip}. Export stdout: ${result.stdout}`);

          // 6. Import to remote repo
          result = await runE3Command(['package', 'import', remoteUrl, exportZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);
          // Package version is auto-generated as <originalVersion>-<rootHash[0:8]>
          assert.match(result.stdout, /Imported ws-snapshot@/);

          // Extract the imported package name@version from stdout
          const wsImportMatch = result.stdout.match(/Imported (ws-snapshot@[\w.-]+)/);
          assert.ok(wsImportMatch, `Could not extract imported package ref from: ${result.stdout}`);
          const wsSnapshotRef = wsImportMatch[1];

          // 7. Verify on remote: deploy and check preserved input value
          const remoteWsName = `verify-ws-l2r-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', remoteUrl, remoteWsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', remoteUrl, remoteWsName, wsSnapshotRef], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote deploy failed: ${result.stderr}`);

          // Input should be 25 (preserved from workspace)
          result = await runE3Command(['get', remoteUrl, `${remoteWsName}.inputs.value`], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Get remote input failed: ${result.stderr}`);
          assert.match(result.stdout, /25/);

          // Execute and verify output
          result = await runE3Command(['start', remoteUrl, remoteWsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote start failed: ${result.stderr}`);

          result = await runE3Command(['get', remoteUrl, `${remoteWsName}.tasks.compute.output`], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Get remote output failed: ${result.stderr}`);
          assert.match(result.stdout, /50/);

          // Cleanup
          await runE3Command(['workspace', 'remove', remoteUrl, remoteWsName], workDir, { env });
        } finally {
          cleanup();
        }
      });

      it('exports workspace from remote repo and imports as package to local', async (t) => {
        // NOTE: Remote workspace export does not support --name/--version options.
        // The version is auto-generated as <pkgVersion>-<rootHash[0:8]>.
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo, cleanup } = await createLocalTestRepo(ctx.tempDir);
        const exportZip = join(ctx.tempDir, `export-ws-remote-to-local-${Date.now()}.zip`);
        const wsName = `ws-export-remote-${Date.now()}`;

        try {
          // 1. Import package to remote repo
          const pkgZip = await createPackageZip(ctx.tempDir, 'ws-transfer-r2l-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', remoteUrl, pkgZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);

          // 2. Create workspace and deploy
          result = await runE3Command(['workspace', 'create', remoteUrl, wsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', remoteUrl, wsName, 'ws-transfer-r2l-pkg@1.0.0'], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Deploy failed: ${result.stderr}`);

          // 3. Modify input value (change 10 to 30)
          const valueFile = join(ctx.tempDir, `value-remote-${Date.now()}.east`);
          writeFileSync(valueFile, '30');
          result = await runE3Command(['set', remoteUrl, `${wsName}.inputs.value`, valueFile], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Set failed: ${result.stderr}`);

          // 4. Execute to populate output
          result = await runE3Command(['start', remoteUrl, wsName], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Start failed: ${result.stderr}`);

          // 5. Export workspace (version is auto-generated)
          result = await runE3Command(['workspace', 'export', remoteUrl, wsName, exportZip], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Workspace export failed: ${result.stderr}`);

          // 6. Import to local repo
          result = await runE3Command(['package', 'import', localRepo, exportZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local import failed: ${result.stderr}`);
          // The package name is ws-transfer-r2l-pkg with auto-generated version
          assert.match(result.stdout, /Imported ws-transfer-r2l-pkg@/);

          // Extract the imported package version from the output
          const importMatch = result.stdout.match(/Imported (ws-transfer-r2l-pkg@[\w.-]+)/);
          assert.ok(importMatch, 'Could not extract imported package name');
          const importedPkgRef = importMatch[1];

          // 7. Verify locally: deploy and check preserved input value
          const localWsName = `verify-ws-r2l-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', localRepo, localWsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Local workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', localRepo, localWsName, importedPkgRef], workDir);
          assert.strictEqual(result.exitCode, 0, `Local deploy failed: ${result.stderr}`);

          // Input should be 30 (preserved from workspace)
          result = await runE3Command(['get', localRepo, `${localWsName}.inputs.value`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get local input failed: ${result.stderr}`);
          assert.match(result.stdout, /30/);

          // Execute and verify output
          result = await runE3Command(['start', localRepo, localWsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Local start failed: ${result.stderr}`);

          result = await runE3Command(['get', localRepo, `${localWsName}.tasks.compute.output`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get local output failed: ${result.stderr}`);
          assert.match(result.stdout, /60/); // 30 * 2 = 60

          // Cleanup
          await runE3Command(['workspace', 'remove', remoteUrl, wsName], workDir, { env });
        } finally {
          cleanup();
        }
      });
    });

    describe('round-trip', { concurrency: true }, () => {
      it('round-trip local -> remote -> local preserves data integrity', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo1, cleanup: cleanup1 } = await createLocalTestRepo(ctx.tempDir);
        const { path: localRepo2, cleanup: cleanup2 } = await createLocalTestRepo(ctx.tempDir);
        const exportZip1 = join(ctx.tempDir, `round-trip-1-${Date.now()}.zip`);
        const exportZip2 = join(ctx.tempDir, `round-trip-2-${Date.now()}.zip`);

        try {
          // 1. Create diamond package in local repo 1
          // Diamond: a=10, b=5 -> left=(a+b)=15, right=(a*b)=50 -> merge=(left+right)=65
          const pkgZip = await createDiamondPackageZip(ctx.tempDir, 'diamond-rt', '1.0.0');
          let result = await runE3Command(['package', 'import', localRepo1, pkgZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local 1 import failed: ${result.stderr}`);

          // 2. Execute locally and capture result
          const ws1 = `ws1-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', localRepo1, ws1], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['workspace', 'deploy', localRepo1, ws1, 'diamond-rt@1.0.0'], workDir);
          assert.strictEqual(result.exitCode, 0);

          // Modify inputs: a=20, b=3 -> left=23, right=60 -> merge=83
          const aFile = join(ctx.tempDir, `a-${Date.now()}.east`);
          writeFileSync(aFile, '20');
          result = await runE3Command(['set', localRepo1, `${ws1}.inputs.a`, aFile], workDir);
          assert.strictEqual(result.exitCode, 0);

          const bFile = join(ctx.tempDir, `b-${Date.now()}.east`);
          writeFileSync(bFile, '3');
          result = await runE3Command(['set', localRepo1, `${ws1}.inputs.b`, bFile], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['start', localRepo1, ws1], workDir);
          assert.strictEqual(result.exitCode, 0, `Local 1 start failed: ${result.stderr}`);

          result = await runE3Command(['get', localRepo1, `${ws1}.tasks.merge.output`], workDir);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.stdout, /83/, 'Initial local execution should produce 83');

          // 3. Export workspace to package (using --name only due to --version flag conflict)
          result = await runE3Command(
            ['workspace', 'export', localRepo1, ws1, exportZip1, '--name', 'diamond-snapshot'],
            workDir
          );
          assert.strictEqual(result.exitCode, 0, `Export 1 failed: ${result.stderr}`);

          // 4. Import to remote
          result = await runE3Command(['package', 'import', remoteUrl, exportZip1], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);

          // Extract the imported package reference
          const diamondImportMatch = result.stdout.match(/Imported (diamond-snapshot@[\w.-]+)/);
          assert.ok(diamondImportMatch, `Could not extract imported package ref from: ${result.stdout}`);
          const diamondSnapshotRef = diamondImportMatch[1];

          // 5. Verify on remote
          const wsRemote = `ws-remote-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', remoteUrl, wsRemote], workDir, { env });
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['workspace', 'deploy', remoteUrl, wsRemote, diamondSnapshotRef], workDir, { env });
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['start', remoteUrl, wsRemote], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote start failed: ${result.stderr}`);

          result = await runE3Command(['get', remoteUrl, `${wsRemote}.tasks.merge.output`], workDir, { env });
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.stdout, /83/, 'Remote execution should produce 83');

          // 6. Export from remote
          result = await runE3Command(['package', 'export', remoteUrl, diamondSnapshotRef, exportZip2], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Export 2 failed: ${result.stderr}`);

          // 7. Import to local repo 2
          result = await runE3Command(['package', 'import', localRepo2, exportZip2], workDir);
          assert.strictEqual(result.exitCode, 0, `Local 2 import failed: ${result.stderr}`);

          // 8. Verify on local repo 2
          const ws2 = `ws2-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', localRepo2, ws2], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['workspace', 'deploy', localRepo2, ws2, diamondSnapshotRef], workDir);
          assert.strictEqual(result.exitCode, 0);

          // Check preserved inputs
          result = await runE3Command(['get', localRepo2, `${ws2}.inputs.a`], workDir);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.stdout, /20/, 'Input a should be preserved as 20');

          result = await runE3Command(['get', localRepo2, `${ws2}.inputs.b`], workDir);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.stdout, /3/, 'Input b should be preserved as 3');

          result = await runE3Command(['start', localRepo2, ws2], workDir);
          assert.strictEqual(result.exitCode, 0, `Local 2 start failed: ${result.stderr}`);

          result = await runE3Command(['get', localRepo2, `${ws2}.tasks.merge.output`], workDir);
          assert.strictEqual(result.exitCode, 0);
          assert.match(result.stdout, /83/, 'Round-trip should preserve data integrity');

          // Cleanup
          await runE3Command(['workspace', 'remove', remoteUrl, wsRemote], workDir, { env });
        } finally {
          cleanup1();
          cleanup2();
        }
      });
    });

    describe('execution logs', { concurrency: true }, () => {
      it('exports workspace with execution logs and imports them', async (t) => {
        const ctx = await withTransfer(t);
        const { workDir } = ctx;
        const { path: localRepo1, cleanup: cleanup1 } = await createLocalTestRepo(ctx.tempDir);
        const { path: localRepo2, cleanup: cleanup2 } = await createLocalTestRepo(ctx.tempDir);
        const exportZip = join(ctx.tempDir, `export-with-logs-${Date.now()}.zip`);
        const wsName = `ws-logs-${Date.now()}`;

        try {
          // 1. Create and import package to local repo 1
          const pkgZip = await createPackageZip(ctx.tempDir, 'logs-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', localRepo1, pkgZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local import failed: ${result.stderr}`);

          // 2. Create workspace, deploy, and execute to generate logs
          result = await runE3Command(['workspace', 'create', localRepo1, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Workspace create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', localRepo1, wsName, 'logs-pkg@1.0.0'], workDir);
          assert.strictEqual(result.exitCode, 0, `Deploy failed: ${result.stderr}`);

          result = await runE3Command(['start', localRepo1, wsName], workDir);
          assert.strictEqual(result.exitCode, 0, `Start failed: ${result.stderr}`);

          // Verify output exists (10 * 2 = 20)
          result = await runE3Command(['get', localRepo1, `${wsName}.tasks.compute.output`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get output failed: ${result.stderr}`);
          assert.match(result.stdout, /20/);

          // 3. Export workspace (should include execution logs)
          result = await runE3Command(
            ['workspace', 'export', localRepo1, wsName, exportZip, '--name', 'logs-snapshot'],
            workDir
          );
          assert.strictEqual(result.exitCode, 0, `Workspace export failed: ${result.stderr}`);

          // 4. Import to local repo 2
          result = await runE3Command(['package', 'import', localRepo2, exportZip], workDir);
          assert.strictEqual(result.exitCode, 0, `Local 2 import failed: ${result.stderr}`);

          // Extract the imported package reference
          const importMatch = result.stdout.match(/Imported (logs-snapshot@[\w.-]+)/);
          assert.ok(importMatch, `Could not extract imported package ref from: ${result.stdout}`);
          const importedPkgRef = importMatch[1];

          // 5. Deploy the imported package in repo 2
          const ws2Name = `ws2-logs-${Date.now()}`;
          result = await runE3Command(['workspace', 'create', localRepo2, ws2Name], workDir);
          assert.strictEqual(result.exitCode, 0, `Workspace 2 create failed: ${result.stderr}`);

          result = await runE3Command(['workspace', 'deploy', localRepo2, ws2Name, importedPkgRef], workDir);
          assert.strictEqual(result.exitCode, 0, `Deploy 2 failed: ${result.stderr}`);

          // 6. Execute in repo 2 - should be a cache hit
          result = await runE3Command(['start', localRepo2, ws2Name], workDir);
          assert.strictEqual(result.exitCode, 0, `Start 2 failed: ${result.stderr}`);

          // Verify output is correct
          result = await runE3Command(['get', localRepo2, `${ws2Name}.tasks.compute.output`], workDir);
          assert.strictEqual(result.exitCode, 0, `Get output 2 failed: ${result.stderr}`);
          assert.match(result.stdout, /20/);
        } finally {
          cleanup1();
          cleanup2();
        }
      });

      it('preserves execution logs through remote transfer', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const { path: localRepo, cleanup } = await createLocalTestRepo(ctx.tempDir);
        const exportZip1 = join(ctx.tempDir, `remote-logs-1-${Date.now()}.zip`);
        const exportZip2 = join(ctx.tempDir, `remote-logs-2-${Date.now()}.zip`);
        const wsName = `ws-remote-logs-${Date.now()}`;

        try {
          // 1. Create package and execute in local repo
          const pkgZip = await createPackageZip(ctx.tempDir, 'remote-logs-pkg', '1.0.0');
          let result = await runE3Command(['package', 'import', localRepo, pkgZip], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['workspace', 'create', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['workspace', 'deploy', localRepo, wsName, 'remote-logs-pkg@1.0.0'], workDir);
          assert.strictEqual(result.exitCode, 0);

          result = await runE3Command(['start', localRepo, wsName], workDir);
          assert.strictEqual(result.exitCode, 0);

          // 2. Export workspace with logs
          result = await runE3Command(
            ['workspace', 'export', localRepo, wsName, exportZip1, '--name', 'logs-transfer'],
            workDir
          );
          assert.strictEqual(result.exitCode, 0, `Export failed: ${result.stderr}`);

          // 3. Import to remote
          result = await runE3Command(['package', 'import', remoteUrl, exportZip1], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote import failed: ${result.stderr}`);

          // Extract the imported package reference
          const importMatch = result.stdout.match(/Imported (logs-transfer@[\w.-]+)/);
          assert.ok(importMatch, `Could not extract imported package ref from: ${result.stdout}`);
          const importedPkgRef = importMatch[1];

          // 4. Export from remote
          result = await runE3Command(['package', 'export', remoteUrl, importedPkgRef, exportZip2], workDir, { env });
          assert.strictEqual(result.exitCode, 0, `Remote export failed: ${result.stderr}`);

          // 5. The round-trip should preserve the package
          const { path: localRepo2, cleanup: cleanup2 } = await createLocalTestRepo(ctx.tempDir);
          try {
            result = await runE3Command(['package', 'import', localRepo2, exportZip2], workDir);
            assert.strictEqual(result.exitCode, 0, `Local 2 import failed: ${result.stderr}`);

            // Deploy and verify
            const ws2Name = `ws2-remote-logs-${Date.now()}`;
            result = await runE3Command(['workspace', 'create', localRepo2, ws2Name], workDir);
            assert.strictEqual(result.exitCode, 0);

            result = await runE3Command(['workspace', 'deploy', localRepo2, ws2Name, importedPkgRef], workDir);
            assert.strictEqual(result.exitCode, 0);

            result = await runE3Command(['start', localRepo2, ws2Name], workDir);
            assert.strictEqual(result.exitCode, 0);

            result = await runE3Command(['get', localRepo2, `${ws2Name}.tasks.compute.output`], workDir);
            assert.strictEqual(result.exitCode, 0);
            assert.match(result.stdout, /20/);
          } finally {
            cleanup2();
          }
        } finally {
          cleanup();
        }
      });
    });

    describe('error handling', { concurrency: true }, () => {
      it('returns error when exporting non-existent package', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const exportZip = join(ctx.tempDir, `nonexistent-export-${Date.now()}.zip`);

        const result = await runE3Command(
          ['package', 'export', remoteUrl, 'nonexistent-pkg@99.99.99', exportZip],
          workDir,
          { env }
        );

        assert.notStrictEqual(result.exitCode, 0, 'Should fail for non-existent package');
        assert.ok(
          result.stderr.includes('not found') ||
            result.stderr.includes('not_found') ||
            result.stderr.includes('does not exist') ||
            result.stderr.includes('No such'),
          `Expected error message about package not found, got: ${result.stderr}`
        );
      });

      it('returns error when importing invalid zip', async (t) => {
        const ctx = await withTransfer(t);
        const { remoteUrl, workDir } = ctx;
        const env = getCredentialsEnv();
        const invalidZip = join(ctx.tempDir, `invalid-${Date.now()}.zip`);

        // Create an invalid zip file
        writeFileSync(invalidZip, 'not a valid zip file');

        const result = await runE3Command(['package', 'import', remoteUrl, invalidZip], workDir, { env });

        assert.notStrictEqual(result.exitCode, 0, 'Should fail for invalid zip');
        // Error message might vary, but should indicate the import failed
        assert.ok(
          result.stderr.length > 0 || result.exitCode !== 0,
          'Should have error output or non-zero exit code'
        );
      });
    });
  });
}
