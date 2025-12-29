import * as core from '@actions/core';
import * as github from '@actions/github';
import type { CommentData, JobTestResult } from '../types.js';

const MAX_COMMITS = 5; // Track last n number for commits for summary

const MAX_COMMENT_SIZE = 60000; // GitHub limit is ~65KB, use 60KB to be safe

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

  if (!obj.commits || typeof obj.commits !== 'object') return false;
  if (obj.repo !== undefined && typeof obj.repo !== 'string') return false;

  const commits = obj.commits as Record<string, unknown>;
  for (const commit of Object.values(commits)) {
    if (!commit || typeof commit !== 'object') return false;

    const commitData = commit as Record<string, unknown>;
    if (!commitData.jobs || typeof commitData.jobs !== 'object') return false;
    if (!commitData.timestamp || typeof commitData.timestamp !== 'string')
      return false;
  }

  return true;
}

/**
 * Parse existing comment data from JSON with validation
 */
export function parseCommentData(commentBody: string): CommentData | null {
  try {
    const dataMatch = commentBody.match(/<!-- data:([^<>]+?) -->/);
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
 * Merge new job result into existing comment data for a specific commit
 */
export function mergeCommitData(
  existingData: CommentData | null,
  commitSha: string,
  jobId: string,
  jobResult: JobTestResult,
  repo?: string,
): CommentData {
  const existingCommit = existingData?.commits?.[commitSha];

  const allCommits = {
    ...(existingData?.commits || {}),
    [commitSha]: {
      jobs: {
        ...(existingCommit?.jobs || {}),
        [jobId]: jobResult,
      },
      timestamp: new Date().toISOString(),
    },
  };

  const sortedEntries = Object.entries(allCommits).sort(
    ([, a], [, b]) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const recentCommits = sortedEntries.slice(0, MAX_COMMITS);

  return {
    commits: Object.fromEntries(recentCommits),
    repo: repo || existingData?.repo,
  };
}

/**
 * Format comment body with test results grouped by commit
 */
export function formatCommentBody(data: CommentData, marker: string): string {
  const base64Data = Buffer.from(JSON.stringify(data)).toString('base64');

  let body = `${marker}
<!-- data:${base64Data} -->
${COMMENT_MESSAGES.header()}

Flaky tests detected across commits:
`;

  // Sort commits by timestamp (newest first)
  const sortedCommits = Object.entries(data.commits).sort(
    ([, a], [, b]) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  if (sortedCommits.length === 0) {
    throw new Error('formatCommentBody called with no commits');
  }

  const hasAnyFlakyTests = sortedCommits.some(([, commitData]) =>
    Object.values(commitData.jobs).some((job) => job.flakyTests.length > 0),
  );

  if (!hasAnyFlakyTests) {
    throw new Error('formatCommentBody called with no flaky tests');
  }

  for (let i = 0; i < sortedCommits.length; i++) {
    const entry = sortedCommits[i];
    if (!entry) continue;

    const [commitSha, commitData] = entry;
    const isFirst = i === 0;

    const flakyTests: Array<{
      test: { name: string; attempts: number; time: number };
      workflowName: string;
      jobName: string;
    }> = [];

    for (const job of Object.values(commitData.jobs)) {
      if (!job) continue;

      for (const test of job.flakyTests) {
        flakyTests.push({
          test,
          workflowName: job.workflowName,
          jobName: job.jobName,
        });
      }
    }

    if (flakyTests.length === 0) continue;

    const shortSha = commitSha.substring(0, 7);
    const testCount = flakyTests.length;
    const testText = testCount === 1 ? 'test' : 'tests';

    let commitDisplay = `<code>${shortSha}</code>`;
    if (data.repo) {
      commitDisplay = `<a href="https://github.com/${data.repo}/commit/${commitSha}"><code>${shortSha}</code></a>`;
    }

    const openAttr = isFirst ? ' open' : '';
    body += `<details${openAttr}>
<summary>Commit ${commitDisplay} - ${testCount} flaky ${testText}</summary>

<br>

| Test | Attempts | Total Time |
|------|----------|------------|
`;

    let testsShown = 0;
    let displayTruncated = false;

    for (const { test, workflowName, jobName } of flakyTests) {
      const escapedTestName = escapeMarkdownTableCell(test.name);
      const escapedWorkflow = escapeMarkdownTableCell(workflowName);
      const escapedJob = escapeMarkdownTableCell(jobName);
      const testCell = `\`${escapedTestName}\` [${escapedWorkflow} / ${escapedJob}]`;
      const timeStr = formatDuration(test.time);
      const row = `| ${testCell} | ${test.attempts} | ${timeStr} |\n`;

      if (Buffer.byteLength(body + row, 'utf-8') > MAX_COMMENT_SIZE) {
        displayTruncated = true;
        break;
      }

      body += row;
      testsShown++;
    }

    if (displayTruncated) {
      const remaining = flakyTests.length - testsShown;
      body += `\n*Comment truncated: ${remaining} more flaky test(s) not shown due to size limits*\n`;
    }

    body += `\n</details>\n\n`;
  }

  if (sortedCommits.length >= MAX_COMMITS) {
    body += `---\n**Note:** *Flaky test results are tracked for the last ${MAX_COMMITS} commits*`;
  }

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
