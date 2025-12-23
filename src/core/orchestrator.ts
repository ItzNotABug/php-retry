import * as core from '@actions/core';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import kill from 'tree-kill';
import { JUnitParser } from '../parsers/junit.js';
import { DependencyResolver } from '../parsers/dependency.js';
import { CommandBuilder } from '../builders/command.js';
import {
  wait,
  findTestFileInWorkspace,
  extractFileFromContainer,
  isDockerCommand,
  isDockerCompose,
} from '../utils/helpers.js';
import { getExecutable } from '../utils/shell.js';
import type {
  ActionInputs,
  FailedTest,
  AttemptStat,
  FirstAttemptStats,
} from '../types.js';

export class TestRetryOrchestrator {
  private readonly inputs: ActionInputs;
  private readonly parser: JUnitParser;
  private readonly builder: CommandBuilder;
  private readonly resolver: DependencyResolver;

  constructor(inputs: ActionInputs) {
    this.inputs = inputs;
    this.parser = new JUnitParser();
    this.builder = new CommandBuilder();
    this.resolver = new DependencyResolver();
  }

  private buildRetriedInfo(
    stat: AttemptStat,
    attemptIndex: number,
    attemptStats: AttemptStat[],
  ): string {
    if (stat.retried === 0 || stat.attempt === 1) {
      return '';
    }

    const prevStat = attemptStats[attemptIndex - 1]!;
    const failedCount = prevStat.failed;
    const dependencies = stat.retried - failedCount;

    if (dependencies > 0) {
      return ` (${failedCount} failed + ${dependencies} dependencies)`;
    }
    return ` (retried ${failedCount} tests)`;
  }

  private parseDependenciesFromFailedTests(
    failedTests: FailedTest[],
    command: string,
  ): boolean {
    const uniqueFiles = new Set(failedTests.map((t) => t.file));
    const parsedFiles = new Set<string>();
    const isDocker = isDockerCommand(command);
    const isCompose = isDockerCompose(command);

    let containerName: string | null = null;
    if (isDocker) {
      containerName = this.builder.extractContainerName(command);
      if (!containerName) {
        core.debug('Could not extract container name from command');
      }
    }

    for (const test of failedTests) {
      if (parsedFiles.has(test.file)) {
        continue;
      }

      let fullPath = findTestFileInWorkspace(test.file, this.inputs.testDir);

      // If not found in workspace and running in Docker,
      // try extracting from container
      if (!fullPath && isDocker && containerName) {
        core.info(
          `Test file not in workspace, extracting from container: ${test.file}`,
        );
        fullPath = extractFileFromContainer(
          test.file,
          containerName,
          isCompose,
        );
      }

      if (fullPath) {
        this.resolver.parseTestFile(fullPath);
        parsedFiles.add(test.file);
      } else {
        core.warning(`Test file not found: ${test.file}`);
      }
    }

    // Only use dependency filtering if we found ALL unique test files
    const dependenciesParsed = parsedFiles.size === uniqueFiles.size;
    core.debug(
      `Dependency parsing: ${parsedFiles.size}/${uniqueFiles.size} test files found`,
    );

    if (!dependenciesParsed) {
      core.warning(
        `Found ${parsedFiles.size}/${uniqueFiles.size} test files. Will run full test suite on retry.`,
      );
    } else {
      core.debug(
        'All test files found. Will use dependency filtering on retry.',
      );
    }

    return dependenciesParsed;
  }

