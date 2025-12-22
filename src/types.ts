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

export interface TestCase {
  '@_class'?: string;
  '@_name'?: string;
  '@_file'?: string;
  '@_line'?: string;
  failure?: unknown;
  error?: unknown;
}

export interface TestSuite {
  '@_tests'?: string;
  '@_failures'?: string;
  '@_assertions'?: string;
  testsuite?: TestSuite | TestSuite[];
  testcase?: TestCase | TestCase[];
}

export interface TestSuites {
  '@_tests'?: string;
  '@_failures'?: string;
  '@_assertions'?: string;
  testsuite?: TestSuite | TestSuite[];
}

export interface JUnitXML {
  testsuites?: TestSuites;
  testsuite?: TestSuite;
}
