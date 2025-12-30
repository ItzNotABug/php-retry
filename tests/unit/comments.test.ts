import '../mocks';
import { describe, expect, test } from 'bun:test';
import type { CommentData, CommitData, JobTestResult } from '../../src/types';
import {
  COMMENT_MESSAGES,
  formatCommentBody,
  getCommentMarker,
  getJobId,
  mergeCommitData,
  parseCommentData,
} from '../../src/utils/comments';

describe('getCommentMarker', () => {
  test('should generate marker with PR number and branch', () => {
    const marker = getCommentMarker(123, 'feature/test');
    expect(marker).toBe('<!-- 123#feature/test#php-retry -->');
  });

  test('should generate marker with PR number only', () => {
    const marker = getCommentMarker(456, undefined);
    expect(marker).toBe('<!-- 456#php-retry -->');
  });

  test('should generate marker with branch only', () => {
    const marker = getCommentMarker(undefined, 'main');
    expect(marker).toBe('<!-- main#php-retry -->');
  });

  test('should generate marker with neither', () => {
    const marker = getCommentMarker(undefined, undefined);
    expect(marker).toBe('<!-- php-retry -->');
  });
});

describe('getJobId', () => {
  test('should generate job ID with all parameters', () => {
    const jobId = getJobId('tests-appwrite.yml', 'E2E Test (Account)', 123);
    expect(jobId).toBe('tests-appwrite.yml#E2E Test (Account)#123');
  });

  test('should generate job ID without PR number', () => {
    const jobId = getJobId('tests-cloud.yml', 'Unit Test', undefined);
    expect(jobId).toBe('tests-cloud.yml#Unit Test');
  });
});

describe('parseCommentData', () => {
  test('should parse valid comment data', () => {
    const jsonData = JSON.stringify({
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'job',
              workflowName: 'workflow',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [],
              retriedCount: 0,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    });
    const base64Data = Buffer.from(jsonData).toString('base64');
    const commentBody = `<!-- 123#main#php-retry -->
<!-- data:${base64Data} -->
## Test Summary`;

    const data = parseCommentData(commentBody);
    expect(data).not.toBeNull();
    expect(data?.commits).toBeDefined();
    expect(data?.commits['abc1234']?.timestamp).toBe(
      '2025-12-28T10:00:00.000Z',
    );
  });

  test('should return null for comment without data', () => {
    const commentBody = '## Test Summary\nNo data here';
    const data = parseCommentData(commentBody);
    expect(data).toBeNull();
  });

  test('should return null for invalid JSON', () => {
    const commentBody = '<!-- data:invalid json -->';
    const data = parseCommentData(commentBody);
    expect(data).toBeNull();
  });
});

