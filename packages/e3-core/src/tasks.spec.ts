/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Tests for tasks.ts - task listing and details operations
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { join } from 'node:path';
import { StringType } from '@elaraai/east';
import e3 from '@elaraai/e3';
import { packageListTasks, packageGetTask, workspaceListTasks, workspaceGetTask } from './tasks.js';
import { packageImport } from './packages.js';
import { workspaceCreate, workspaceDeploy } from './workspaces.js';
import { TaskNotFoundError, WorkspaceNotFoundError, WorkspaceNotDeployedError } from './errors.js';
import { createTestRepo, removeTestRepo, createTempDir, removeTempDir } from './test-helpers.js';

describe('tasks', () => {
  let testRepo: string;
  let tempDir: string;

  beforeEach(() => {
    testRepo = createTestRepo();
    tempDir = createTempDir();
  });

  afterEach(() => {
    removeTestRepo(testRepo);
    removeTempDir(tempDir);
  });

  describe('packageListTasks', () => {
    it('returns empty array for package with no tasks', async () => {
      const myInput = e3.input('value', StringType, 'hello');
      const pkg = e3.package('no-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'no-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(testRepo, zipPath);

      const tasks = await packageListTasks(testRepo, 'no-tasks', '1.0.0');

      assert.deepStrictEqual(tasks, []);
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageListTasks(testRepo, 'nonexistent', '1.0.0'),
        /not found|ENOENT/
      );
    });
  });

  describe('packageGetTask', () => {
    it('throws for non-existent task', async () => {
      const myInput = e3.input('value', StringType, 'test');
      const pkg = e3.package('no-task', '1.0.0', myInput);
      const zipPath = join(tempDir, 'no-task.zip');
      await e3.export(pkg, zipPath);
      await packageImport(testRepo, zipPath);

      await assert.rejects(
        async () => await packageGetTask(testRepo, 'no-task', '1.0.0', 'nonexistent'),
        /not found/
      );
    });

    it('throws for non-existent package', async () => {
      await assert.rejects(
        async () => await packageGetTask(testRepo, 'nonexistent', '1.0.0', 'task'),
        /not found|ENOENT/
      );
    });

    it('throws TaskNotFoundError for non-existent task', async () => {
      const myInput = e3.input('value', StringType, 'test');
      const pkg = e3.package('empty-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'empty-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(testRepo, zipPath);

      await assert.rejects(
        async () => await packageGetTask(testRepo, 'empty-tasks', '1.0.0', 'nonexistent'),
        TaskNotFoundError
      );
    });
  });

  describe('workspaceListTasks', () => {
    it('returns empty array for workspace with no tasks', async () => {
      const myInput = e3.input('value', StringType, 'hello');
      const pkg = e3.package('ws-no-tasks', '1.0.0', myInput);
      const zipPath = join(tempDir, 'ws-no-tasks.zip');
      await e3.export(pkg, zipPath);
      await packageImport(testRepo, zipPath);
      await workspaceDeploy(testRepo, 'myws', 'ws-no-tasks', '1.0.0');

      const tasks = await workspaceListTasks(testRepo, 'myws');

      assert.deepStrictEqual(tasks, []);
    });

    it('throws for non-existent workspace', async () => {
      await assert.rejects(
        async () => await workspaceListTasks(testRepo, 'nonexistent'),
        WorkspaceNotFoundError
      );
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(testRepo, 'empty');

      await assert.rejects(
        async () => await workspaceListTasks(testRepo, 'empty'),
        WorkspaceNotDeployedError
      );
    });
  });

  describe('workspaceGetTask', () => {
    it('throws for non-existent task', async () => {
      const myInput = e3.input('value', StringType, 'test');
      const pkg = e3.package('ws-no-task', '1.0.0', myInput);
      const zipPath = join(tempDir, 'ws-no-task.zip');
      await e3.export(pkg, zipPath);
      await packageImport(testRepo, zipPath);
      await workspaceDeploy(testRepo, 'myws', 'ws-no-task', '1.0.0');

      await assert.rejects(
        async () => await workspaceGetTask(testRepo, 'myws', 'nonexistent'),
        /not found/
      );
    });

    it('throws for non-existent workspace', async () => {
      await assert.rejects(
        async () => await workspaceGetTask(testRepo, 'nonexistent', 'task'),
        WorkspaceNotFoundError
      );
    });

    it('throws for undeployed workspace', async () => {
      await workspaceCreate(testRepo, 'empty');

      await assert.rejects(
        async () => await workspaceGetTask(testRepo, 'empty', 'task'),
        WorkspaceNotDeployedError
      );
    });
  });
});
