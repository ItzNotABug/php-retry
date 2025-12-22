import "./test-helper";
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  findTestFileInWorkspace,
  extractFileFromContainer,
  cleanupExtractedFiles,
} from "../../src/utils/helpers";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("findTestFileInWorkspace", () => {
  const ws = "/tmp/test-ws";
  let originalWs: string | undefined;

  beforeEach(() => {
    originalWs = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = ws;
    if (fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (originalWs !== undefined) {
      process.env.GITHUB_WORKSPACE = originalWs;
    } else {
      delete process.env.GITHUB_WORKSPACE;
    }
    if (fs.existsSync(ws)) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  test("should find regular test file", () => {
    const file = path.join(ws, "tests/e2e/ProjectTest.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/usr/src/code/tests/e2e/ProjectTest.php",
      "tests/e2e"
    );

    expect(result).toBe(file);
  });

  test("should find vendor test with 'tests/' in path", () => {
    const file = path.join(
      ws,
      "vendor/company/pkg/tests/e2e/Services/UserTest.php"
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/app/vendor/company/pkg/tests/e2e/Services/UserTest.php",
      "vendor/company/pkg/tests/e2e"
    );

    expect(result).toBe(file);
  });

  test("should find vendor test with nested structure", () => {
    const file = path.join(ws, "vendor/sample/lib/tests/VendorTest.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/app/vendor/sample/lib/tests/VendorTest.php",
      "vendor/sample/lib/tests"
    );

    expect(result).toBe(file);
  });

  test("should prioritize test_dir over generic markers", () => {
    const file = path.join(ws, "vendor/co/pkg/tests/unit/SomeTest.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/app/vendor/co/pkg/tests/unit/SomeTest.php",
      "vendor/co/pkg/tests/unit"
    );

    expect(result).toBe(file);
  });

  test("should extract relative path correctly", () => {
    const file = path.join(ws, "tests/integration/DatabaseTest.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/workspace/tests/integration/DatabaseTest.php",
      "tests/integration"
    );

    expect(result).toBe(file);
  });

  test("should return null when file not found", () => {
    const result = findTestFileInWorkspace("/app/tests/Missing.php", "tests");
    expect(result).toBeNull();
  });

  test("should fall back to filename search", () => {
    const file = path.join(ws, "tests/deep/UniqueTest.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/different/path/UniqueTest.php",
      "tests"
    );

    expect(result).toBe(file);
  });

  test("should handle duplicate filenames", () => {
    const file1 = path.join(ws, "tests/unit/Same.php");
    const file2 = path.join(ws, "tests/integration/Same.php");

    fs.mkdirSync(path.dirname(file1), { recursive: true });
    fs.mkdirSync(path.dirname(file2), { recursive: true });
    fs.writeFileSync(file1, "<?php");
    fs.writeFileSync(file2, "<?php");

    const result = findTestFileInWorkspace("/app/Same.php", "tests");

    expect(result).not.toBeNull();
    expect([file1, file2]).toContain(result!);
  });

  test("should skip node_modules and .git", () => {
    const file = path.join(ws, "tests/node_modules/Test.php");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace("/app/tests/Test.php", "tests");

    expect(result).toBeNull();
  });

  test("should handle deeply nested vendor paths", () => {
    const file = path.join(
      ws,
      "vendor/org/pkg/tests/e2e/Services/AuthTest.php"
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "<?php");

    const result = findTestFileInWorkspace(
      "/app/vendor/org/pkg/tests/e2e/Services/AuthTest.php",
      "vendor/org/pkg/tests/e2e"
    );

    expect(result).toBe(file);
  });
});

describe("extractFileFromContainer", () => {
  test("should return null for invalid container", () => {
    const result = extractFileFromContainer(
      "/usr/src/code/tests/Test.php",
      "nonexistent-container",
      false
    );

    expect(result).toBeNull();
  });

  test("should return null when file doesn't exist in container", () => {
    const result = extractFileFromContainer(
      "/nonexistent/path/Test.php",
      "test-container",
      false
    );

    expect(result).toBeNull();
  });

  test("should prevent path traversal attacks", () => {
    const result = extractFileFromContainer(
      "/app/../../../etc/passwd",
      "test-container",
      false
    );

    expect(result).toBeNull();
  });

  test("should prevent path traversal with relative paths", () => {
    const result = extractFileFromContainer(
      "../../etc/passwd",
      "test-container",
      false
    );

    expect(result).toBeNull();
  });

  test("should prevent directory name prefix attacks", () => {
    const result = extractFileFromContainer(
      "/../phpunit-retry-wrong/invalid.php",
      "test-container",
      false
    );

    expect(result).toBeNull();
  });
});

describe("cleanupExtractedFiles", () => {
  test("should not throw when cleanup directory doesn't exist", () => {
    expect(() => cleanupExtractedFiles()).not.toThrow();
  });

  test("should clean up extraction directory", () => {
    const tmpDir = path.join(os.tmpdir(), "phpunit-retry-tests");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "test.php"), "<?php");

    cleanupExtractedFiles();

    expect(fs.existsSync(tmpDir)).toBe(false);
  });

  test("should clean up nested directory structure", () => {
    const tmpDir = path.join(os.tmpdir(), "phpunit-retry-tests");
    const nestedPath = path.join(tmpDir, "app/vendor/tests");
    fs.mkdirSync(nestedPath, { recursive: true });
    fs.writeFileSync(path.join(nestedPath, "Test.php"), "<?php");

    cleanupExtractedFiles();

    expect(fs.existsSync(tmpDir)).toBe(false);
  });
});
