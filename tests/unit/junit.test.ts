import { describe, test, expect } from "bun:test";
import { JUnitParser } from "../../src/parsers/junit";
import * as path from "path";

describe("JUnitParser", () => {
  const parser = new JUnitParser();
  const fixturesDir = path.join(__dirname, "fixtures");

  test("should parse failed tests from JUnit XML", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures).toHaveLength(3); // 2 failures + 1 error (not skipped)
  });

  test("should extract test class names correctly", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures[0]?.class).toBe("ProjectsConsoleClientTest");
    expect(failures[1]?.class).toBe("ProjectsConsoleClientTest");
  });

  test("should extract test method names correctly", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    const methodNames = failures.map((f) => f.method);
    expect(methodNames).toContain("testListProjectsQuerySelect");
    expect(methodNames).toContain("testUpdateProjectSMTP");
    expect(methodNames).toContain("testValidateProjectKey");
  });

  test("should extract full test names", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures[0]?.name).toContain("::");
    expect(failures[0]?.name).toMatch(
      /Tests\\E2E\\Services\\Projects\\ProjectsConsoleClientTest::test/,
    );
  });

  test("should extract file paths", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures[0]?.file).toContain("/usr/src/code");
    expect(failures[0]?.file).toContain("ProjectsConsoleClientTest.php");
  });

  test("should extract line numbers", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures[0]?.line).toBeGreaterThan(0);
  });

  test("should not include skipped tests", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    const skippedTest = failures.find((f) => f.method === "testSkippedTest");
    expect(skippedTest).toBeUndefined();
  });

  test("should include both failures and errors", () => {
    const xmlPath = path.join(fixturesDir, "sample-junit.xml");
    const failures = parser.parseXMLFile(xmlPath);

    // Should have testListProjectsQuerySelect (failure), testUpdateProjectSMTP (failure), testValidateProjectKey (error)
    expect(failures).toHaveLength(3);
  });

  test("should parse XML with <testsuite> root (not <testsuites>)", () => {
    const xmlPath = path.join(fixturesDir, "testsuite-root.xml");
    const failures = parser.parseXMLFile(xmlPath);

    // Should parse 2 failures from testsuite-root.xml
    expect(failures).toHaveLength(2);
    expect(failures[0]?.method).toBe("testRegister");
    expect(failures[1]?.method).toBe("testLogout");
  });

  test("should extract correct data from <testsuite> root XML", () => {
    const xmlPath = path.join(fixturesDir, "testsuite-root.xml");
    const failures = parser.parseXMLFile(xmlPath);

    expect(failures[0]?.class).toBe("AuthTest");
    expect(failures[0]?.file).toContain("AuthTest.php");
    expect(failures[0]?.line).toBe(78);
    expect(failures[0]?.name).toContain("::");
  });
});
