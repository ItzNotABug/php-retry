# Tests

## Structure

### Unit Tests (`/tests/unit/`)
Fast, isolated tests for individual components:
- **junit.test.ts** - JUnit XML parser tests
- **dependency.test.ts** - PHP @depends resolver tests
- **command.test.ts** - PHPUnit command builder tests
- **fixtures/** - Static test data (sample XML, PHP files)

Run: `bun test tests/unit/`

### Integration Tests
End-to-end test using the action bundle and Docker:
- **integration/index.ts** - Runs the action against a Dockerized PHPUnit project
  - Uses `tests/integration/phpunit-project/docker-compose.yml`
  - Tests complete retry flow with real PHPUnit runs
  - Validates JUnit parsing, dependency resolution, and retry logic

Run: `bun test:integration` (requires Docker and Docker Compose)

## Running Tests

```bash
# Unit tests (fast)
bun test

# Integration test (slower, requires Docker and Docker Compose)
bun test:integration
```
