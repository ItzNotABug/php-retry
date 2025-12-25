import * as path from "path";
import {
  buildActionEnv,
  assertCommandOk,
  createTempDir,
  createCommandRunner,
  ensureFileExists,
  ensureOutputFile,
  formatOutput,
  formatDuration,
  getNodePath,
  readJUnitXml,
  readOutputsFile,
  removeDirIfExists,
  removeFileIfExists,
  type RunCommandResult,
} from "./utils";
import { scenarios, type Scenario, type ScenarioResult } from "./scenarios";

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const rawLogs = args.has("--raw");
const { runCommand } = createCommandRunner({ verbose, rawLogs });

const repoRoot = path.resolve(__dirname, "..", "..");
const distEntry = path.join(repoRoot, "dist", "index.js");
const junitPath = path.join(repoRoot, "phpunit-junit.xml");
const projectDir = path.join(
  repoRoot,
  "tests",
  "integration",
  "resources",
  "phpunit-project",
);
const containerName = "phpunit-retry-test";

async function runPrechecks(): Promise<void> {
  await assertCommandOk(
    runCommand,
    ["docker", "info"],
    "docker info",
    "Docker daemon is not available. Start Docker and try again.",
  );
  await assertCommandOk(
    runCommand,
    ["docker", "compose", "version"],
    "docker compose version",
    "Docker Compose is not available. Install Docker Compose and try again.",
  );
}

function prepareOutputFile(tmpDir: string, scenario: Scenario): string {
  const outputFile = path.join(tmpDir, `outputs-${scenario.containerId}.txt`);
  removeFileIfExists(outputFile);
  ensureOutputFile(outputFile);

  return outputFile;
}

function buildScenarioCommand(scenario: Scenario): string {
  const baseCommand = `docker exec ${containerName} vendor/bin/phpunit`;
  if (!scenario.testPath) {
    return baseCommand;
  }
  if (!/^[A-Za-z0-9_./-]+$/.test(scenario.testPath)) {
    throw new Error(`Invalid test path: ${scenario.testPath}`);
  }
  return `${baseCommand} ${scenario.testPath}`;
}

function validateOutputs(
  outputs: Record<string, string>,
  scenario: Scenario,
): void {
  if (!outputs.total_attempts) {
    throw new Error("Missing output: total_attempts");
  }
  if (outputs.total_attempts !== String(scenario.expectedAttempts)) {
    throw new Error(
      `Expected total_attempts=${scenario.expectedAttempts}, got ${outputs.total_attempts}`,
    );
  }
  if (outputs.success !== scenario.expectedSuccess) {
    throw new Error(
      `Expected success=${scenario.expectedSuccess}, got ${outputs.success}`,
    );
  }
}

function validateRetryScope(xml: string, scenario: Scenario): number {
  const testcaseNames = Array.from(
    xml.matchAll(/<testcase\b[^>]*\bname="([^"]+)"/g),
    (match) => match[1]!,
  );
  const retryCount = testcaseNames.length;
  if (retryCount !== scenario.expectedRetryTests) {
    throw new Error(
      `Expected ${scenario.expectedRetryTests} testcases on retry, got ${retryCount}`,
    );
  }

  const testcaseSet = new Set(testcaseNames);

  for (const name of scenario.expectedPresent) {
    if (!testcaseSet.has(name)) {
      throw new Error(`Missing expected test name: ${name}`);
    }
  }

  for (const name of scenario.expectedAbsent) {
    if (testcaseSet.has(name)) {
      throw new Error(`Unexpected test name on retry: ${name}`);
    }
  }

  return retryCount;
}

function logScenarioStart(scenario: Scenario): void {
  if (verbose) {
    console.log(`Scenario: ${scenario.name}`);
  }
}

function logScenarioSuccess(scenario: Scenario, retryCount: number): void {
  if (verbose) {
    console.log(`OK: ${scenario.name} (${retryCount} testcases)`);
  }
}

