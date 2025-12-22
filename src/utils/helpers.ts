import * as core from '@actions/core';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';

export async function wait(ms: number): Promise<void> {
  const waitStart = Date.now();
  await new Promise((resolve) => setTimeout(resolve, ms));
  const actualWait = Date.now() - waitStart;
  core.debug(`Waited ${actualWait}ms (configured: ${ms}ms)`);
}

export function validatePlatform(): void {
  const platform = process.platform;
  core.debug(`Running on platform: ${platform}`);
}

export function isDockerCommand(command: string): boolean {
  return (
    command.includes('docker exec') ||
    command.includes('docker compose exec') ||
    command.includes('docker-compose exec')
  );
}

export function isDockerCompose(command: string): boolean {
  return (
    command.includes('docker compose exec') ||
    command.includes('docker-compose exec')
  );
}

// Extract a file from Docker container to temp location
export function extractFileFromContainer(
  containerPath: string,
  containerName: string,
  isDockerCompose: boolean,
): string | null {
  const tmpBaseDir = path.join(os.tmpdir(), 'phpunit-retry-tests');
  // Preserve directory structure to avoid filename collisions
  // Remove leading slash from containerPath for joining
  const relativePath = containerPath.startsWith('/')
    ? containerPath.substring(1)
    : containerPath;
  const localPath = path.join(tmpBaseDir, relativePath);

  // Validate path doesn't escape tmpBaseDir (prevent path traversal)
  const resolvedPath = path.resolve(localPath);
  const resolvedBaseDir = path.resolve(tmpBaseDir);
  if (!resolvedPath.startsWith(resolvedBaseDir)) {
    core.warning(
      `Invalid container path ${containerPath} (would escape temp directory), skipping extraction`,
    );
    return null;
  }

  const localDir = path.dirname(localPath);

  try {
    // Create full directory structure
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // Use array form to prevent shell injection
    const source = `${containerName}:${containerPath}`;
    const cpArgs = isDockerCompose
      ? ['docker', 'compose', 'cp', source, localPath]
      : ['docker', 'cp', source, localPath];

    core.debug(`Extracting test file from container: ${cpArgs.join(' ')}`);

    const result = spawnSync(cpArgs[0]!, cpArgs.slice(1), {
      stdio: 'pipe',
    });

    if (result.status === 0 && fs.existsSync(localPath)) {
      core.debug(`Successfully extracted: ${localPath}`);
      return localPath;
    }

    core.debug(
      `Failed to extract file: ${result.stderr?.toString() || 'unknown error'}`,
    );
    return null;
  } catch (error) {
    core.debug(
      `Error extracting file from container: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// Clean up extracted test files
export function cleanupExtractedFiles(): void {
  const tmpDir = path.join(os.tmpdir(), 'phpunit-retry-tests');
  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      core.debug(`Cleaned up extracted files: ${tmpDir}`);
    }
  } catch (error) {
    core.debug(
      `Failed to cleanup extracted files: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Find test file in workspace test directory
// Tries to match container path structure to workspace path
export function findTestFileInWorkspace(
  containerPath: string,
  testDir: string,
): string | null {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const filename = path.basename(containerPath);
  const testDirPath = path.join(workspace, testDir);

  // Extract relative path from container path
  // e.g., /usr/src/code/tests/e2e/ProjectsTest.php -> e2e/ProjectsTest.php
  let relativePath: string | null = null;

  const testDirMarkers = [testDir + '/', 'tests/', 'test/'];
  for (const marker of testDirMarkers) {
    const idx = containerPath.indexOf(marker);
    if (idx !== -1) {
      relativePath = containerPath.substring(idx + marker.length);
      break;
    }
  }

  if (relativePath) {
    const directPath = path.join(testDirPath, relativePath);
    if (fs.existsSync(directPath)) {
      core.debug(`Found test file using relative path: ${directPath}`);
      return directPath;
    }
  }

  core.debug(
    `Could not find file using relative path, searching by filename: ${filename}`,
  );
  const matches: string[] = [];

  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const stats = fs.lstatSync(dir);
    if (stats.isSymbolicLink()) {
      core.debug(`Skipping symlink: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile() && entry.name === filename) {
        matches.push(fullPath);
      }
    }
  }

  searchDir(testDirPath);

  if (matches.length > 1) {
    core.warning(
      `Multiple files found with name ${filename}. Using first match: ${matches[0]}. Consider using more specific test_dir input.`,
    );
  }

  return matches.length > 0 ? matches[0]! : null;
}
