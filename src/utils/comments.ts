import * as core from '@actions/core';
import * as github from '@actions/github';
import type { CommentData, CommitData, JobTestResult } from '../types.js';

const MAX_COMMITS = 5; // Maximum commits to track

const MAX_COMMENT_SIZE = 60000; // GitHub limit is ~65KB, use 60KB to be safe

const BASE64_SPACE_RATIO = 0.5; // Reserve 50% of space for base64 data overhead

export const LOCAL_COMMIT_SHA = 'abc1234567890def1234567890abcdef12345678'; // Fallback for local testing

/**
 * Comment message constants
 */
export const COMMENT_MESSAGES = {
  header: () => '## 🔄 PHP-Retry Summary',
} as const;

/**
 * Encode comment data to base64
 */
function encodeCommentData(data: CommentData | string | null): string {
  return Buffer.from(JSON.stringify(data)).toString('base64');
}

/**
 * Build comment header template
 */
function buildCommentHeader(marker: string): string {
  return `${marker}\n<!-- data: -->\n${COMMENT_MESSAGES.header()}\n\nFlaky tests detected across commits:\n`;
}

/**
 * Build complete comment template
 */
function buildCommentTemplate(
  marker: string,
  base64Data: string,
  content: string,
): string {
  return `${marker}
<!-- data:${base64Data} -->
${COMMENT_MESSAGES.header()}

${content}`;
}

/**
 * Build success message when no flaky tests in recent commits
 */
export function buildSuccessComment(
  marker: string,
  commitCount: number,
): string {
  const base64Data = encodeCommentData(null);
  const content = `**No flaky tests detected in the last ${commitCount} commit${commitCount !== 1 ? 's' : ''}**

All tests passed on first attempt.`;

  return buildCommentTemplate(marker, base64Data, content);
}

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
      timestamp: existingCommit?.timestamp || new Date().toISOString(),
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
 * Build a single commit section and return filtered commit data
 */
function buildCommitSection(
  commitSha: string,
  commitData: CommitData,
  repo: string | undefined,
  isFirst: boolean,
  maxSize?: number,
): {
  section: string;
  truncated: boolean;
  truncatedCount: number;
  filteredCommitData: CommitData;
} {
  const flakyTests: Array<{
    test: { name: string; attempts: number; time: number };
    workflowName: string;
    jobName: string;
    jobId: string;
  }> = [];

  for (const [jobId, job] of Object.entries(commitData.jobs)) {
    if (!job?.flakyTests) continue;
    for (const test of job.flakyTests) {
      flakyTests.push({
        test,
        workflowName: job.workflowName,
        jobName: job.jobName,
        jobId,
      });
    }
  }

  if (flakyTests.length === 0) {
    return {
      section: '',
      truncated: false,
      truncatedCount: 0,
      filteredCommitData: commitData,
    };
  }

  const shortSha = commitSha.substring(0, 7);
  const testCount = flakyTests.length;
  const testText = testCount === 1 ? 'test' : 'tests';

  let commitDisplay = `<code>${shortSha}</code>`;
  if (repo) {
    commitDisplay = `<a href="https://github.com/${repo}/commit/${commitSha}"><code>${shortSha}</code></a>`;
  }

  const openAttr = isFirst ? ' open' : '';
  let section = `<details${openAttr}>
<summary>Commit ${commitDisplay} - ${testCount} flaky ${testText}</summary>

<br>

| Test | Attempts | Total Time |
|------|----------|------------|
`;

  let testsShown = 0;
  let truncated = false;
  const displayedTests = new Set<string>();

  for (const { test, workflowName, jobName, jobId } of flakyTests) {
    const escapedTestName = escapeMarkdownTableCell(test.name);
    const escapedWorkflow = escapeMarkdownTableCell(workflowName);
    const escapedJob = escapeMarkdownTableCell(jobName);
    const testCell = `\`${escapedTestName}\` [${escapedWorkflow} / ${escapedJob}]`;
    const timeStr = formatDuration(test.time);
    const row = `| ${testCell} | ${test.attempts} | ${timeStr} |\n`;

    if (maxSize && Buffer.byteLength(section + row, 'utf-8') > maxSize) {
      truncated = true;
      break;
    }

    section += row;
    testsShown++;
    displayedTests.add(`${jobId}:${test.name}`);
  }

  if (truncated) {
    const remaining = flakyTests.length - testsShown;
    section += `\n*Comment truncated: ${remaining} more flaky test(s) not shown due to size limits*\n`;
  }

  section += `\n</details>\n\n`;

  // Create filtered commit data with only displayed tests
  const filteredJobs: Record<string, JobTestResult> = {};
  for (const [jobId, job] of Object.entries(commitData.jobs)) {
    if (!job) continue;

    const filteredFlakyTests = job.flakyTests.filter((test) =>
      displayedTests.has(`${jobId}:${test.name}`),
    );

    // Include all jobs to preserve complete state
    filteredJobs[jobId] = {
      ...job,
      flakyTests: filteredFlakyTests,
    };
  }

  const filteredCommitData: CommitData = {
    jobs: filteredJobs,
    timestamp: commitData.timestamp,
  };

  return {
    section,
    truncated,
    truncatedCount: flakyTests.length - testsShown,
    filteredCommitData,
  };
}