describe('mergeCommitData', () => {
  test('should create new data when existingData is null', () => {
    const jobResult: JobTestResult = {
      jobName: 'E2E Test (Account)',
      workflowName: 'tests-appwrite.yml',
      attempt: 1,
      maxAttempts: 3,
      status: 'passed',
      failedTests: [],
      flakyTests: [],
      retriedCount: 2,
    };

    const merged = mergeCommitData(
      null,
      'abc1234',
      'workflow#job#123',
      jobResult,
      'test-repo',
    );

    expect(merged.commits['abc1234']!.jobs['workflow#job#123']).toEqual(
      jobResult,
    );
    expect(merged.commits['abc1234']!.timestamp).toBeDefined();
    expect(merged.repo).toBe('test-repo');
  });

  test('should merge new job result with existing data', () => {
    const existingData: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow1#job1#123': {
              jobName: 'Job 1',
              workflowName: 'workflow1',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [],
              retriedCount: 0,
            },
          },
          timestamp: '2025-12-28T09:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const jobResult: JobTestResult = {
      jobName: 'Job 2',
      workflowName: 'workflow2',
      attempt: 2,
      maxAttempts: 3,
      status: 'failed',
      failedTests: [
        {
          name: 'TestClass::testMethod',
          attempts: 2,
          error: 'Assertion failed',
        },
      ],
      flakyTests: [],
      retriedCount: 1,
    };

    const merged = mergeCommitData(
      existingData,
      'abc1234',
      'workflow2#job2#123',
      jobResult,
      'test-repo',
    );

    expect(Object.keys(merged.commits['abc1234']!.jobs)).toHaveLength(2);
    expect(merged.commits['abc1234']!.jobs['workflow1#job1#123']).toEqual(
      existingData.commits['abc1234']!.jobs['workflow1#job1#123'],
    );
    expect(merged.commits['abc1234']!.jobs['workflow2#job2#123']).toEqual(
      jobResult,
    );
    expect(
      new Date(merged.commits['abc1234']!.timestamp).getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(existingData.commits['abc1234']!.timestamp).getTime(),
    );
  });

  test('should update existing job result', () => {
    const existingData: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Job',
              workflowName: 'workflow',
              attempt: 1,
              maxAttempts: 3,
              status: 'failed',
              failedTests: [{ name: 'Test1', attempts: 1 }],
              flakyTests: [],
              retriedCount: 0,
            },
          },
          timestamp: '2025-12-28T09:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const updatedResult: JobTestResult = {
      jobName: 'Job',
      workflowName: 'workflow',
      attempt: 2,
      maxAttempts: 3,
      status: 'passed',
      failedTests: [],
      flakyTests: [],
      retriedCount: 1,
    };

    const merged = mergeCommitData(
      existingData,
      'abc1234',
      'workflow#job#123',
      updatedResult,
      'test-repo',
    );

    expect(Object.keys(merged.commits['abc1234']!.jobs)).toHaveLength(1);
    expect(merged.commits['abc1234']!.jobs['workflow#job#123']).toEqual(
      updatedResult,
    );
  });
});

describe('formatCommentBody', () => {
  test('should not be called when no flaky tests', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'E2E Test',
              workflowName: 'tests-appwrite.yml',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [],
              retriedCount: 2,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const marker = '<!-- 123#main#php-retry -->';

    // Should throw error when called with no flaky tests
    expect(() => formatCommentBody(data, marker)).toThrow(
      'formatCommentBody called with no flaky tests',
    );
  });

  test('should format table with flaky tests', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'E2E Test (Functions)',
              workflowName: 'tests-appwrite.yml',
              attempt: 3,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [
                {
                  name: 'FunctionsTest::testCreate',
                  class: 'FunctionsTest',
                  method: 'testCreate',
                  attempts: 2,
                  time: 4.1,
                },
                {
                  name: 'FunctionsTest::testUpdate',
                  class: 'FunctionsTest',
                  method: 'testUpdate',
                  attempts: 3,
                  time: 2.5,
                },
              ],
              retriedCount: 5,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const marker = '<!-- 123#main#php-retry -->';
    const body = formatCommentBody(data, marker);

    expect(body).toContain(marker);
    expect(body).toContain('Flaky tests detected');
    expect(body).toContain('FunctionsTest::testCreate');
    expect(body).toContain('FunctionsTest::testUpdate');
    expect(body).toContain('4.10s'); // Cumulative time
    expect(body).toContain('2.50s');
  });

  test('should format multiple workflows with flaky tests', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'tests-appwrite.yml#job1#123': {
              jobName: 'E2E Test (Account)',
              workflowName: 'tests-appwrite.yml',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [],
              retriedCount: 2,
            },
            'tests-cloud.yml#job2#123': {
              jobName: 'E2E Test (Backups)',
              workflowName: 'tests-cloud.yml',
              attempt: 2,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [
                {
                  name: 'BackupTest::testRestore',
                  class: 'BackupTest',
                  method: 'testRestore',
                  attempts: 2,
                  time: 3.2,
                },
              ],
              retriedCount: 1,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const marker = '<!-- 123#main#php-retry -->';
    const body = formatCommentBody(data, marker);

    expect(body).toContain('Flaky tests detected');
    expect(body).toContain('BackupTest::testRestore');
    expect(body).toContain('3.20s');
  });

  test('should include base64-encoded data in comment', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Job',
              workflowName: 'workflow.yml',
              attempt: 2,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [
                {
                  name: 'Test',
                  class: 'Test',
                  method: 'test',
                  attempts: 2,
                  time: 1.5,
                },
              ],
              retriedCount: 1,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const marker = '<!-- marker -->';
    const body = formatCommentBody(data, marker);

    expect(body).toContain('<!-- data:');
    // Verify it's base64 encoded (not plain JSON)
    expect(body).not.toContain(JSON.stringify(data));
    // Verify we can parse it back
    const parsed = parseCommentData(body);
    expect(parsed).toEqual(data);
  });

  test('should preserve full data in base64 encoding', () => {
    const longError = 'A'.repeat(200);
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Job',
              workflowName: 'workflow.yml',
              attempt: 2,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [
                {
                  name: 'Test',
                  attempts: 1,
                  error: longError,
                },
              ],
              flakyTests: [
                {
                  name: 'Test',
                  class: 'Test',
                  method: 'test',
                  attempts: 2,
                  time: 2.3,
                },
              ],
              retriedCount: 1,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const marker = '<!-- marker -->';
    const body = formatCommentBody(data, marker);

    // Comment shows flaky test
    expect(body).toContain('Flaky tests detected');
    // The full data (including long error) is preserved in the base64-encoded data
    const parsed = parseCommentData(body);
    expect(
      parsed?.commits['abc1234']?.jobs['workflow#job#123']?.failedTests[0]
        ?.error,
    ).toBe(longError);
  });
});

