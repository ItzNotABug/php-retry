import * as core from '@actions/core';
import { getInputs } from './utils/inputs.js';
import { validatePlatform, cleanupExtractedFiles } from './utils/helpers.js';
import { TestRetryOrchestrator } from './core/orchestrator.js';

export async function run(): Promise<void> {
  try {
    validatePlatform();

    const inputs = getInputs();
    const orchestrator = new TestRetryOrchestrator(inputs);

    await orchestrator.run();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    core.setFailed(`Action failed: ${errorMessage}`);
  } finally {
    cleanupExtractedFiles();
  }
}

void run();
