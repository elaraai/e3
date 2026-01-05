/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under BSL 1.1. See LICENSE for details.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ObjectStore } from '../interfaces.js';
import {
  objectWrite,
  objectWriteStream,
  objectRead,
  objectExists,
} from '../../objects.js';

/**
 * Local filesystem implementation of ObjectStore.
 *
 * Wraps the existing objects.ts functions.
 */
export class LocalObjectStore implements ObjectStore {
  constructor(private readonly repoPath: string) {}

  async write(data: Uint8Array): Promise<string> {
    return objectWrite(this.repoPath, data);
  }

  async writeStream(stream: AsyncIterable<Uint8Array>): Promise<string> {
    // Convert AsyncIterable to ReadableStream for objectWriteStream
    const readableStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of stream) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    });
    return objectWriteStream(this.repoPath, readableStream);
  }

  async read(hash: string): Promise<Uint8Array> {
    return objectRead(this.repoPath, hash);
  }

  async exists(hash: string): Promise<boolean> {
    return objectExists(this.repoPath, hash);
  }

  async list(): Promise<string[]> {
    const objectsDir = path.join(this.repoPath, 'objects');
    const hashes: string[] = [];

    try {
      const prefixDirs = await fs.readdir(objectsDir);

      for (const prefix of prefixDirs) {
        if (!/^[a-f0-9]{2}$/.test(prefix)) continue;

        const prefixPath = path.join(objectsDir, prefix);
        const stat = await fs.stat(prefixPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(prefixPath);
        for (const file of files) {
          if (file.endsWith('.beast2') && !file.includes('.partial')) {
            // Reconstruct full hash: prefix + filename without extension
            const hash = prefix + file.slice(0, -7);
            hashes.push(hash);
          }
        }
      }
    } catch {
      // Objects directory doesn't exist
    }

    return hashes;
  }
}
