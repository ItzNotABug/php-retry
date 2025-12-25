import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type RunnerOptions = {
  verbose: boolean;
  rawLogs: boolean;
};

export type RunCommandOptions = {
  cwd?: string;
  env?: Record<string, string>;
  allowFailure?: boolean;
  label?: string;
  logOutput?: "always" | "on-error" | "never";
};

export type RunCommandResult = {
  exitCode: number;
  output: string;
};

export type ActionEnvDefaults = {
  repoRoot: string;
  outputPath: string;
  testDir: string;
  maxAttempts: number;
  retryWaitSeconds?: number;
  timeoutMinutes?: number;
  shell?: string;
};

async function readStream(
  stream: ReadableStream<Uint8Array> | number | null | undefined,
): Promise<string> {
  if (!stream || typeof stream === "number") {
    return "";
  }
  return new Response(stream).text();
}

type SpawnedProcess = ReturnType<typeof Bun.spawn>;

async function collectOutput(proc: SpawnedProcess): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
  ]);
  return `${stdout}${stderr}`;
}

function setDefaultEnv(
  env: Record<string, string>,
  key: string,
  value: string,
): void {
  if (!env[key]) {
    env[key] = value;
  }
}

export function buildActionEnv(
  command: string,
  defaults: ActionEnvDefaults,
): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;

  setDefaultEnv(env, "GITHUB_WORKSPACE", defaults.repoRoot);
  setDefaultEnv(env, "GITHUB_ACTIONS", "true");
  setDefaultEnv(env, "GITHUB_OUTPUT", defaults.outputPath);
  setDefaultEnv(env, "INPUT_COMMAND", command);
  setDefaultEnv(env, "INPUT_TEST_DIR", defaults.testDir);
  setDefaultEnv(env, "INPUT_MAX_ATTEMPTS", String(defaults.maxAttempts));
  setDefaultEnv(
    env,
    "INPUT_RETRY_WAIT_SECONDS",
    String(defaults.retryWaitSeconds ?? 0),
  );
  setDefaultEnv(
    env,
    "INPUT_TIMEOUT_MINUTES",
    String(defaults.timeoutMinutes ?? 5),
  );
  setDefaultEnv(env, "INPUT_SHELL", defaults.shell ?? "bash");

  return env;
}

export async function assertCommandOk(
  runCommand: (cmd: string[], options?: RunCommandOptions) => Promise<RunCommandResult>,
  cmd: string[],
  label: string,
  message: string,
  options: RunCommandOptions = {},
): Promise<void> {
  const result = await runCommand(cmd, { allowFailure: true, label, ...options });
  if (result.exitCode !== 0) {
    throw new Error(message);
  }
}

export function getNodePath(): string {
  const nodePath = Bun.which("node");
  if (!nodePath) {
    throw new Error("node not found in PATH");
  }
  return nodePath;
}

export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function ensureFileExists(filePath: string, message: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(message);
  }
}

export function removeFileIfExists(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function removeDirIfExists(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function ensureOutputFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, "", { flag: "wx" });
  } catch (error) {
    const err = error as { code?: string };
    if (err?.code !== "EEXIST") {
      throw error;
    }
  }
}

export function readOutputsFile(filePath: string): Record<string, string> {
  ensureFileExists(filePath, `Expected action outputs file at ${filePath}`);
  return parseOutputs(filePath);
}

export function readJUnitXml(filePath: string): string {
  ensureFileExists(filePath, "Expected JUnit file to exist");
  return fs.readFileSync(filePath, "utf8");
}

export function parseOutputs(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, "utf8");
  const outputs: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const delimiterMatch = line.match(/^([^<]+)<<(.+)$/);
    if (delimiterMatch) {
      const key = parseOutputKey(delimiterMatch[1]!);
      const delimiter = delimiterMatch[2]!;
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]!);
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          `Missing delimiter "${delimiter}" for output key "${key}"`,
        );
      }
      outputs[key] = valueLines.join("\n");
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      throw new Error(`Malformed output line: ${line}`);
    }
    const key = parseOutputKey(line.slice(0, equalsIndex));
    outputs[key] = line.slice(equalsIndex + 1);
  }

  return outputs;
}

function parseOutputKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!key || key !== rawKey) {
    throw new Error(`Invalid output key: "${rawKey}"`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
    throw new Error(`Invalid output key: "${rawKey}"`);
  }
  return key;
}

export function formatOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const formatted: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("::group::")) {
      formatted.push(`== ${line.slice("::group::".length)} ==`);
      continue;
    }
    if (line.startsWith("::endgroup::")) {
      continue;
    }
    const cmdMatch = line.match(/^::(debug|notice|warning|error)::(.*)$/);
    if (cmdMatch) {
      formatted.push(`[${cmdMatch[1]}] ${cmdMatch[2]}`);
      continue;
    }
    formatted.push(line);
  }

  return formatted.join("\n");
}

export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  return `${seconds.toFixed(2)}s`;
}

export function createCommandRunner(options: RunnerOptions): {
  runCommand: (cmd: string[], options?: RunCommandOptions) => Promise<RunCommandResult>;
} {
  const { verbose, rawLogs } = options;
  const captureOutput = !rawLogs;

  async function runCommand(
    cmd: string[],
    runOptions: RunCommandOptions = {},
  ): Promise<RunCommandResult> {
    const proc = Bun.spawn(cmd, {
      cwd: runOptions.cwd,
      env: runOptions.env,
      stdout: captureOutput ? "pipe" : "inherit",
      stderr: captureOutput ? "pipe" : "inherit",
    });
    const output = captureOutput ? await collectOutput(proc) : "";
    const exitCode = await proc.exited;
    const logMode = runOptions.logOutput ?? (verbose ? "always" : "on-error");
    const formatted = output.trim() ? formatOutput(output).trim() : "";

    if (formatted) {
      if (logMode === "always") {
        console.log(formatted);
      } else if (logMode === "on-error" && exitCode !== 0) {
        console.error(formatted);
      }
    }

    if (exitCode !== 0 && !runOptions.allowFailure) {
      const label = runOptions.label || cmd.join(" ");
      throw new Error(`Command failed: ${label} (exit ${exitCode})`);
    }

    return { exitCode, output };
  }

  return { runCommand };
}
