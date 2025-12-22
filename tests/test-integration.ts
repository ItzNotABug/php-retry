import { $ } from "bun";

async function runIntegrationTests() {
  try {
    await $`command -v act`.quiet();
  } catch {
    console.error("Error: act not installed");
    console.error("Install with: brew install act");
    process.exit(1);
  }

  console.log("Running integration test with act (matrix workflow)...\n");

  try {
    // Run both jobs and combine output
    const result1 =
      await $`act -j test-action -W .github/workflows/test-local.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-architecture linux/amd64`.nothrow();

    const result2 =
      await $`act -j test-action-with-env -W .github/workflows/test-local.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-architecture linux/amd64`.nothrow();

    const output = result1.text() + "\n" + result2.text();

    // Verify expected behavior across all matrix jobs
    const checks = [
      {
        pattern: /scenario:Simple Dependencies/,
        name: "Simple Dependencies matrix job runs",
      },
      {
        pattern: /scenario:Complex Dependencies/,
        name: "Complex Dependencies matrix job runs",
      },
      {
        pattern: /scenario:Vendor Path Tests/,
        name: "Vendor Path Tests matrix job runs",
      },
      {
        pattern: /scenario:Full Test Suite/,
        name: "Full Test Suite matrix job runs",
      },
      {
        pattern: /Test Action with Environment Variables/,
        name: "Environment variables job runs",
      },
      {
        pattern: /Test action with env vars and vendor path/,
        name: "Environment variables with vendor path runs",
      },
      {
        pattern: /Attempt 1/,
        name: "First attempt runs",
      },
      {
        pattern: /phpunit-retry-simple|phpunit-retry-complex|phpunit-retry-vendor|phpunit-retry-full|phpunit-retry-env/,
        name: "Docker containers are created",
      },
      {
        pattern: /SampleTest|ProjectTest|VendorTest/,
        name: "Tests are executed (including vendor paths)",
      },
      {
        pattern: /Dependency analysis:/,
        name: "Action shows test execution status",
      },
      {
        pattern: /Retrying.*failed test/,
        name: "Action retries failed tests",
      },
    ];

    let passed = 0;
    let failed = 0;

    console.log("Verification:\n");
    for (const check of checks) {
      if (check.pattern.test(output)) {
        console.log(`✅ ${check.name}`);
        passed++;
      } else {
        console.log(`❌ ${check.name}`);
        failed++;
      }
    }

    console.log(`\nResults: ${passed}/${checks.length} checks passed\n`);

    if (failed > 0) {
      console.error("Integration test failed");
      process.exit(1);
    }

    console.log("Integration test passed");
  } catch (error) {
    console.error("Integration test failed");
    if (error instanceof Error) {
      console.error(error.message);
    }
    process.exit(1);
  }
}

void runIntegrationTests();
