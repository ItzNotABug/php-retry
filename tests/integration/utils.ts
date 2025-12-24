import * as fs from "fs";
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

export function ensureOutputFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "");
  }
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
      const key = delimiterMatch[1]!;
      const delimiter = delimiterMatch[2]!;
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]!);
        i++;
      }
      outputs[key] = valueLines.join("\n");
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = line.slice(0, equalsIndex);
    outputs[key] = line.slice(equalsIndex + 1);
  }

  return outputs;
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

    if (verbose && captureOutput && output.trim()) {
      const formatted = formatOutput(output).trim();
      if (formatted) {
        console.log(formatted);
      }
    }

    if (exitCode !== 0 && !runOptions.allowFailure) {
      if (!verbose && output.trim()) {
        const formatted = formatOutput(output).trim();
        if (formatted) {
          console.error(formatted);
        }
      }
      const label = runOptions.label || cmd.join(" ");
      throw new Error(`Command failed: ${label} (exit ${exitCode})`);
    }

    return { exitCode, output };
  }

  return { runCommand };
}