describe('COMMENT_MESSAGES', () => {
  test('should have correct header', () => {
    expect(COMMENT_MESSAGES.header()).toBe('## 🔄 PHP-Retry Summary');
  });
});

describe('Comment size limits', () => {
  test('should truncate display when table rows exceed size limit', () => {
    const marker = '<!-- marker -->';

    // Create enough tests with very long names to trigger truncation
    // Using 150 tests with extremely long names to ensure truncation occurs
    const flakyTests = [];
    for (let i = 0; i < 150; i++) {
      flakyTests.push({
        name: `VeryLongTestNameThatTakesUpSpaceAndKeepsGoingWithMoreTextToMakeItEvenLonger::testMethod${i}WithAnExtremeLongNameToMakeThisLargerAndLargerAndEvenMoreCharactersToEnsureWeHitTheSizeLimit`,
        class:
          'VeryLongTestNameThatTakesUpSpaceAndKeepsGoingWithMoreTextToMakeItEvenLonger',
        method: `testMethod${i}WithAnExtremeLongNameToMakeThisLargerAndLargerAndEvenMoreCharactersToEnsureWeHitTheSizeLimit`,
        attempts: 3,
        time: 5.5,
      });
    }

    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Test Job',
              workflowName: 'test-workflow.yml',
              attempt: 3,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests,
              retriedCount: 50,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const body = formatCommentBody(data, marker);

    // Should stay under GitHub's limit
    const bodySize = Buffer.byteLength(body, 'utf-8');
    expect(bodySize).toBeLessThan(65000);

    // Verify the encoded data structure
    const dataMatch = body.match(/<!-- data:([^<>]+?) -->/);
    expect(dataMatch).toBeTruthy();
    if (dataMatch) {
      const base64Data = dataMatch[1]!.trim();
      const jsonStr = Buffer.from(base64Data, 'base64').toString('utf-8');
      const parsed = JSON.parse(jsonStr);

      // Either Strategy 1/2 succeeded (has commits and tests)
      // OR Strategy 3 was used (null data, error message)
      if (body.includes('Unable to display test results')) {
        // Strategy 3: Encoded null
        expect(parsed).toBeNull();
      } else {
        // Strategy 1/2: Has commits with tests
        expect(parsed).not.toBeNull();
        const commitKeys = Object.keys(parsed.commits);
        const encodedTestCount = (
          Object.values(parsed.commits) as CommitData[]
        ).reduce(
          (sum: number, commit: CommitData) =>
            sum +
            (Object.values(commit.jobs) as JobTestResult[]).reduce(
              (jobSum: number, job: JobTestResult) =>
                jobSum + job.flakyTests.length,
              0,
            ),
          0,
        );

        expect(commitKeys.length).toBeGreaterThan(0);
        expect(encodedTestCount).toBeGreaterThan(0);
        expect(encodedTestCount).toBeLessThanOrEqual(150);

        // If truncation occurred, verify the truncation message
        if (body.includes('Comment truncated')) {
          expect(body).toContain(
            'more flaky test(s) not shown due to size limits',
          );
        }
      }
    }
  });

  test('should not truncate small comments', () => {
    const marker = '<!-- marker -->';

    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Test Job',
              workflowName: 'test-workflow.yml',
              attempt: 2,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [
                {
                  name: 'Test1',
                  class: 'Test1',
                  method: 'test',
                  attempts: 2,
                  time: 1.5,
                },
                {
                  name: 'Test2',
                  class: 'Test2',
                  method: 'test',
                  attempts: 2,
                  time: 2.5,
                },
              ],
              retriedCount: 2,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const body = formatCommentBody(data, marker);

    // Should not contain truncation notice
    expect(body).not.toContain('Comment truncated');
  });
});

