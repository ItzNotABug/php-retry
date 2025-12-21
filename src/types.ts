export interface ActionInputs {
  command: string;
  maxAttempts: number;
  retryWaitSeconds: number;
  shell: string;
  timeoutMinutes: number;
  testDir: string;
}

export interface FailedTest {
  name: string; // Full name: "Tests\\E2E\\...::testFoo"
  class: string; // Class name: "ProjectsConsoleClientTest"
  method: string; // Method name: "testFoo"
  file: string; // Container path: "/usr/src/code/vendor/..."
  line?: number; // Line number
}
