import * as core from "@actions/core";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import kill from "tree-kill";
import { getInputs } from "./utils/inputs.js";
import { JUnitParser } from "./parsers/junit.js";
import { DependencyResolver } from "./parsers/dependency.js";
import { CommandBuilder } from "./builders/command.js";
import {
  wait,
  findTestFileInWorkspace,
  validatePlatform,
} from "./utils/helpers.js";
import { getExecutable } from "./utils/shell.js";
import type { FailedTest } from "./types.js";

export async function run(): Promise<void> {
  try {
    validatePlatform();

    const inputs = getInputs();
    core.debug(
      `Inputs: max_attempts=${inputs.maxAttempts}, retry_wait=${inputs.retryWaitSeconds}s, test_dir=${inputs.testDir}`,
    );

    const parser = new JUnitParser();
    const resolver = new DependencyResolver();
    const builder = new CommandBuilder();

    let attempt = 1;
    let exitCode = 0;
    let failedTests: FailedTest[] = [];
    let dependenciesParsed = false;

    // Use absolute path for JUnit XML to handle commands that change directories
    // Falls back to current directory if GITHUB_WORKSPACE is not set (for local testing)
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const defaultLocalJunitPath = path.join(workspace, "phpunit-junit.xml");

    const existingJunitPath = builder.extractJUnitPath(inputs.command);
    const localJunitPath = existingJunitPath || defaultLocalJunitPath;

    if (existingJunitPath) {
      core.info(
        `Detected existing --log-junit in command, using path: ${existingJunitPath}`,
      );
    }

    while (attempt <= inputs.maxAttempts) {
      core.startGroup(`Attempt ${attempt}`);

      try {
        if (!existingJunitPath && fs.existsSync(localJunitPath)) {
          fs.unlinkSync(localJunitPath);
        }

        let command = inputs.command;

        if (attempt === 1) {
          command = builder.addJUnitLogging(command, defaultLocalJunitPath);
        } else {
          // If dependencies couldn't be parsed, run full suite as fallback
          if (!dependenciesParsed) {
            core.warning(
              `Could not parse dependencies on first attempt - retrying all tests`,
            );
            command = builder.addJUnitLogging(command, defaultLocalJunitPath);
          } else {
            const filterPattern = resolver.buildFilterPattern(failedTests);
            const testsToRun = filterPattern.split("|").length;

            const tree = resolver.buildDependencyTree(failedTests);
            if (tree) {
              core.info("Dependency analysis:");
              core.info(tree);
            }

            core.info(
              `Retrying ${failedTests.length} failed test(s) + dependencies (${testsToRun} total)`,
            );
            core.debug(`Filter pattern includes ${testsToRun} test(s)`);
            command = builder.addFilter(command, filterPattern);
            command = builder.addJUnitLogging(command, defaultLocalJunitPath);
          }
        }

        command = builder.addEnvVar(
          command,
          "PHPUNIT_RETRY_ATTEMPT",
          attempt.toString(),
        );

        const executable = getExecutable(inputs.shell);
        core.debug(`Executing command with shell: ${executable}`);

        exitCode = await new Promise<number>((resolve, reject) => {
          const child = spawn(command, { shell: executable });
          let timedOut = false;
          let exitCode: number | null = null;

          // Setup timeout if configured
          const timeout =
            inputs.timeoutMinutes > 0
              ? setTimeout(() => {
                  timedOut = true;
                  if (child.pid) {
                    core.warning(
                      `Command exceeded timeout of ${inputs.timeoutMinutes} minute(s), killing process tree ${child.pid}`,
                    );
                    kill(child.pid, "SIGTERM");
                  }
                }, inputs.timeoutMinutes * 60 * 1000)
              : null;

          child.on("error", (error) => {
            if (timeout) clearTimeout(timeout);
            reject(
              new Error(
                `Failed to spawn command with shell '${executable}': ${error.message}`,
              ),
            );
          });

          child.stdout?.on("data", (data) => {
            process.stdout.write(data);
          });

          child.stderr?.on("data", (data) => {
            process.stdout.write(data);
          });

          child.on("exit", (code) => {
            exitCode = code || 0;
          });

          // Wait for 'close' event - this ensures all stdio streams are flushed
          child.on("close", () => {
            if (timeout) clearTimeout(timeout);

            if (timedOut) {
              reject(
                new Error(
                  `Command timed out after ${inputs.timeoutMinutes} minute(s)`,
                ),
              );
            } else {
              resolve(exitCode || 0);
            }
          });
        });

        core.debug(`Command exited with code: ${exitCode}`);

        if (
          command.includes("docker exec") ||
          command.includes("docker compose exec") ||
          command.includes("docker-compose exec")
        ) {
          const containerJunitPath = existingJunitPath || undefined;
          const extractCmd = builder.buildExtractCommand(
            command,
            existingJunitPath || defaultLocalJunitPath,
            containerJunitPath,
          );
          if (extractCmd) {
            await new Promise<void>((resolve) => {
              const extractChild = spawn(extractCmd, { shell: executable });

              extractChild.on("error", (error) => {
                core.warning(
                  `Failed to extract JUnit XML: ${error.message}`,
                );
                resolve(); // Don't fail the entire action
              });

              extractChild.on("exit", (code) => {
                if (code && code !== 0) {
                  core.warning(`Docker extraction exited with code ${code}`);
                }
                resolve();
              });
            });
          } else {
            core.warning(
              "Could not extract container name from command, JUnit XML extraction skipped",
            );
          }
        }

        if (exitCode === 0) {
          failedTests = [];
          break;
        }

        if (!fs.existsSync(localJunitPath)) {
          core.warning("JUnit XML not found, cannot parse failures");
          break;
        }

        failedTests = parser.parseXMLFile(localJunitPath);

        if (failedTests.length === 0) {
          core.warning("Tests failed but no specific failures in JUnit XML");
          break;
        }

        if (attempt === 1) {
          const uniqueFiles = new Set(failedTests.map((t) => t.file));
          const parsedFiles = new Set<string>();

          for (const test of failedTests) {
            if (parsedFiles.has(test.file)) {
              continue;
            }

            const fullPath = findTestFileInWorkspace(test.file, inputs.testDir);

            if (fullPath) {
              resolver.parseTestFile(fullPath);
              parsedFiles.add(test.file);
            } else {
              core.warning(`Test file not found: ${test.file}`);
            }
          }

          // Only use dependency filtering if we found ALL unique test files
          dependenciesParsed = parsedFiles.size === uniqueFiles.size;
          core.debug(
            `Dependency parsing: ${parsedFiles.size}/${uniqueFiles.size} test files found`,
          );

          if (!dependenciesParsed) {
            core.warning(
              `Found ${parsedFiles.size}/${uniqueFiles.size} test files. Will run full test suite on retry.`,
            );
          } else {
            core.debug(
              "All test files found. Will use dependency filtering on retry.",
            );
          }
        }

        if (attempt >= inputs.maxAttempts) {
          break;
        }

        core.info(`Waiting ${inputs.retryWaitSeconds}s before retry...`);
        await wait(inputs.retryWaitSeconds * 1000);
      } catch (attemptError) {
        throw attemptError;
      } finally {
        core.endGroup();
      }

      attempt++;
    }

    if (exitCode === 0) {
      core.info(`Command completed after ${attempt} attempt(s).`);
    }

    core.setOutput("total_attempts", attempt);
    core.setOutput("exit_code", exitCode);
    core.setOutput(
      "failed_tests",
      JSON.stringify(failedTests.map((t) => t.name)),
    );
    core.setOutput("success", exitCode === 0 ? "true" : "false");

    if (exitCode !== 0) {
      core.setFailed(`Tests failed after ${attempt} attempt(s)`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${errorMessage}`);
  }
}

run();