describe('Input validation', () => {
  test('should throw error for empty marker', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Test Job',
              workflowName: 'test-workflow.yml',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [
                {
                  name: 'Test1',
                  class: 'Test1',
                  method: 'test',
                  attempts: 1,
                  time: 1.0,
                },
              ],
              retriedCount: 0,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    expect(() => formatCommentBody(data, '')).toThrow('marker cannot be empty');
    expect(() => formatCommentBody(data, '   ')).toThrow(
      'marker cannot be empty',
    );
  });

  test('should throw error for missing commits data', () => {
    const invalidData = {
      commits: null,
      repo: 'test-repo',
    } as unknown as CommentData;
    const marker = '<!-- marker -->';

    expect(() => formatCommentBody(invalidData, marker)).toThrow(
      'data.commits is required',
    );
  });

  test('should throw error for no commits', () => {
    const data: CommentData = {
      commits: {},
      repo: 'test-repo',
    };
    const marker = '<!-- marker -->';

    expect(() => formatCommentBody(data, marker)).toThrow(
      'formatCommentBody called with no commits',
    );
  });

  test('should throw error for no flaky tests', () => {
    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Test Job',
              workflowName: 'test-workflow.yml',
              attempt: 1,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests: [],
              retriedCount: 0,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };
    const marker = '<!-- marker -->';

    expect(() => formatCommentBody(data, marker)).toThrow(
      'formatCommentBody called with no flaky tests',
    );
  });
});

describe('Strategy 3 fallback', () => {
  test('should use minimal data when all strategies fail', () => {
    const marker = '<!-- marker -->';

    // Create an unrealistically large dataset that would exceed all limits
    // This simulates Strategy 3 being triggered
    const flakyTests = [];
    const testName = 'X'.repeat(500); // Very long test name
    for (let i = 0; i < 500; i++) {
      flakyTests.push({
        name: `${testName}::testMethod${i}`,
        class: testName,
        method: `testMethod${i}`,
        attempts: 3,
        time: 5.5,
      });
    }

    const data: CommentData = {
      commits: {
        abc1234: {
          jobs: {
            'workflow#job#123': {
              jobName: 'Test Job',
              workflowName: 'test-workflow.yml',
              attempt: 3,
              maxAttempts: 3,
              status: 'passed',
              failedTests: [],
              flakyTests,
              retriedCount: 250,
            },
          },
          timestamp: '2025-12-28T10:00:00.000Z',
        },
      },
      repo: 'test-repo',
    };

    const body = formatCommentBody(data, marker);

    expect(body).toContain('Unable to display test results');
    expect(body).toContain('exceeds GitHub');

    const bodySize = Buffer.byteLength(body, 'utf-8');
    expect(bodySize).toBeLessThan(65000);

    const dataMatch = body.match(/<!-- data:([^<>]+?) -->/);
    expect(dataMatch).toBeTruthy();
    if (dataMatch) {
      const base64Data = dataMatch[1]!.trim();
      const jsonStr = Buffer.from(base64Data, 'base64').toString('utf-8');
      const parsed = JSON.parse(jsonStr);

      expect(parsed).toBeNull();
    }
  });
});

