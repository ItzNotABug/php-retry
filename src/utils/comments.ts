import * as core from '@actions/core';
import * as github from '@actions/github';
import type { CommentData, JobTestResult } from '../types.js';

/**
 * Comment message constants
 */
export const COMMENT_MESSAGES = {
  header: () => '## 🔄 PHP-Retry Summary',
} as const;

/**
 * Generate unique comment identifier marker
 */
export function getCommentMarker(prNumber?: number, branch?: string): string {
  const parts: string[] = [];
  if (prNumber) parts.push(`${prNumber}`);
  if (branch) parts.push(branch);
  parts.push('php-retry');
  return `<!-- ${parts.join('#')} -->`;
}

/**
 * Generate unique job identifier
 */
export function getJobId(
  workflowName: string,
  jobName: string,
  prNumber?: number,
): string {
  const parts = [workflowName, jobName];
  if (prNumber) parts.push(`${prNumber}`);
  return parts.join('#');
}

/**
 * Find existing comment on PR
 */
export async function findExistingComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  marker: string,
): Promise<number | null> {
  try {
    // Use octokit.paginate to fetch all comments
    const comments = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
    });

    const existingComment = comments.find(
      (comment) =>
        comment.user?.type === 'Bot' && comment.body?.includes(marker),
    );

    return existingComment?.id ?? null;
  } catch (error) {
    core.warning(`Failed to find existing comment: ${error}`);
    return null;
  }
}

/**
 * Validate parsed data matches CommentData structure
 */
function isValidCommentData(data: unknown): data is CommentData {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  if (!obj.jobs || typeof obj.jobs !== 'object') return false;
  if (!obj.lastUpdated || typeof obj.lastUpdated !== 'string') return false;
  if (obj.runId !== undefined && typeof obj.runId !== 'string') return false;

  const jobs = obj.jobs as Record<string, unknown>;
  for (const job of Object.values(jobs)) {
    if (!job || typeof job !== 'object') return false;
  }

  return true;
}

/**
 * Parse existing comment data from JSON with validation
 */
export function parseCommentData(commentBody: string): CommentData | null {
  try {
    const dataMatch = commentBody.match(/<!-- data:(.*?) -->/s);
    if (!dataMatch || !dataMatch[1]) return null;

    const base64Data = dataMatch[1].trim();
    const jsonStr = Buffer.from(base64Data, 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonStr);

    if (!isValidCommentData(parsed)) {
      core.warning('Parsed comment data has invalid structure');
      return null;
    }

    return parsed;
  } catch (error) {
    core.warning(`Failed to parse comment data: ${error}`);
    return null;
  }
}

/**
 * Merge new job result with existing comment data (immutable)
 */
export function mergeJobResult(
  existingData: CommentData | null,
  jobId: string,
  jobResult: JobTestResult,
  runId?: string,
): CommentData {
  return {
    jobs: {
      ...(existingData?.jobs || {}),
      [jobId]: jobResult,
    },
    lastUpdated: new Date().toISOString(),
    runId: runId ?? existingData?.runId,
  };
}

/**
 * Format comment body with test results
 */
export function formatCommentBody(data: CommentData, marker: string): string {
  const completedJobs = Object.keys(data.jobs).length;

  const allFlakyTests: Array<{
    test: { name: string; attempts: number; time: number };
    workflowName: string;
    jobName: string;
  }> = [];

  for (const job of Object.values(data.jobs)) {
    for (const test of job.flakyTests) {
      allFlakyTests.push({
        test,
        workflowName: job.workflowName,
        jobName: job.jobName,
      });
    }
  }

  if (allFlakyTests.length === 0) {
    throw new Error('formatCommentBody called with no flaky tests');
  }

  const base64Data = Buffer.from(JSON.stringify(data)).toString('base64');

  let body = `${marker}
<!-- data:${base64Data} -->
${COMMENT_MESSAGES.header()}

⚠️ **Flaky tests detected** (passed after retry):

| Test | Attempts | Total Time |
|------|----------|------------|
`;

  for (const { test, workflowName, jobName } of allFlakyTests) {
    const escapedTestName = escapeMarkdownTableCell(test.name);
    const escapedWorkflow = escapeMarkdownTableCell(workflowName);
    const escapedJob = escapeMarkdownTableCell(jobName);
    const testCell = `\`${escapedTestName}\` [${escapedWorkflow} / ${escapedJob}]`;
    const timeStr = formatDuration(test.time);
    body += `| ${testCell} | ${test.attempts} | ${timeStr} |\n`;
  }

  const jobText = completedJobs === 1 ? 'job' : 'jobs';
  body += `\n---\n*${completedJobs} ${jobText} tracked | Last updated: ${formatTimestamp(data.lastUpdated)}*`;

  return body;
}

/**
 * Create or update PR comment
 */
export async function createOrUpdateComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  existingCommentId?: number | null,
): Promise<void> {
  try {
    if (existingCommentId) {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existingCommentId,
        body,
      });
      core.debug(`Updated PR comment #${existingCommentId}`);
    } else {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
      core.debug(`Created PR comment #${data.id}`);
    }
  } catch (error) {
    core.warning(`Failed to create/update PR comment: ${error}`);
  }
}

/**
 * Delete PR comment
 */
export async function deleteComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  commentId: number,
): Promise<void> {
  try {
    await octokit.rest.issues.deleteComment({
      owner,
      repo,
      comment_id: commentId,
    });
    core.debug(`Deleted PR comment #${commentId}`);
  } catch (error) {
    core.warning(`Failed to delete PR comment: ${error}`);
  }
}

function formatTimestamp(isoString: string): string {
  return new Date(isoString).toUTCString();
}

function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return `${(seconds * 1000).toFixed(0)}ms`;
  }
  return `${seconds.toFixed(2)}s`;
}

function escapeMarkdownTableCell(text: string): string {
  return text
    .replace(/\|/g, '\\|') // Escape pipes (break table columns)
    .replace(/`/g, '\\`') // Escape backticks (break inline code formatting)
    .replace(/\n/g, ' ') // Replace newlines with spaces
    .replace(/\r/g, ''); // Remove carriage returns
}
