import { describe, test, expect } from "bun:test";
import { DependencyResolver } from "../../src/parsers/dependency";
import * as path from "path";

describe("DependencyResolver", () => {
  const fixturesDir = path.join(__dirname, "fixtures");

  test("should parse @depends annotations from PHP file", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testDelete",
        class: "SampleTest",
        method: "testDelete",
        file: testFile,
      },
    ]);

    // testDelete depends on testUpdate, which depends on testCreate
    // So filter should include all three with full class names
    expect(filter).toContain("SampleTest::testDelete");
    expect(filter).toContain("SampleTest::testUpdate");
    expect(filter).toContain("SampleTest::testCreate");
  });

  test("should handle tests without dependencies", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testIndependent",
        class: "SampleTest",
        method: "testIndependent",
        file: testFile,
      },
    ]);

    // Should only include the test itself, no dependencies
    expect(filter).toContain("SampleTest::testIndependent");
  });

  test("should resolve multiple dependencies", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testMultipleDeps",
        class: "SampleTest",
        method: "testMultipleDeps",
        file: testFile,
      },
    ]);

    // testMultipleDeps depends on testCreate and testRead
    expect(filter).toContain("SampleTest::testMultipleDeps");
    expect(filter).toContain("SampleTest::testCreate");
    expect(filter).toContain("SampleTest::testRead");
  });

  test("should handle multiple failed tests", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testDelete",
        class: "SampleTest",
        method: "testDelete",
        file: testFile,
      },
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testRead",
        class: "SampleTest",
        method: "testRead",
        file: testFile,
      },
    ]);

    // Union of both dependency chains
    const tests = filter.split("|");
    expect(tests.some((t) => t.includes("SampleTest::testDelete"))).toBe(true);
    expect(tests.some((t) => t.includes("SampleTest::testUpdate"))).toBe(true);
    expect(tests.some((t) => t.includes("SampleTest::testCreate"))).toBe(true);
    expect(tests.some((t) => t.includes("SampleTest::testRead"))).toBe(true);
  });

  test("should not duplicate tests in filter", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testUpdate",
        class: "SampleTest",
        method: "testUpdate",
        file: testFile,
      },
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testDelete",
        class: "SampleTest",
        method: "testDelete",
        file: testFile,
      },
    ]);

    // Both depend on testCreate, should only appear once
    const tests = filter.split("|");
    const createCount = tests.filter((t) => t.includes("SampleTest::testCreate"))
      .length;
    expect(createCount).toBe(1);
  });

  test("should build pipe-separated filter pattern", () => {
    const resolver = new DependencyResolver();
    const testFile = path.join(fixturesDir, "sample-test.php");

    resolver.parseTestFile(testFile);

    const filter = resolver.buildFilterPattern([
      {
        name: "Tests\\E2E\\Services\\Sample\\SampleTest::testDelete",
        class: "SampleTest",
        method: "testDelete",
        file: testFile,
      },
    ]);

    // Should be pipe-separated for PHPUnit --filter with full class names
    expect(filter).toMatch(/SampleTest::test\w+\|.*SampleTest::test\w+/);
    expect(filter.split("|").length).toBeGreaterThan(1);
  });
});
