import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildActionEnv,
  createCommandRunner,
  ensureOutputFile,
  formatOutput,
  formatDuration,
  parseOutputs,
} from "./utils";

type Scenario = {
  name: string;
  containerId: string;
  testPath?: string;
  testDir: string;
  maxAttempts: number;
  expectedAttempts: number;
  expectedSuccess: "true" | "false";
  expectedRetryTests: number;
  expectedPresent: string[];
  expectedAbsent: string[];
};

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
  "phpunit-project",
);
const testDirInput = "tests/integration/phpunit-project/tests";
const containerName = "phpunit-retry-test";

const scenarios: Scenario[] = [
  {
    name: "Simple Dependencies",
    containerId: "simple",
    testPath: "tests/SampleTest.php",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 6,
    expectedPresent: [
      'name="testCreate"',
      'name="testUpdate"',
      'name="testRead"',
      'name="testDelete"',
      'name="testMultipleDeps"',
      'name="testAnotherFailure"',
    ],
    expectedAbsent: ['name="testIndependent"'],
  },
  {
    name: "Complex Dependencies",
    containerId: "complex",
    testPath: "tests/ProjectTest.php",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 3,
    expectedPresent: [
      'name="testCreateProject"',
      'name="testUpdateProject"',
      'name="testDeleteProject"',
    ],
    expectedAbsent: ['name="testProjectValidation"', 'name="testListProjects"'],
  },
  {
    name: "Full Test Suite",
    containerId: "full",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 9,
    expectedPresent: [
      'name="testCreate"',
      'name="testUpdate"',
      'name="testRead"',
      'name="testDelete"',
      'name="testMultipleDeps"',
      'name="testAnotherFailure"',
      'name="testCreateProject"',
      'name="testUpdateProject"',
      'name="testDeleteProject"',
    ],
    expectedAbsent: [
      'name="testIndependent"',
      'name="testProjectValidation"',
      'name="testListProjects"',
    ],
  },
];

type ScenarioResult = {
  name: string;
  retryCount: number;
  durationMs: number;
};

async function runScenario(
  scenario: Scenario,
  nodePath: string,
  tmpDir: string,
): Promise<ScenarioResult> {
  const defaultOutputFile = path.join(
    tmpDir,
    `outputs-${scenario.containerId}.txt`,
  );
  const outputFile = process.env.GITHUB_OUTPUT || defaultOutputFile;
  let actionOutput = "";
  const startedAt = Date.now();

  if (fs.existsSync(junitPath)) {
    fs.unlinkSync(junitPath);
  }
  if (outputFile === defaultOutputFile && fs.existsSync(outputFile)) {
    fs.unlinkSync(outputFile);
  }
  ensureOutputFile(outputFile);

  try {
    if (verbose) {
      console.log(`Scenario: ${scenario.name}`);
    }
    const baseCommand = `docker exec ${containerName} vendor/bin/phpunit`;
    const command = scenario.testPath
      ? `${baseCommand} ${scenario.testPath}`
      : baseCommand;

    const env = buildActionEnv(command, {
      repoRoot,
      outputPath: outputFile,
      testDir: scenario.testDir,
      maxAttempts: scenario.maxAttempts,
    });

    const actionResult = await runCommand([nodePath, distEntry], {
      cwd: repoRoot,
      env,
      allowFailure: true,
      label: `action:${scenario.name}`,
    });
    actionOutput = actionResult.output;

    if (!fs.existsSync(outputFile)) {
      throw new Error(`Expected action outputs file at ${outputFile}`);
    }

    const outputs = parseOutputs(outputFile);
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

    if (!fs.existsSync(junitPath)) {
      throw new Error("Expected JUnit file to exist");
    }

    const xml = fs.readFileSync(junitPath, "utf8");
    const retryCount = (xml.match(/<testcase\b/g) || []).length;
    if (retryCount !== scenario.expectedRetryTests) {
      throw new Error(
        `Expected ${scenario.expectedRetryTests} testcases on retry, got ${retryCount}`,
      );
    }

    for (const pattern of scenario.expectedPresent) {
      if (!xml.includes(pattern)) {
        throw new Error(`Missing expected test pattern: ${pattern}`);
      }
    }

    for (const pattern of scenario.expectedAbsent) {
      if (xml.includes(pattern)) {
        throw new Error(`Unexpected test pattern on retry: ${pattern}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    if (verbose) {
      console.log(`OK: ${scenario.name} (${retryCount} testcases)`);
    }
    return { name: scenario.name, retryCount, durationMs };
  } catch (error) {
    if (!verbose) {
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
    throw error;
  }
}

async function runIntegrationTests(): Promise<void> {
  const nodePath = Bun.which("node");
  if (!nodePath) {
    throw new Error("node not found in PATH");
  }

  if (!fs.existsSync(distEntry)) {
    throw new Error("dist/index.js not found; run bun run build first");
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "phpunit-retry-integration-"),
  );
  const runStartedAt = Date.now();

  await runCommand(["docker", "compose", "down", "--remove-orphans"], {
    cwd: projectDir,
    allowFailure: true,
    label: "docker compose down",
  });

  await runCommand(["docker", "compose", "up", "-d", "--build"], {
    cwd: projectDir,
    label: "docker compose up",
  });

  try {
    const results: ScenarioResult[] = [];
    if (!verbose) {
      console.log(`Running integration tests (${scenarios.length} scenarios)`);
    }
    for (const scenario of scenarios) {
      const result = await runScenario(scenario, nodePath, tmpDir);
      results.push(result);
      if (!verbose) {
        console.log(
          `✓ ${result.name} (${result.retryCount} tests, ${formatDuration(result.durationMs)})`,
        );
      }
    }
    const totalDuration = Date.now() - runStartedAt;
    if (!verbose) {
      const totalTests = results.reduce((sum, r) => sum + r.retryCount, 0);
      console.log(
        `All passed (${results.length}/${scenarios.length}, ${totalTests} tests) in ${formatDuration(totalDuration)}`,
      );
      console.log("Tip: re-run with --verbose for full logs.");
    } else {
      console.log("Integration test passed");
    }
  } finally {
    await runCommand(["docker", "compose", "down", "--remove-orphans"], {
      cwd: projectDir,
      allowFailure: true,
      label: "docker compose down",
    });
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
