# PHP-Retry Action

Intelligently retries failed PHPUnit tests with their dependencies instead of running the full test suite.

**Please note that this action is not a drop-in replacement for standard PHPUnit retries.**  
**Originally designed for Appwrite Cloud's internal test infrastructure and may require minor adjustments for other setups.**

## Usage

```yaml
- uses: itznotabug/php-retry@v1
  with:
    command: vendor/bin/phpunit tests/
    test_dir: tests
```

**With Docker:**

```yaml
- uses: itznotabug/php-retry@v1
  with:
    command: docker compose exec -T appwrite test /usr/src/code/tests/e2e
    test_dir: vendor/appwrite/server-ce/tests/e2e
```

## How It Works

1. Runs your PHPUnit command with `--log-junit`
2. On failure, parses JUnit XML to identify failed tests
3. Analyzes `@depends` annotations to build dependency graph
4. Retries only failed tests + dependencies using `--filter`

**Example:** If 3 out of 100 tests fail, retry attempts run only those 3 + their dependencies instead of all 100.

## Inputs

| Input                | Required | Default | Description                                                |
|----------------------|----------|---------|------------------------------------------------------------|
| `command`            | Yes      | -       | PHPUnit command to execute                                 |
| `test_dir`           | Yes      | -       | Test directory in workspace                                |
| `max_attempts`       | No       | `3`     | Maximum retry attempts (1-10)                              |
| `retry_wait_seconds` | No       | `10`    | Seconds to wait between retries                            |
| `shell`              | No       | `bash`  | Shell: `bash`, `sh`, `pwsh`, `python`, `cmd`, `powershell` |
| `timeout_minutes`    | No       | `30`    | Timeout per attempt (0 = no timeout)                       |

## Notes

- **Requires PHPUnit 9.x or later**
- `test_dir` must be workspace path, not container path
- Works with vendor test paths (e.g., `vendor/company/pkg/tests/`)
