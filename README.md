# PHPUnit Retry Action

> **Experimental - Internal use only**

Retry failed PHPUnit tests with their dependencies.

## Usage

```yaml
- uses: itznotabug/php-retry@v1
  with:
    command: vendor/bin/phpunit tests/
    test_dir: tests
    max_attempts: 3
    retry_wait_seconds: 10
```

**Docker:**

```yaml
- uses: itznotabug/php-retry@v1
  with:
    command: docker compose exec -T appwrite test /usr/src/code/tests/e2e
    test_dir: tests
```

## How It Works

1. Runs tests with `--log-junit`
2. On failure, parses JUnit XML and `@depends` annotations
3. Retries only failed tests + their dependencies using `--filter`

**Example:** If 3 tests fail out of 100, attempt 2 only runs those 3 + their dependencies instead of all 100.

## Inputs

| Input                | Required | Default | Description                                                       |
|----------------------|----------|---------|-------------------------------------------------------------------|
| `command`            | Yes      | -       | PHPUnit command to execute                                        |
| `test_dir`           | Yes      | -       | Test directory in workspace                                       |
| `max_attempts`       | No       | `3`     | Maximum retry attempts (1-10)                                     |
| `retry_wait_seconds` | No       | `10`    | Seconds to wait between retries                                   |
| `shell`              | No       | `bash`  | Shell to use: `bash`, `sh`, `pwsh`, `python`, `cmd`, `powershell` |
| `timeout_minutes`    | No       | `30`    | Timeout in minutes for each attempt (0 = no timeout)              |

## Outputs

| Output           | Description                       |
|------------------|-----------------------------------|
| `total_attempts` | Number of attempts made           |
| `exit_code`      | Final exit code                   |
| `failed_tests`   | JSON array of failed test names   |
| `success`        | Whether tests passed (true/false) |

## Notes

- Requires PHPUnit 9.x or later
- `test_dir` is the path in your **workspace**, not inside Docker container
- Works with `docker exec` and `docker compose exec`
- Platform compatibility is validated at runtime
