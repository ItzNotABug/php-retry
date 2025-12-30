export interface ActionInputs {
  command: string;
  maxAttempts: number;
  retryWaitSeconds: number;
  shell: string;
  timeoutMinutes: number;
  testDir: string;
  githubToken?: string;
  jobId?: string;
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
  class: string; // Test class name (e.g., "ProjectsConsoleClientTest")
  method: string; // Test method name (e.g., "testFoo")
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
  runUrl?: string; // Workflow run URL
}

/**
 * Test results for a specific commit
 */
export interface CommitData {
  jobs: Record<string, JobTestResult>; // key: jobId (workflow#job)
  timestamp: string;
}

/**
 * Complete comment data structure
 */
export interface CommentData {
  commits: Record<string, CommitData>; // key: commit SHA
  repo?: string; // owner/repo for generating commit links
}
