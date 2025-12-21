import * as core from "@actions/core";
import type { ActionInputs } from "../types.js";

function getInputNumber(
  id: string,
  required: boolean,
  defaultValue?: number,
): number | undefined {
  const input = core.getInput(id, { required });

  // Empty is ok if not required
  if (!input && !required) {
    return defaultValue;
  }

  const num = parseInt(input, 10);

  if (!Number.isInteger(num)) {
    throw new Error(
      `Input '${id}' must be a valid integer. Received: "${input}"`,
    );
  }

  return num;
}

function validateRange(
  name: string,
  value: number,
  min: number,
  max?: number,
): void {
  if (value < min) {
    throw new Error(`Input '${name}' must be >= ${min}. Received: ${value}`);
  }
  if (max !== undefined && value > max) {
    throw new Error(`Input '${name}' must be <= ${max}. Received: ${value}`);
  }
}

export function getInputs(): ActionInputs {
  const command = core.getInput("command", { required: true });
  const testDir = core.getInput("test_dir", { required: true });
  const shell = core.getInput("shell") || "bash";

  const maxAttempts = getInputNumber("max_attempts", false, 3)!;
  const retryWaitSeconds = getInputNumber("retry_wait_seconds", false, 10)!;
  const timeoutMinutes = getInputNumber("timeout_minutes", false, 30)!;

  // Validate ranges
  validateRange("max_attempts", maxAttempts, 1, 10);
  validateRange("retry_wait_seconds", retryWaitSeconds, 0);
  validateRange("timeout_minutes", timeoutMinutes, 0); // 0 = no timeout

  return {
    command,
    maxAttempts,
    retryWaitSeconds,
    shell,
    timeoutMinutes,
    testDir,
  };
}