function logScenarioFailure(
  scenario: Scenario,
  actionOutput: string,
  error: unknown,
): void {
  if (verbose) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ ${scenario.name}: ${message}`);
  if (actionOutput.trim()) {
    const formatted = formatOutput(actionOutput).trim();
    if (formatted) {
      console.error(formatted);
    }
  }
  console.error("Tip: re-run with --verbose for full logs.");
}

async function dockerComposeDown(): Promise<void> {
  await runCommand(["docker", "compose", "down", "--remove-orphans"], {
    cwd: projectDir,
    allowFailure: true,
    label: "docker compose down",
  });
}

async function dockerComposeUp(): Promise<void> {
  await runCommand(["docker", "compose", "up", "-d", "--build"], {
    cwd: projectDir,
    label: "docker compose up",
  });
}

function cleanupFiles(tmpDir: string): void {
  try {
    removeDirIfExists(tmpDir);
  } catch (error) {
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to remove temp dir: ${message}`);
    }
  }
  try {
    removeFileIfExists(junitPath);
  } catch (error) {
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to remove JUnit file: ${message}`);
    }
  }
}

async function runScenario(
  scenario: Scenario,
  nodePath: string,
  tmpDir: string,
): Promise<ScenarioResult> {
  const outputFile = prepareOutputFile(tmpDir, scenario);
  let actionResult: RunCommandResult | undefined;
  const startedAt = Date.now();

  removeFileIfExists(junitPath);

  try {
    logScenarioStart(scenario);
    const command = buildScenarioCommand(scenario);
    const env = buildActionEnv(command, {
      repoRoot,
      outputPath: outputFile,
      testDir: scenario.testDir,
      maxAttempts: scenario.maxAttempts,
    });
    env.GITHUB_OUTPUT = outputFile;

    actionResult = await runCommand([nodePath, distEntry], {
      cwd: repoRoot,
      env,
      allowFailure: true,
      label: `action:${scenario.name}`,
    });

    const outputs = readOutputsFile(outputFile);
    validateOutputs(outputs, scenario);

    const xml = readJUnitXml(junitPath);
    const retryCount = validateRetryScope(xml, scenario);
    const durationMs = Date.now() - startedAt;
    logScenarioSuccess(scenario, retryCount);
    return { name: scenario.name, retryCount, durationMs };
  } catch (error) {
    logScenarioFailure(scenario, actionResult?.output ?? "", error);
    throw error;
  }
}

async function runScenarios(
  nodePath: string,
  tmpDir: string,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  if (!verbose) {
    console.log("Integration tests");
    console.log("-----------------");
    console.log("");
  }
  for (const scenario of scenarios) {
    const result = await runScenario(scenario, nodePath, tmpDir);
    results.push(result);
    if (!verbose) {
      console.log(`Scenario: ${result.name}`);
      console.log("  Result: PASS");
      console.log(`  Retry scope: ${result.retryCount} tests`);
      console.log(`  Duration: ${formatDuration(result.durationMs)}`);
      console.log("");
    }
  }
  return results;
}

function logSummary(results: ScenarioResult[], durationMs: number): void {
  if (verbose) {
    console.log("Integration test passed");
    return;
  }
  const totalTests = results.reduce((sum, r) => sum + r.retryCount, 0);
  console.log("Summary");
  console.log("-------");
  console.log(
    `  Scenarios: ${results.length}/${scenarios.length} passed`,
  );
  console.log(`  Retry scope total: ${totalTests} tests`);
  console.log(`  Total time: ${formatDuration(durationMs)}`);
  console.log("");
  console.log("Tip: use --verbose for action logs; use --raw for raw output.");
}

async function runIntegrationTests(): Promise<void> {
  const nodePath = getNodePath();
  ensureFileExists(distEntry, "dist/index.js not found; run bun run build first");
  await runPrechecks();

  const tmpDir = createTempDir("phpunit-retry-integration-");
  const runStartedAt = Date.now();

  await dockerComposeDown();
  await dockerComposeUp();

  try {
    const results = await runScenarios(nodePath, tmpDir);
    const totalDuration = Date.now() - runStartedAt;
    logSummary(results, totalDuration);
  } finally {
    await dockerComposeDown();
    cleanupFiles(tmpDir);
  }
}

async function main(): Promise<void> {
  try {
    await runIntegrationTests();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Integration test failed: ${message}`);
    process.exit(1);
  }
}

void main();
