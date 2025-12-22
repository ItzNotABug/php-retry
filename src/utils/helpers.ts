import * as core from '@actions/core';
import * as path from 'path';
import * as fs from 'fs';

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
