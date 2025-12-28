export interface ActionInputs {
  command: string;
  maxAttempts: number;
  retryWaitSeconds: number;
  shell: string;
  timeoutMinutes: number;
  testDir: string;
  githubToken?: string;
}

export interface FailedTest {
  name: string; // "Tests\\E2E\\...::testFoo"
  class: string; // "ProjectsConsoleClientTest"
  method: string; // "testFoo"
  file: string; // "/usr/src/code/vendor/..."
  line?: number;
  error?: string; // Error message from JUnit XML
  time?: number; // Execution time in seconds from JUnit XML
}

export interface TestCase {
  '@_class'?: string;
  '@_name'?: string;
  '@_file'?: string;
  '@_line'?: string;
  '@_time'?: string;
  failure?: unknown;
  error?: unknown;
}

export interface TestSuite {
  '@_tests'?: string;
  '@_failures'?: string;
  '@_errors'?: string;
  '@_assertions'?: string;
  testsuite?: TestSuite | TestSuite[];
  testcase?: TestCase | TestCase[];
}

export interface TestSuites {
  '@_tests'?: string;
  '@_failures'?: string;
  '@_errors'?: string;
  '@_assertions'?: string;
  testsuite?: TestSuite | TestSuite[];
}

export interface JUnitXML {
  testsuites?: TestSuites;
  testsuite?: TestSuite;
}

export interface AttemptStat {
  attempt: number;
  failed: number;
  retried: number;
}

export interface FirstAttemptStats {
  total: number;
  failures: number;
  assertions: number;
}

export interface FlakyTest {
  name: string;
  attempts: number; // Which attempt it passed on
  time: number; // Cumulative time in seconds across all attempts
}

/**
 * Single job's test results
 */
export interface JobTestResult {
  jobName: string;
  workflowName: string;
  attempt: number;
  maxAttempts: number;
  status: 'passed' | 'failed';
  failedTests: Array<{
    name: string;
    attempts: number;
    error?: string;
  }>;
  flakyTests: FlakyTest[];
  retriedCount: number;
}

/**
 * Complete comment data structure
 */
export interface CommentData {
  jobs: Record<string, JobTestResult>; // key: jobId (workflow#job#pr)
  lastUpdated: string;
  runId?: string; // GitHub run ID to track CI run and prevent mixing old/new data
}
