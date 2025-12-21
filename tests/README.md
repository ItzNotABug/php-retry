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
End-to-end test using GitHub Actions locally:
- **test-integration.ts** - Runs the full action via `act` (requires Docker)
  - Uses `.github/workflows/test.yml` workflow (test-action job)
  - Tests complete retry flow with real PHPUnit runs
  - Validates JUnit parsing, dependency resolution, and retry logic

Run: `bun test:integration` (requires `act` CLI tool)

## Running Tests

```bash
# Unit tests (fast)
bun test

# Integration test (slower, requires Docker and act CLI)
bun test:integration

# Install act (if not already installed)
brew install act
```
