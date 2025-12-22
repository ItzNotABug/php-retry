import { describe, test, expect } from "bun:test";
import { CommandBuilder } from "../../src/builders/command";

describe("CommandBuilder", () => {
  const builder = new CommandBuilder();

  describe("addJUnitLogging", () => {
    test("should add --log-junit flag to local command", () => {
      const command = "vendor/bin/phpunit tests/";
      const localPath = "/workspace/phpunit-junit.xml";
      const result = builder.addJUnitLogging(command, localPath);

      expect(result).toContain("--log-junit");
      expect(result).toContain(localPath);
    });

    test("should work with Docker commands", () => {
      const command =
        "docker compose exec -T appwrite test /usr/src/code/tests/e2e";
      const localPath = "/workspace/phpunit-junit.xml";
      const result = builder.addJUnitLogging(command, localPath);

      expect(result).toContain("--log-junit");
      expect(result).toContain("/tmp/phpunit-junit.xml");
      expect(result).not.toContain(localPath);
    });

    test("should preserve original command", () => {
      const command = "vendor/bin/phpunit tests/ --debug";
      const localPath = "/workspace/phpunit-junit.xml";
      const result = builder.addJUnitLogging(command, localPath);

      expect(result).toContain("vendor/bin/phpunit tests/ --debug");
    });
  });

  describe("addFilter", () => {
    test("should add --filter flag with pattern", () => {
      const command = "vendor/bin/phpunit tests/";
      const filter = "testCreate|testUpdate|testDelete";
      const result = builder.addFilter(command, filter);

      expect(result).toContain("--filter");
      expect(result).toContain("testCreate|testUpdate|testDelete");
    });

    test("should escape quotes in filter pattern", () => {
      const command = "vendor/bin/phpunit tests/";
      const filter = 'test"With"Quotes';
      const result = builder.addFilter(command, filter);

      // Should escape the quotes
      expect(result).toContain('\\"');
    });

    test("should work with Docker commands", () => {
      const command =
        "docker compose exec -T appwrite test /usr/src/code/tests/e2e";
      const filter = "testCreate|testUpdate";
      const result = builder.addFilter(command, filter);

      expect(result).toContain("--filter");
      expect(result).toContain("testCreate|testUpdate");
    });
  });

  describe("extractContainerName", () => {
    test("should extract from docker exec command", () => {
      const command = "docker exec rfa-test-container vendor/bin/phpunit";
      const result = builder.extractContainerName(command);

      expect(result).toBe("rfa-test-container");
    });

    test("should extract from docker exec with flags", () => {
      const command = "docker exec -T mycontainer vendor/bin/phpunit";
      const result = builder.extractContainerName(command);

      expect(result).toBe("mycontainer");
    });

    test("should extract from docker exec with flags that have arguments", () => {
      const command = "docker exec -u root mycontainer vendor/bin/phpunit";
      const result = builder.extractContainerName(command);

      expect(result).toBe("mycontainer");
    });

    test("should extract from docker compose exec", () => {
      const command =
        "docker compose exec -T appwrite test /usr/src/code/tests/e2e";
      const result = builder.extractContainerName(command);

      expect(result).toBe("appwrite");
    });

    test("should extract from docker-compose exec (legacy)", () => {
      const command =
        "docker-compose exec -T appwrite test /usr/src/code/tests/e2e";
      const result = builder.extractContainerName(command);

      expect(result).toBe("appwrite");
    });

    test("should return null for non-docker commands", () => {
      const command = "vendor/bin/phpunit tests/";
      const result = builder.extractContainerName(command);

      expect(result).toBeNull();
    });

    test("should extract from command with single environment variable", () => {
      const command =
        "_APP_VAR=value docker compose exec -T appwrite test /usr/src/code/tests";
      const result = builder.extractContainerName(command);

      expect(result).toBe("appwrite");
    });

    test("should extract from command with multiple environment variables", () => {
      const command =
        "_APP_DATABASE_SHARED_TABLES=db1 _APP_DATABASE_SHARED_TABLES_V1=db2 docker compose exec -T appwrite ce-test /usr/src/code/tests";
      const result = builder.extractContainerName(command);

      expect(result).toBe("appwrite");
    });

    test("should extract from docker exec with environment variables", () => {
      const command =
        "_DATABASE_CONFIG=shared_tables docker exec my-container vendor/bin/phpunit tests/";
      const result = builder.extractContainerName(command);

      expect(result).toBe("my-container");
    });

    test("should extract from docker-compose exec with environment variables", () => {
      const command =
        "_APP_VAR=value docker-compose exec -T appwrite test /usr/src/code/tests";
      const result = builder.extractContainerName(command);

      expect(result).toBe("appwrite");
    });
  });

  describe("buildExtractCommand", () => {
    test("should create docker compose cp command for compose exec", () => {
      const command =
        "docker compose exec -T appwrite test /usr/src/code/tests/e2e";
      const result = builder.buildExtractCommand(command, "./phpunit-junit.xml");

      expect(result).toContain("docker compose cp");
      expect(result).toContain("appwrite:");
      expect(result).toContain("/tmp/phpunit-junit.xml");
      expect(result).toContain("./phpunit-junit.xml");
    });

    test("should create docker cp command for docker exec", () => {
      const command = "docker exec rfa-test-container vendor/bin/phpunit";
      const result = builder.buildExtractCommand(command, "./test.xml");

      expect(result).toContain("docker cp");
      expect(result).not.toContain("docker compose");
      expect(result).toContain("rfa-test-container:");
      expect(result).toContain("./test.xml");
    });

    test("should return null for non-docker commands", () => {
      const command = "vendor/bin/phpunit tests/";
      const result = builder.buildExtractCommand(command, "./test.xml");

      expect(result).toBeNull();
    });
  });
});
