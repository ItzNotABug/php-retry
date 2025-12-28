import { mock } from 'bun:test';

mock.module('@actions/core', () => ({
  debug: () => {},
  warning: () => {},
  info: () => {},
  error: () => {},
  setOutput: () => {},
  setFailed: () => {},
}));

// Mock storage for GitHub API calls
export const githubMocks = {
  comments: [] as Array<{
    id: number;
    user?: { type: string };
    body?: string;
  }>,
  commentIdCounter: 1,
  createCallCount: 0,
  updateCallCount: 0,
  paginateCallCount: 0,
};

export function resetGitHubMocks() {
  githubMocks.comments = [];
  githubMocks.commentIdCounter = 1;
  githubMocks.createCallCount = 0;
  githubMocks.updateCallCount = 0;
  githubMocks.paginateCallCount = 0;
}

const mockOctokit = {
  rest: {
    issues: {
      listComments: mock(async () => ({
        data: githubMocks.comments,
      })),
      getComment: mock(async ({ comment_id }: { comment_id: number }) => {
        const comment = githubMocks.comments.find((c) => c.id === comment_id);
        if (!comment) {
          throw new Error(`Comment ${comment_id} not found`);
        }
        return { data: comment };
      }),
      createComment: mock(
        async ({
          body,
        }: {
          owner: string;
          repo: string;
          issue_number: number;
          body: string;
        }) => {
          githubMocks.createCallCount++;
          const newComment = {
            id: githubMocks.commentIdCounter++,
            user: { type: 'Bot' },
            body,
          };
          githubMocks.comments.push(newComment);
          return { data: newComment };
        },
      ),
      updateComment: mock(
        async ({
          comment_id,
          body,
        }: {
          owner: string;
          repo: string;
          comment_id: number;
          body: string;
        }) => {
          githubMocks.updateCallCount++;
          const comment = githubMocks.comments.find((c) => c.id === comment_id);
          if (!comment) {
            throw new Error(`Comment ${comment_id} not found`);
          }
          comment.body = body;
          return { data: comment };
        },
      ),
      deleteComment: mock(
        async ({
          comment_id,
        }: {
          owner: string;
          repo: string;
          comment_id: number;
        }) => {
          const index = githubMocks.comments.findIndex(
            (c) => c.id === comment_id,
          );
          if (index === -1) {
            throw new Error(`Comment ${comment_id} not found`);
          }
          githubMocks.comments.splice(index, 1);
          return { data: {} };
        },
      ),
    },
  },
  paginate: mock(async (fn: any) => {
    githubMocks.paginateCallCount++;
    const result = await fn();
    return result.data;
  }),
};

mock.module('@actions/github', () => ({
  getOctokit: () => mockOctokit,
  context: {
    payload: {
      pull_request: { number: 123 },
    },
    ref: 'refs/heads/feature-branch',
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
  },
}));