/**
 * Try to build comment with N commits
 */
function tryBuildWithCommits(
  data: CommentData,
  marker: string,
  sortedCommits: Array<[string, CommitData]>,
  commitCount: number,
): string | null {
  const commitsToInclude = sortedCommits.slice(0, commitCount);

  // Calculate footer size to reserve space
  const droppedCommits = sortedCommits.length - commitCount;
  let footer = '';
  if (droppedCommits > 0) {
    footer = `---\n**Note:** *${droppedCommits} older commit(s) removed due to comment size limits*`;
  } else if (sortedCommits.length >= MAX_COMMITS) {
    footer = `---\n**Note:** *Flaky test results are tracked for the last ${MAX_COMMITS} commits*`;
  }
  const footerSize = Buffer.byteLength(footer, 'utf-8');
  const filteredCommits: Record<string, CommitData> = {};
  let sectionsText = '';

  for (let i = 0; i < commitsToInclude.length; i++) {
    const entry = commitsToInclude[i];
    if (!entry) continue;

    const [commitSha, commitData] = entry;
    const isFirst = i === 0;

    const headerSize = Buffer.byteLength(buildCommentHeader(marker), 'utf-8');
    const estimatedBase64Size = Math.floor(
      MAX_COMMENT_SIZE * BASE64_SPACE_RATIO,
    );
    const currentSize =
      headerSize +
      estimatedBase64Size +
      Buffer.byteLength(sectionsText, 'utf-8');
    const remainingSpace = MAX_COMMENT_SIZE - currentSize - footerSize;

    const { section, filteredCommitData } = buildCommitSection(
      commitSha,
      commitData,
      data.repo,
      isFirst,
      remainingSpace,
    );

    if (!section) continue;

    // Temporarily add this section to check actual size with real base64
    const tempFilteredCommits = {
      ...filteredCommits,
      [commitSha]: filteredCommitData,
    };
    const tempData: CommentData = {
      commits: tempFilteredCommits,
      repo: data.repo,
    };
    const tempBase64 = encodeCommentData(tempData);
    const tempBody = buildCommentTemplate(
      marker,
      tempBase64,
      `Flaky tests detected across commits:\n${sectionsText}${section}${footer}`,
    );

    if (Buffer.byteLength(tempBody, 'utf-8') > MAX_COMMENT_SIZE) {
      return null;
    }

    sectionsText += section;
    filteredCommits[commitSha] = filteredCommitData;
  }

  // Create filtered data and encode it
  const filteredData: CommentData = {
    commits: filteredCommits,
    repo: data.repo,
  };
  const base64Data = encodeCommentData(filteredData);

  return buildCommentTemplate(
    marker,
    base64Data,
    `Flaky tests detected across commits:\n${sectionsText}${footer}`,
  );
}

/**
 * Format comment body with test results grouped by commit
 */
export function formatCommentBody(data: CommentData, marker: string): string {
  // Input validation
  if (!marker || marker.trim().length === 0) {
    throw new Error('marker cannot be empty');
  }
  if (!data?.commits) {
    throw new Error('data.commits is required');
  }

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

  for (
    let commitCount = sortedCommits.length;
    commitCount >= 1;
    commitCount--
  ) {
    const result = tryBuildWithCommits(
      data,
      marker,
      sortedCommits,
      commitCount,
    );
    if (result) {
      return result;
    }
  }

  const [firstCommit] = sortedCommits;
  if (firstCommit) {
    const [commitSha, commitData] = firstCommit;

    // Calculate footer text first to account for its size
    let footer = '';
    if (sortedCommits.length > 1) {
      const droppedCommits = sortedCommits.length - 1;
      footer = `---\n**Note:** *${droppedCommits} older commit(s) removed due to comment size limits*`;
    }

    const footerSize = Buffer.byteLength(footer, 'utf-8');

    // Reserve space for header and base64
    const headerSize = Buffer.byteLength(buildCommentHeader(marker), 'utf-8');
    // Reserve percentage of total space for base64 data
    const estimatedBase64Size = Math.floor(
      MAX_COMMENT_SIZE * BASE64_SPACE_RATIO,
    );
    const remainingSpace =
      MAX_COMMENT_SIZE - headerSize - estimatedBase64Size - footerSize;

    const { section, filteredCommitData } = buildCommitSection(
      commitSha,
      commitData,
      data.repo,
      true,
      remainingSpace,
    );

    if (section) {
      // Create filtered data with only the first commit
      const filteredData: CommentData = {
        commits: { [commitSha]: filteredCommitData },
        repo: data.repo,
      };
      const base64Data = encodeCommentData(filteredData);

      const finalBody = buildCommentTemplate(
        marker,
        base64Data,
        `Flaky tests detected across commits:\n${section}${footer}`,
      );

      if (Buffer.byteLength(finalBody, 'utf-8') <= MAX_COMMENT_SIZE) {
        return finalBody;
      }
    }
  }

  const base64Data = encodeCommentData(null);

  core.warning(
    'Unable to format comment - data exceeds size limits even with truncation',
  );

  return buildCommentTemplate(
    marker,
    base64Data,
    `⚠️ Unable to display test results - exceeds GitHub's comment size limit

The number of flaky tests is too large to display in a single comment.`,
  );
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
