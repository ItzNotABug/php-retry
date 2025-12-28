import { githubMocks, resetGitHubMocks } from '../mocks';
import * as github from '@actions/github';
import type { ScenarioResult } from './scenarios';
import type { JobTestResult } from '../../src/types.js';
import {
  getCommentMarker,
  getJobId,
  findExistingComment,
  parseCommentData,
  mergeJobResult,
  formatCommentBody,
  createOrUpdateComment,
} from '../../src/utils/comments.js';

type CommentTest = {
  name: string;
  run: () => Promise<void>;
};

const commentTests: CommentTest[] = [
  {
    name: 'Create comment when none exists',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      const jobResult: JobTestResult = {
        jobName: 'E2E Test (Account)',
        workflowName: 'tests-appwrite.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          { name: 'AccountTest::testCreate', attempts: 2, time: 2.5 },
        ],
        retriedCount: 1,
      };

      const jobId = getJobId(
        jobResult.workflowName,
        jobResult.jobName,
        prNumber,
      );
      const data = mergeJobResult(null, jobId, jobResult);
      const body = formatCommentBody(data, marker);

      await createOrUpdateComment(octokit, owner, repo, prNumber, body, null);

      if (githubMocks.createCallCount !== 1)
        throw new Error('Expected 1 create call');
      if (githubMocks.updateCallCount !== 0)
        throw new Error('Expected 0 update calls');
      if (githubMocks.comments.length !== 1)
        throw new Error('Expected 1 comment');

      const comment = githubMocks.comments[0]!;
      if (!comment.body?.includes(marker))
        throw new Error('Comment missing marker');
      if (!comment.body?.includes('⚠️'))
        throw new Error('Missing warning emoji');
      if (!comment.body?.includes('Flaky tests detected'))
        throw new Error('Missing flaky header');
    },
  },
  {
    name: 'Update existing comment',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      const job1: JobTestResult = {
        jobName: 'E2E Test (Account)',
        workflowName: 'tests-appwrite.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          { name: 'AccountTest::testUpdate', attempts: 2, time: 1.8 },
        ],
        retriedCount: 1,
      };

      const jobId1 = getJobId(job1.workflowName, job1.jobName, prNumber);
      const data1 = mergeJobResult(null, jobId1, job1);
      const body1 = formatCommentBody(data1, marker);

      await createOrUpdateComment(octokit, owner, repo, prNumber, body1, null);
      const commentId = githubMocks.comments[0]!.id;

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
            attempts: 3,
            time: 4.2,
          },
        ],
        retriedCount: 5,
      };

      const jobId2 = getJobId(job2.workflowName, job2.jobName, prNumber);
      const data2 = mergeJobResult(data1, jobId2, job2);
      const body2 = formatCommentBody(data2, marker);

      await createOrUpdateComment(
        octokit,
        owner,
        repo,
        prNumber,
        body2,
        commentId,
      );

      if (githubMocks.createCallCount !== 1)
        throw new Error('Expected 1 create call');
      if (githubMocks.updateCallCount !== 1)
        throw new Error('Expected 1 update call');
      if (githubMocks.comments.length !== 1)
        throw new Error('Expected 1 comment');

      const updatedComment = githubMocks.comments[0]!;
      if (!updatedComment.body?.includes('⚠️'))
        throw new Error('Missing warning emoji');
      if (!updatedComment.body?.includes('Flaky tests detected'))
        throw new Error('Missing flaky header');
      if (!updatedComment.body?.includes('FunctionsTest::testCreate'))
        throw new Error('Missing flaky test');
      if (!updatedComment.body?.includes('4.20s'))
        throw new Error('Missing test time');
    },
  },
  {
    name: 'Find existing comment by marker',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      githubMocks.comments.push(
        {
          id: githubMocks.commentIdCounter++,
          user: { type: 'User' },
          body: 'Some user comment',
        },
        {
          id: githubMocks.commentIdCounter++,
          user: { type: 'Bot' },
          body: 'Some other bot comment',
        },
        {
          id: githubMocks.commentIdCounter++,
          user: { type: 'Bot' },
          body: `${marker}\nSome test summary`,
        },
      );

      const foundId = await findExistingComment(
        octokit,
        owner,
        repo,
        prNumber,
        marker,
      );

      if (foundId !== 3) throw new Error('Expected comment ID 3');
      if (githubMocks.paginateCallCount !== 1)
        throw new Error('Expected 1 paginate call');
    },
  },
  {
    name: 'Handle pagination (150+ comments)',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      for (let i = 0; i < 150; i++) {
        githubMocks.comments.push({
          id: githubMocks.commentIdCounter++,
          user: { type: 'User' },
          body: `Comment ${i}`,
        });
      }

      githubMocks.comments.push({
        id: githubMocks.commentIdCounter++,
        user: { type: 'Bot' },
        body: `${marker}\nTest summary`,
      });

      const foundId = await findExistingComment(
        octokit,
        owner,
        repo,
        prNumber,
        marker,
      );

      if (foundId !== 151) throw new Error('Expected comment ID 151');
    },
  },
  {
    name: 'Return null when comment not found',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      const foundId = await findExistingComment(
        octokit,
        owner,
        repo,
        prNumber,
        marker,
      );

      if (foundId !== null) throw new Error('Expected null');
    },
  },
  {
    name: 'Preserve data through create-find-update cycle',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      const job1: JobTestResult = {
        jobName: 'E2E Test (Account)',
        workflowName: 'tests-appwrite.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [
          {
            name: 'AccountTest::testCreate',
            attempts: 2,
            error: 'Database connection failed',
          },
        ],
        flakyTests: [
          {
            name: 'AccountTest::testCreate',
            attempts: 2,
            time: 3.2,
          },
        ],
        retriedCount: 1,
      };

      const jobId = getJobId(job1.workflowName, job1.jobName, prNumber);
      const data = mergeJobResult(null, jobId, job1);
      const body = formatCommentBody(data, marker);

      await createOrUpdateComment(octokit, owner, repo, prNumber, body, null);

      const commentId = await findExistingComment(
        octokit,
        owner,
        repo,
        prNumber,
        marker,
      );
      if (commentId === null) throw new Error('Comment not found');

      const { data: comment } = await octokit.rest.issues.getComment({
        owner,
        repo,
        comment_id: commentId,
      });

      const parsed = parseCommentData(comment.body || '');
      if (!parsed) throw new Error('Failed to parse comment');
      if (JSON.stringify(parsed.jobs[jobId]) !== JSON.stringify(job1)) {
        throw new Error('Data not preserved');
      }
    },
  },
  {
    name: 'Handle multiple workflows in matrix build',
    run: async () => {
      resetGitHubMocks();
      const octokit = github.getOctokit('fake-token');
      const { owner, repo } = github.context.repo;
      const prNumber = 123;
      const marker = getCommentMarker(prNumber, 'feature-branch');

      const job1: JobTestResult = {
        jobName: 'E2E Test (Account)',
        workflowName: 'tests-appwrite.yml',
        attempt: 1,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [],
        retriedCount: 0,
      };

      const jobId1 = getJobId(job1.workflowName, job1.jobName, prNumber);
      let data = mergeJobResult(null, jobId1, job1);

      const job2: JobTestResult = {
        jobName: 'E2E Test (Backups)',
        workflowName: 'tests-cloud.yml',
        attempt: 2,
        maxAttempts: 3,
        status: 'passed',
        failedTests: [],
        flakyTests: [
          {
            name: 'BackupTest::testRestore',
            attempts: 2,
            time: 3.5,
          },
        ],
        retriedCount: 1,
      };

      const jobId2 = getJobId(job2.workflowName, job2.jobName, prNumber);
      data = mergeJobResult(data, jobId2, job2);

      const body = formatCommentBody(data, marker);

      await createOrUpdateComment(octokit, owner, repo, prNumber, body, null);

      const comment = githubMocks.comments[0]!;
      if (!comment.body?.includes('⚠️'))
        throw new Error('Missing warning emoji');
      if (!comment.body?.includes('Flaky tests detected'))
        throw new Error('Missing flaky header');
      if (!comment.body?.includes('tests-cloud.yml'))
        throw new Error('Missing workflow name');
      if (!comment.body?.includes('E2E Test (Backups)'))
        throw new Error('Missing job name');
      if (!comment.body?.includes('BackupTest::testRestore'))
        throw new Error('Missing test name');

      const parsed = parseCommentData(comment.body!);
      if (!parsed) throw new Error('Failed to parse');
      if (Object.keys(parsed.jobs).length !== 2)
        throw new Error('Expected 2 jobs');
    },
  },
];

export async function runCommentTests(
  verbose: boolean,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];

  for (const test of commentTests) {
    const startedAt = Date.now();
    try {
      if (verbose) {
        console.log(`Comment test: ${test.name}`);
      }
      await test.run();
      const durationMs = Date.now() - startedAt;
      results.push({
        name: test.name,
        retryCount: 0,
        durationMs,
      });
      if (verbose) {
        console.log(`OK: ${test.name}`);
        // Show the comment content that was created
        if (githubMocks.comments.length > 0) {
          const lastComment =
            githubMocks.comments[githubMocks.comments.length - 1]!;
          console.log('Comment content:');
          console.log('---');
          console.log(lastComment.body);
          console.log('---');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ ${test.name}: ${message}`);
      throw error;
    }
  }

  return results;
}