  private async extractJUnitFromDocker(
    extractCmd: string,
    executable: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const extractChild = spawn(extractCmd, {
        shell: executable,
      });

      extractChild.on('error', (error) => {
        core.warning(`Failed to extract JUnit XML: ${error.message}`);
        resolve(); // Don't fail the entire action
      });

      let exitCode: number | null = null;

      extractChild.on('exit', (code) => {
        exitCode = code;
      });

      extractChild.on('close', () => {
        if (exitCode && exitCode !== 0) {
          core.warning(`Docker extraction exited with code ${exitCode}`);
        }
        resolve();
      });
    });
  }

  private async executeTestCommand(
    command: string,
    executable: string,
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const child = spawn(command, { shell: executable });
      let timedOut = false;
      let exitCode: number | null = null;

      const handleTimeout = () => {
        timedOut = true;
        if (child.pid) {
          core.warning(
            `Command exceeded timeout of ${this.inputs.timeoutMinutes} minute(s), killing process tree ${child.pid}`,
          );
          kill(child.pid, 'SIGTERM');
        }
      };

      // Setup timeout if configured
      const timeout =
        this.inputs.timeoutMinutes > 0
          ? setTimeout(handleTimeout, this.inputs.timeoutMinutes * 60 * 1000)
          : null;

      child.on('error', (error) => {
        if (timeout) clearTimeout(timeout);
        reject(
          new Error(
            `Failed to spawn command with shell '${executable}': ${error.message}`,
          ),
        );
      });

      child.stdout?.on('data', (data) => {
        process.stdout.write(data);
      });

      child.stderr?.on('data', (data) => {
        process.stdout.write(data);
      });

      child.on('exit', (code) => {
        exitCode = code || 0;
      });

      // Wait for 'close' event - this ensures all stdio streams are flushed
      child.on('close', () => {
        if (timeout) clearTimeout(timeout);

        if (timedOut) {
          reject(
            new Error(
              `Command timed out after ${this.inputs.timeoutMinutes} minute(s)`,
            ),
          );
        } else {
          resolve(exitCode || 0);
        }
      });
    });
  }

  private displayTestSummary(
    exitCode: number,
    attempt: number,
    firstAttemptStats: FirstAttemptStats | null,
    attemptStats: AttemptStat[],
  ): void {
    core.info('');
    core.info('='.repeat(60));
    if (firstAttemptStats) {
      const totalStr = String(firstAttemptStats.total).padStart(2, '0');
      core.info(`${totalStr} total tests`);

      for (
        let attemptIndex = 0;
        attemptIndex < attemptStats.length;
        attemptIndex++
      ) {
        const stat = attemptStats[attemptIndex]!;
        const isLast = attemptIndex === attemptStats.length - 1;
        const prefix = isLast ? ' └─' : ' ├─';
        const testWord = stat.failed === 1 ? 'test' : 'tests';

        if (exitCode === 0 && stat.failed === 0) {
          const retriedInfo = this.buildRetriedInfo(
            stat,
            attemptIndex,
            attemptStats,
          );
          core.info(
            `${prefix} Attempt ${stat.attempt}: All passed${retriedInfo}`,
          );
        } else {
          const retriedInfo =
            stat.attempt === 1 && stat.retried > 0
              ? ` (retried ${stat.retried} tests)`
              : this.buildRetriedInfo(stat, attemptIndex, attemptStats);
          core.info(
            `${prefix} Attempt ${stat.attempt}: ${stat.failed} ${testWord} failed${retriedInfo}`,
          );
        }
      }
    }

    const statusIcon = exitCode === 0 ? '✓' : '✗';
    const statusText = exitCode === 0 ? 'passed' : 'failed';
    core.info(
      `${statusIcon} Test suite ${statusText} after ${attempt} attempt(s)`,
    );
    core.info('='.repeat(60));
  }

  public async run(): Promise<void> {
    core.debug(
      `Inputs: max_attempts=${this.inputs.maxAttempts}, retry_wait=${this.inputs.retryWaitSeconds}s, test_dir=${this.inputs.testDir}`,
    );

    let attempt = 1;
    let exitCode = 0;
    let failedTests: FailedTest[] = [];
    let dependenciesParsed = false;
    let firstAttemptStats: FirstAttemptStats | null = null;
    let attemptStats: AttemptStat[] = [];

    // Use absolute path for JUnit XML to handle commands that change directories
    // Falls back to current directory if GITHUB_WORKSPACE is not set (for local testing)
    const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
    const defaultLocalJunitPath = path.join(workspace, 'phpunit-junit.xml');

    const existingJunitPath = this.builder.extractJUnitPath(
      this.inputs.command,
    );
    const localJunitPath = existingJunitPath || defaultLocalJunitPath;

    if (existingJunitPath) {
      core.info(
        `Detected existing --log-junit in command, using path: ${existingJunitPath}`,
      );
    }

    while (attempt <= this.inputs.maxAttempts) {
      core.startGroup(`Attempt ${attempt}`);

      let testsRetriedThisAttempt = 0;

      try {
        if (!existingJunitPath && fs.existsSync(localJunitPath)) {
          fs.unlinkSync(localJunitPath);
        }

        let command = this.inputs.command;

        if (attempt === 1) {
          command = this.builder.addJUnitLogging(
            command,
            defaultLocalJunitPath,
          );
        } else {
          // If dependencies couldn't be parsed, run full suite as fallback
          if (!dependenciesParsed) {
            core.warning(
              `Could not parse dependencies on first attempt - retrying all tests`,
            );
            command = this.builder.addJUnitLogging(
              command,
              defaultLocalJunitPath,
            );
            testsRetriedThisAttempt = firstAttemptStats?.total || 0;
          } else {
            const filterPattern = this.resolver.buildFilterPattern(failedTests);
            const testsToRun = filterPattern
              ? filterPattern.split('|').length
              : 0;
            testsRetriedThisAttempt = testsToRun;

            const tree = this.resolver.buildDependencyTree(failedTests);
            if (tree) {
              core.info('Dependency analysis:');
              core.info(tree);
              core.info('');
            }

            core.info(
              `Retrying ${failedTests.length} failed test(s) + dependencies (${testsToRun} total)`,
            );
            core.debug(`Filter pattern includes ${testsToRun} test(s)`);
            command = this.builder.addFilter(command, filterPattern);
            command = this.builder.addJUnitLogging(
              command,
              defaultLocalJunitPath,
            );
          }
        }

        command = this.builder.addEnvVar(
          command,
          'PHPUNIT_RETRY_ATTEMPT',
          attempt.toString(),
        );

        const executable = getExecutable(this.inputs.shell);
        core.debug(`Executing command with shell: ${executable}`);

        exitCode = await this.executeTestCommand(command, executable);

        core.debug(`Command exited with code: ${exitCode}`);

        if (isDockerCommand(command)) {
          const containerJunitPath = existingJunitPath || undefined;
          const extractCmd = this.builder.buildExtractCommand(
            command,
            existingJunitPath || defaultLocalJunitPath,
            containerJunitPath,
          );
          if (extractCmd) {
            await this.extractJUnitFromDocker(extractCmd, executable);
          } else {
            core.warning(
              'Could not extract container name from command, JUnit XML extraction skipped',
            );
          }
        }

        if (exitCode === 0) {
          failedTests = [];
          // Track successful attempt
          attemptStats.push({
            attempt,
            failed: 0,
            retried: testsRetriedThisAttempt,
          });
          break;
        }

        if (!fs.existsSync(localJunitPath)) {
          core.warning('JUnit XML not found, cannot parse failures');
          break;
        }

        failedTests = this.parser.parseXMLFile(localJunitPath);

        if (attempt === 1) {
          firstAttemptStats = this.parser.getTestStats(localJunitPath);
        }

        // Track stats for this attempt
        attemptStats.push({
          attempt,
          failed: failedTests.length,
          retried: testsRetriedThisAttempt,
        });

        if (failedTests.length === 0) {
          core.warning('Tests failed but no specific failures in JUnit XML');
          break;
        }

        if (attempt === 1) {
          dependenciesParsed = this.parseDependenciesFromFailedTests(
            failedTests,
            command,
          );
        }

        if (attempt >= this.inputs.maxAttempts) {
          break;
        }

        core.info('');
        core.info(`Waiting ${this.inputs.retryWaitSeconds}s before retry...`);
        await wait(this.inputs.retryWaitSeconds * 1000);
      } catch (attemptError) {
        throw attemptError;
      } finally {
        core.endGroup();
      }

      attempt++;
    }

    this.displayTestSummary(exitCode, attempt, firstAttemptStats, attemptStats);

    core.setOutput('total_attempts', attempt);
    core.setOutput('exit_code', exitCode);
    core.setOutput(
      'failed_tests',
      JSON.stringify(failedTests.map((t) => t.name)),
    );
    core.setOutput('success', exitCode === 0 ? 'true' : 'false');

    if (exitCode !== 0) {
      core.setFailed(`Tests failed after ${attempt} attempts`);
    }
  }
}