describe('Comment workflow scenarios', () => {
  describe('End-to-end workflow simulation', () => {
    test('should handle complete matrix build lifecycle', () => {
      // Simulate a matrix build with multiple jobs
      const prNumber = 123;
      const branch = 'feature/test-retry';
      const marker = getCommentMarker(prNumber, branch);
      const commitSha = 'abc1234';

      // Job 1 has flaky tests
      const job1: JobTestResult = {
        jobName: 'E2E Test (Account)',
        workflowName: 'tests-appwrite.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          {
            name: 'AccountTest::testLogin',
            class: 'AccountTest',
            method: 'testLogin',
            attempts: 2,
            time: 1.2,
          },
        ],
        retriedCount: 2,
      };

      const jobId1 = getJobId(job1.workflowName, job1.jobName, prNumber);
      let data = mergeCommitData(null, commitSha, jobId1, job1, 'test-repo');
      let body = formatCommentBody(data, marker);

      // Shows flaky test from job1
      expect(body).toContain('Flaky tests detected');
      expect(body).toContain('AccountTest::testLogin');

      // Job 2 has flaky tests
      const job2: JobTestResult = {
        jobName: 'E2E Test (Functions)',
        workflowName: 'tests-appwrite.yml',
        attempt: 3,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          {
            name: 'FunctionsTest::testCreate',
            class: 'FunctionsTest',
            method: 'testCreate',
            attempts: 3,
            time: 5.2,
          },
          {
            name: 'FunctionsTest::testUpdate',
            class: 'FunctionsTest',
            method: 'testUpdate',
            attempts: 2,
            time: 3.1,
          },
        ],
        retriedCount: 5,
      };

      const jobId2 = getJobId(job2.workflowName, job2.jobName, prNumber);
      data = mergeCommitData(data, commitSha, jobId2, job2, 'test-repo');
      body = formatCommentBody(data, marker);

      // Should show flaky tests
      expect(body).toContain('Flaky tests detected');
      expect(body).toContain('FunctionsTest::testCreate');
      expect(body).toContain('FunctionsTest::testUpdate');
      expect(body).toContain('5.20s');
      expect(body).toContain('3.10s');

      // Job 3 from different workflow
      const job3: JobTestResult = {
        jobName: 'E2E Test (Backups)',
        workflowName: 'tests-cloud.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [],
        retriedCount: 3,
      };

      const jobId3 = getJobId(job3.workflowName, job3.jobName, prNumber);
      data = mergeCommitData(data, commitSha, jobId3, job3, 'test-repo');
      body = formatCommentBody(data, marker);

      // Job 3 has no flaky tests, so comment still only shows job2's flaky tests
      expect(body).toContain('Flaky tests detected');

      // Verify we can parse it back
      const parsed = parseCommentData(body);
      expect(parsed).not.toBeNull();
      expect(Object.keys(parsed!.commits[commitSha]!.jobs)).toHaveLength(3);
      expect(parsed!.commits[commitSha]!.jobs[jobId1]).toEqual(job1);
      expect(parsed!.commits[commitSha]!.jobs[jobId2]).toEqual(job2);
      expect(parsed!.commits[commitSha]!.jobs[jobId3]).toEqual(job3);
    });

    test('should handle job retry with flaky test', () => {
      const prNumber = 456;
      const marker = getCommentMarker(prNumber, 'main');
      const jobId = getJobId('workflow.yml', 'Test Job', prNumber);
      const commitSha = 'abc1234';

      // Job passes after retry with flaky test
      const passedJob: JobTestResult = {
        jobName: 'Test Job',
        workflowName: 'workflow.yml',
        attempt: 3,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          {
            name: 'Test::testFlaky',
            class: 'Test',
            method: 'testFlaky',
            attempts: 3,
            time: 5.2,
          },
        ],
        retriedCount: 2,
      };

      const data = mergeCommitData(
        null,
        commitSha,
        jobId,
        passedJob,
        'test-repo',
      );
      const body = formatCommentBody(data, marker);

      // Should show flaky test
      expect(body).toContain('Flaky tests detected');
      expect(body).toContain('Test::testFlaky');
      expect(body).toContain('5.20s');

      // Verify parsed data
      const parsed = parseCommentData(body);
      if (!parsed) throw new Error('Failed to parse comment data');
      const parsedJob = parsed.commits[commitSha]!.jobs[jobId];
      if (!parsedJob) throw new Error('Job not found in parsed data');
      expect(parsedJob.status).toBe('passed');
      expect(parsedJob.attempt).toBe(3);
      expect(parsedJob.flakyTests).toHaveLength(1);
    });

    test('should preserve special characters in data encoding', () => {
      const specialChars =
        'Error with `backticks`, |pipes|, <tags>, and --> sequence';
      const commitSha = 'abc1234';
      const job: JobTestResult = {
        jobName: 'Special Test',
        workflowName: 'test.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [
          {
            name: 'Test::testSpecial',
            attempts: 1,
            error: specialChars,
          },
        ],
        flakyTests: [
          {
            name: 'Test::testSpecial',
            class: 'Test',
            method: 'testSpecial',
            attempts: 2,
            time: 1.8,
          },
        ],
        retriedCount: 1,
      };

      const jobId = getJobId(job.workflowName, job.jobName, 123);
      const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
      const body = formatCommentBody(data, getCommentMarker(123));

      // Shows flaky test
      expect(body).toContain('Flaky tests detected');
      // Should be able to parse back data despite special characters
      const parsed = parseCommentData(body);
      if (!parsed) throw new Error('Failed to parse comment data');
      const parsedJob = parsed.commits[commitSha]!.jobs[jobId];
      if (!parsedJob || !parsedJob.failedTests[0])
        throw new Error('Job or failed test not found');
      expect(parsedJob.failedTests[0].error).toBe(specialChars);
    });

    test('should escape pipe characters in flaky test names', () => {
      const commitSha = 'abc1234';
      const job: JobTestResult = {
        jobName: 'E2E | Integration Test',
        workflowName: 'tests | ci.yml',
        attempt: 1,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          {
            name: 'Test|With|Pipes::testMethod',
            class: 'Test|With|Pipes',
            method: 'testMethod',
            attempts: 2,
            time: 1.5,
          },
        ],
        retriedCount: 0,
      };

      const jobId = getJobId(job.workflowName, job.jobName, 123);
      const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
      const body = formatCommentBody(data, getCommentMarker(123));

      // Pipes should be escaped in table output
      expect(body).toContain('Test\\|With\\|Pipes');

      // But data should preserve original values
      const parsed = parseCommentData(body);
      if (!parsed) throw new Error('Failed to parse comment data');
      const parsedJob = parsed.commits[commitSha]!.jobs[jobId];
      if (!parsedJob) throw new Error('Job not found');
      expect(parsedJob.workflowName).toBe('tests | ci.yml');
      expect(parsedJob.jobName).toBe('E2E | Integration Test');
    });

    test('should preserve newlines in base64 data', () => {
      const multilineError =
        'Error on line 1\nError on line 2\nError on line 3';
      const commitSha = 'abc1234';
      const job: JobTestResult = {
        jobName: 'Test Job',
        workflowName: 'workflow.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [
          {
            name: 'Test::testMultiline',
            attempts: 1,
            error: multilineError,
          },
        ],
        flakyTests: [
          {
            name: 'Test::testMultiline',
            class: 'Test',
            method: 'testMultiline',
            attempts: 2,
            time: 3.1,
          },
        ],
        retriedCount: 1,
      };

      const jobId = getJobId(job.workflowName, job.jobName, 123);
      const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
      const body = formatCommentBody(data, getCommentMarker(123));

      // Shows flaky test
      expect(body).toContain('Flaky tests detected');

      // Original multiline data preserved in base64 encoding
      const parsed = parseCommentData(body);
      if (!parsed) throw new Error('Failed to parse comment data');
      const parsedJob = parsed.commits[commitSha]!.jobs[jobId];
      if (!parsedJob || !parsedJob.failedTests[0])
        throw new Error('Job not found');
      expect(parsedJob.failedTests[0].error).toBe(multilineError);
    });

    test('should handle jobs with flaky tests', () => {
      const marker = getCommentMarker(789, 'develop');
      const commitSha = 'abc1234';

      // Multiple jobs, some with flaky tests
      const jobs: JobTestResult[] = [
        {
          jobName: 'Unit Tests',
          workflowName: 'ci.yml',
          attempt: 1,
          maxAttempts: 3,
          status: 'passed',
          failedTests: [],
          flakyTests: [],
          retriedCount: 0,
        },
        {
          jobName: 'Integration Tests',
          workflowName: 'ci.yml',
          attempt: 2,
          maxAttempts: 3,
          status: 'passed',
          failedTests: [],
          flakyTests: [
            {
              name: 'IntegrationTest::testAPI',
              class: 'IntegrationTest',
              method: 'testAPI',
              attempts: 2,
              time: 2.3,
            },
          ],
          retriedCount: 3,
        },
        {
          jobName: 'E2E Tests',
          workflowName: 'ci.yml',
          attempt: 2,
          maxAttempts: 3,
          status: 'passed',
          failedTests: [],
          flakyTests: [
            {
              name: 'E2ETest::testLogin',
              class: 'E2ETest',
              method: 'testLogin',
              attempts: 2,
              time: 4.1,
            },
          ],
          retriedCount: 5,
        },
      ];

      let data: CommentData | null = null;
      jobs.forEach((job) => {
        const jobId = getJobId(job.workflowName, job.jobName, 789);
        data = mergeCommitData(data, commitSha, jobId, job, 'test-repo');
      });

      const body = formatCommentBody(data!, marker);

      // Should show flaky tests
      expect(body).toContain('Flaky tests detected');
      expect(body).toContain('IntegrationTest::testAPI');
      expect(body).toContain('E2ETest::testLogin');

      // Should still have embedded data
      const parsed = parseCommentData(body);
      expect(parsed).not.toBeNull();
      expect(Object.keys(parsed!.commits[commitSha]!.jobs)).toHaveLength(3);
    });
  });

  describe('Comment marker generation', () => {
    test('should generate unique markers for different PRs', () => {
      const marker1 = getCommentMarker(100, 'feature');
      const marker2 = getCommentMarker(200, 'feature');
      const marker3 = getCommentMarker(100, 'bugfix');

      expect(marker1).not.toBe(marker2);
      expect(marker1).not.toBe(marker3);
      expect(marker2).not.toBe(marker3);
    });

    test('should handle missing branch gracefully', () => {
      const marker = getCommentMarker(123, undefined);
      expect(marker).toBe('<!-- 123#php-retry -->');
    });

    test('should handle missing PR number gracefully', () => {
      const marker = getCommentMarker(undefined, 'main');
      expect(marker).toBe('<!-- main#php-retry -->');
    });
  });

  describe('Job ID generation', () => {
    test('should generate consistent job IDs', () => {
      const id1 = getJobId('workflow.yml', 'Job Name', 123);
      const id2 = getJobId('workflow.yml', 'Job Name', 123);

      expect(id1).toBe(id2);
      expect(id1).toBe('workflow.yml#Job Name#123');
    });

    test('should differentiate between workflows', () => {
      const id1 = getJobId('workflow1.yml', 'Test', 123);
      const id2 = getJobId('workflow2.yml', 'Test', 123);

      expect(id1).not.toBe(id2);
    });

    test('should differentiate between job names', () => {
      const id1 = getJobId('workflow.yml', 'Job 1', 123);
      const id2 = getJobId('workflow.yml', 'Job 2', 123);

      expect(id1).not.toBe(id2);
    });
  });

  describe('Data encoding/decoding roundtrip', () => {
    test('should perfectly preserve data through encode/decode cycle', () => {
      const original: CommentData = {
        commits: {
          abc1234: {
            jobs: {
              'w1#j1#123': {
                jobName: 'Job 1',
                workflowName: 'workflow.yml',
                attempt: 3,
                maxAttempts: 3,
                status: 'passed',
                failedTests: [
                  {
                    name: 'Complex::test::with::namespace',
                    attempts: 3,
                    error:
                      'Multi-line\nerror\nwith\n-->special<--\ncharacters\nand "quotes"',
                  },
                ],
                flakyTests: [
                  {
                    name: 'Complex::test::with::namespace',
                    class: 'Complex',
                    method: 'test::with::namespace',
                    attempts: 3,
                    time: 8.7,
                  },
                ],
                retriedCount: 10,
              },
            },
            timestamp: '2025-12-28T15:30:45.123Z',
          },
        },
        repo: 'test-repo',
      };

      const marker = '<!-- test -->';
      const body = formatCommentBody(original, marker);
      const decoded = parseCommentData(body);

      expect(decoded).toEqual(original);
    });
  });
});

