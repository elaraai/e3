/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

/**
 * Package operations for e3 repositories.
 *
 * Handles importing, exporting, and managing packages in the content-addressed
 * object store.
 */

import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { decodeBeast2For } from '@elaraai/east';
import { PackageObjectType } from '@elaraai/e3-types';
import type { PackageObject } from '@elaraai/e3-types';
import { objectWrite, objectRead } from './objects.js';
import {
  PackageNotFoundError,
  PackageInvalidError,
  isNotFoundError,
} from './errors.js';

/**
 * Result of importing a package
 */
export interface PackageImportResult {
  name: string;
  version: string;
  packageHash: string;
  objectCount: number;
}

/**
 * Import a package from a .zip file into the repository.
 *
 * Extracts objects to `objects/`, creates ref at `packages/<name>/<version>`.
 *
 * @param repoPath - Path to .e3 repository
 * @param zipPath - Path to the .zip package file
 * @returns Import result with package name, version, and stats
 */
export async function packageImport(
  repoPath: string,
  zipPath: string
): Promise<PackageImportResult> {
  // Open the zip file
  const zipfile = await openZip(zipPath);

  let packageName: string | undefined;
  let packageVersion: string | undefined;
  let packageHash: string | undefined;
  let objectCount = 0;

  try {
    // Iterate through all entries
    for await (const entry of iterateZipEntries(zipfile)) {
      const { fileName, getData } = entry;

      // Skip directory entries
      if (fileName.endsWith('/')) {
        continue;
      }

      // Handle package ref: packages/<name>/<version>
      if (fileName.startsWith('packages/')) {
        const parts = fileName.split('/');
        if (parts.length === 3) {
          packageName = parts[1];
          packageVersion = parts[2];

          // Read the hash from the ref file
          const data = await getData();
          packageHash = data.toString('utf-8').trim();

          // Write the ref to the repository
          const refDir = path.join(repoPath, 'packages', packageName);
          await fs.mkdir(refDir, { recursive: true });
          const refPath = path.join(refDir, packageVersion);
          await fs.writeFile(refPath, packageHash + '\n');
        }
        continue;
      }

      // Handle object: objects/<ab>/<cdef...>.beast2
      if (fileName.startsWith('objects/')) {
        const data = await getData();

        // Store the object (objectWrite will verify the hash matches)
        await objectWrite(repoPath, data);
        objectCount++;
        continue;
      }

      // Unknown entry type - ignore for forward compatibility
    }
  } finally {
    // Close the zip file
    zipfile.close();
  }

  if (!packageName || !packageVersion || !packageHash) {
    throw new PackageInvalidError('missing package ref');
  }

  return {
    name: packageName,
    version: packageVersion,
    packageHash,
    objectCount,
  };
}

/**
 * Remove a package ref from the repository.
 *
 * Objects remain until gc is run.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageRemove(
  repoPath: string,
  name: string,
  version: string
): Promise<void> {
  const refPath = path.join(repoPath, 'packages', name, version);
  try {
    await fs.unlink(refPath);
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new PackageNotFoundError(name, version);
    }
    throw err;
  }

  // Try to remove the package name directory if empty
  const packageDir = path.join(repoPath, 'packages', name);
  try {
    await fs.rmdir(packageDir);
  } catch {
    // Directory not empty, that's fine
  }
}

/**
 * List all installed packages.
 *
 * @param repoPath - Path to .e3 repository
 * @returns Array of (name, version) pairs
 */
export async function packageList(
  repoPath: string
): Promise<Array<{ name: string; version: string }>> {
  const packagesDir = path.join(repoPath, 'packages');
  const packages: Array<{ name: string; version: string }> = [];

  try {
    const names = await fs.readdir(packagesDir);
    for (const name of names) {
      const nameDir = path.join(packagesDir, name);
      const stat = await fs.stat(nameDir);
      if (stat.isDirectory()) {
        const versions = await fs.readdir(nameDir);
        for (const version of versions) {
          packages.push({ name, version });
        }
      }
    }
  } catch {
    // packages directory doesn't exist or is empty
  }

  return packages;
}

/**
 * Get the latest version of a package.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @returns Latest version string, or undefined if package not found
 */
export async function packageGetLatestVersion(
  repoPath: string,
  name: string
): Promise<string | undefined> {
  const packages = await packageList(repoPath);
  const versions = packages
    .filter(p => p.name === name)
    .map(p => p.version)
    .sort();
  return versions[versions.length - 1];
}

/**
 * Resolve a package to its PackageObject hash.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @returns PackageObject hash
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageResolve(
  repoPath: string,
  name: string,
  version: string
): Promise<string> {
  const refPath = path.join(repoPath, 'packages', name, version);
  try {
    const content = await fs.readFile(refPath, 'utf-8');
    return content.trim();
  } catch (err) {
    if (isNotFoundError(err)) {
      throw new PackageNotFoundError(name, version);
    }
    throw err;
  }
}

/**
 * Read and parse a PackageObject.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @returns Parsed PackageObject
 * @throws {PackageNotFoundError} If package doesn't exist
 */
export async function packageRead(
  repoPath: string,
  name: string,
  version: string
): Promise<PackageObject> {
  const hash = await packageResolve(repoPath, name, version);
  const data = await objectRead(repoPath, hash);
  const decoder = decodeBeast2For(PackageObjectType);
  return decoder(Buffer.from(data));
}

/**
 * Result of exporting a package
 */
export interface PackageExportResult {
  packageHash: string;
  objectCount: number;
}

