export interface ActionInputs {
  command: string;
  maxAttempts: number;
  retryWaitSeconds: number;
  shell: string;
  timeoutMinutes: number;
  testDir: string;
}

export interface FailedTest {
  name: string; // "Tests\\E2E\\...::testFoo"
  class: string; // "ProjectsConsoleClientTest"
  method: string; // "testFoo"
  file: string; // "/usr/src/code/vendor/..."
  line?: number;
}