describe('Backward compatibility', () => {
  test('should handle old flaky test data without class/method fields', () => {
    const marker = '<!-- 123#main#php-retry -->';
    const prNumber = 123;

    const job: JobTestResult = {
      jobName: 'E2E Test',
      workflowName: 'tests.yml',
      attempt: 2,
      maxAttempts: 3,
      status: 'passed',
      failedTests: [],
      flakyTests: [
        {
          name: 'Tests\\E2E\\Services\\Sites\\SitesConsoleClientTest::testSiteScreenshot',
          // Old data: missing class and method fields
          class: undefined as unknown as string,
          method: undefined as unknown as string,
          attempts: 1,
          time: 1.5,
        },
      ],
      retriedCount: 1,
    };

    const commitSha = 'abc1234';
    const jobId = getJobId(job.workflowName, job.jobName, prNumber);
    const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
    const body = formatCommentBody(data, marker, prNumber);

    // Should fall back to parsing from name
    expect(body).toContain('SitesConsoleClientTest::testSiteScreenshot');
    expect(body).not.toContain('undefined::undefined');
  });
});

describe('Details column', () => {
  test('should include Details column with link when runUrl is present', () => {
    const marker = '<!-- 123#main#php-retry -->';
    const prNumber = 123;

    const job: JobTestResult = {
      jobName: 'E2E Test',
      workflowName: 'tests.yml',
      attempt: 2,
      maxAttempts: 3,
      status: 'passed',
      failedTests: [],
      flakyTests: [
        {
          name: 'TestClass::testMethod',
          class: 'TestClass',
          method: 'testMethod',
          attempts: 2,
          time: 1.5,
        },
      ],
      retriedCount: 1,
      runUrl: 'https://github.com/owner/repo/actions/runs/123/job/456',
    };

    const commitSha = 'abc1234';
    const jobId = getJobId(job.workflowName, job.jobName, prNumber);
    const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
    const body = formatCommentBody(data, marker, prNumber);

    // Should have Details column header
    expect(body).toContain('| Details |');
    // Should have link to workflow run (HTML format with target="_blank")
    expect(body).toContain(
      '<a href="https://github.com/owner/repo/actions/runs/123/job/456" target="_blank">Logs</a>',
    );
  });

  test('should show dash in Details column when runUrl is absent', () => {
    const marker = '<!-- 123#main#php-retry -->';
    const prNumber = 123;

    const job: JobTestResult = {
      jobName: 'E2E Test',
      workflowName: 'tests.yml',
      attempt: 2,
      maxAttempts: 3,
      status: 'passed',
      failedTests: [],
      flakyTests: [
        {
          name: 'TestClass::testMethod',
          class: 'TestClass',
          method: 'testMethod',
          attempts: 2,
          time: 1.5,
        },
      ],
      retriedCount: 1,
      // No runUrl
    };

    const commitSha = 'abc1234';
    const jobId = getJobId(job.workflowName, job.jobName, prNumber);
    const data = mergeCommitData(null, commitSha, jobId, job, 'test-repo');
    const body = formatCommentBody(data, marker, prNumber);

    // Should have Details column header
    expect(body).toContain('| Details |');
    // Should show dash when no URL
    expect(body).toMatch(/\|\s*-\s*\|/);
  });
});
