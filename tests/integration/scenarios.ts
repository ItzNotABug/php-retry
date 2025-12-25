export type Scenario = {
  name: string;
  containerId: string;
  testPath?: string;
  testDir: string;
  maxAttempts: number;
  expectedAttempts: number;
  expectedSuccess: "true" | "false";
  expectedRetryTests: number;
  expectedPresent: string[];
  expectedAbsent: string[];
};

export type ScenarioResult = {
  name: string;
  retryCount: number;
  durationMs: number;
};

const testDirInput = "tests/integration/resources/phpunit-project/tests";

export const scenarios: Scenario[] = [
  {
    name: "Simple Dependencies",
    containerId: "simple",
    testPath: "tests/SampleTest.php",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 6,
    expectedPresent: [
      "testCreate",
      "testUpdate",
      "testRead",
      "testDelete",
      "testMultipleDeps",
      "testAnotherFailure",
    ],
    expectedAbsent: ["testIndependent"],
  },
  {
    name: "Complex Dependencies",
    containerId: "complex",
    testPath: "tests/ProjectTest.php",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 3,
    expectedPresent: [
      "testCreateProject",
      "testUpdateProject",
      "testDeleteProject",
    ],
    expectedAbsent: ["testProjectValidation", "testListProjects"],
  },
  {
    name: "Full Test Suite",
    containerId: "full",
    testDir: testDirInput,
    maxAttempts: 2,
    expectedAttempts: 2,
    expectedSuccess: "false",
    expectedRetryTests: 9,
    expectedPresent: [
      "testCreate",
      "testUpdate",
      "testRead",
      "testDelete",
      "testMultipleDeps",
      "testAnotherFailure",
      "testCreateProject",
      "testUpdateProject",
      "testDeleteProject",
    ],
    expectedAbsent: [
      "testIndependent",
      "testProjectValidation",
      "testListProjects",
    ],
  },
];
