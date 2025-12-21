import * as core from "@actions/core";
import * as path from "path";
import * as fs from "fs";

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
// Searches for the test file by name within the provided testDir
export function findTestFileInWorkspace(
  containerPath: string,
  testDir: string,
): string | null {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const filename = path.basename(containerPath);
  const testDirPath = path.join(workspace, testDir);

  // Search for file by name in testDir recursively
  const matches: string[] = [];

  function searchDir(dir: string): void {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      // Skip node_modules and .git directories
      if (entry.name === "node_modules" || entry.name === ".git") {
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

  return matches.length > 0 ? matches[0]! : null;
}