/**
 * Fixed mtime for deterministic zip output (Unix epoch)
 */
const DETERMINISTIC_MTIME = new Date(0);

/**
 * Export a package to a .zip file.
 *
 * Collects the package object and all transitively referenced objects.
 *
 * @param repoPath - Path to .e3 repository
 * @param name - Package name
 * @param version - Package version
 * @param zipPath - Path to write the .zip file
 * @returns Export result with package hash and object count
 */
export async function packageExport(
  repoPath: string,
  name: string,
  version: string,
  zipPath: string
): Promise<PackageExportResult> {
  const partialPath = `${zipPath}.partial`;

  // Resolve package to hash
  const packageHash = await packageResolve(repoPath, name, version);

  // Create zip file
  const zipfile = new yazl.ZipFile();

  // Track which objects we've added to avoid duplicates
  const addedObjects = new Set<string>();

  // Helper to add an object to the zip
  const addObject = async (hash: string): Promise<void> => {
    if (addedObjects.has(hash)) return;
    addedObjects.add(hash);

    const data = await objectRead(repoPath, hash);
    const zipPath = `objects/${hash.slice(0, 2)}/${hash.slice(2)}.beast2`;
    zipfile.addBuffer(Buffer.from(data), zipPath, { mtime: DETERMINISTIC_MTIME });
  };

  // Helper to collect children from a tree object
  // Tree objects are encoded as structs with DataRef fields
  const collectTreeChildren = async (treeData: Uint8Array): Promise<void> => {
    // Decode as a generic structure and extract DataRefs
    // This is a bit tricky since trees have dynamic structure
    // For now, we'll use a heuristic: scan for hash patterns in the beast2 data
    // A more robust approach would be to track the structure during export

    const dataStr = Buffer.from(treeData).toString('latin1');

    // Look for hash patterns (64 hex chars) that might be object references
    // Use matchAll to avoid regex state issues
    const hashPattern = /[a-f0-9]{64}/g;
    const matches = dataStr.matchAll(hashPattern);

    for (const match of matches) {
      const potentialHash = match[0];

      // Skip if we've already added this object
      if (addedObjects.has(potentialHash)) {
        continue;
      }

      // Try to load this as an object - if it exists, it's a reference
      try {
        await addObject(potentialHash);
        // Recursively collect children from this object
        const childData = await objectRead(repoPath, potentialHash);
        await collectTreeChildren(childData);
      } catch {
        // Object doesn't exist, not a valid reference - remove from set
        addedObjects.delete(potentialHash);
      }
    }
  };

  // Add the package object first
  await addObject(packageHash);

  // Load and parse the package object
  const packageData = await objectRead(repoPath, packageHash);
  const decoder = decodeBeast2For(PackageObjectType);
  const packageObject: PackageObject = decoder(Buffer.from(packageData));

  // Collect all task objects
  for (const taskHash of packageObject.tasks.values()) {
    await addObject(taskHash);
    // Note: Task objects reference datasets by path, not by hash,
    // so we don't need to recursively collect from them
  }

  // Collect the root tree and all its children
  const rootTreeHash = packageObject.data.value;
  await addObject(rootTreeHash);
  const rootTreeData = await objectRead(repoPath, rootTreeHash);
  await collectTreeChildren(rootTreeData);

  // Write the package ref
  const refPath = `packages/${name}/${version}`;
  zipfile.addBuffer(Buffer.from(packageHash + '\n'), refPath, { mtime: DETERMINISTIC_MTIME });

  // Finalize and write zip to disk
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(partialPath);
    zipfile.outputStream.pipe(writeStream);
    zipfile.outputStream.on('error', reject);
    writeStream.on('error', reject);
    writeStream.on('close', resolve);
    zipfile.end();
  });

  // Atomic rename to final path
  await fs.rename(partialPath, zipPath);

  return {
    packageHash,
    objectCount: addedObjects.size,
  };
}

// ============================================================================
// Zip file helpers using yauzl
// ============================================================================

interface ZipEntry {
  fileName: string;
  getData(): Promise<Buffer>;
}

/**
 * Open a zip file for reading
 */
function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error('No zipfile'));
      resolve(zipfile);
    });
  });
}

/**
 * Async iterator over zip entries
 */
async function* iterateZipEntries(
  zipfile: yauzl.ZipFile
): AsyncGenerator<ZipEntry> {
  // Create a queue for entries
  const entryQueue: Array<yauzl.Entry | null> = [];
  let resolveNext: (() => void) | null = null;
  let rejectNext: ((err: Error) => void) | null = null;

  zipfile.on('entry', (entry: yauzl.Entry) => {
    entryQueue.push(entry);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('end', () => {
    entryQueue.push(null); // Signal end
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  zipfile.on('error', (err: Error) => {
    if (rejectNext) {
      rejectNext(err);
      rejectNext = null;
    }
  });

  // Start reading
  zipfile.readEntry();

  while (true) {
    // Wait for an entry if queue is empty
    if (entryQueue.length === 0) {
      await new Promise<void>((resolve, reject) => {
        resolveNext = resolve;
        rejectNext = reject;
      });
    }

    const entry = entryQueue.shift();
    if (entry === null || entry === undefined) {
      return; // End of entries
    }

    // Create getData function for this entry
    const getData = (): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          if (!readStream) return reject(new Error('No read stream'));

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => resolve(Buffer.concat(chunks)));
          readStream.on('error', reject);
        });
      });
    };

    yield { fileName: entry.fileName, getData };

    // Read next entry
    zipfile.readEntry();
  }
}
