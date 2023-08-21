import * as fs from 'fs';
import * as path from 'path';

import { Probot, Context } from 'probot';
import * as nock from 'nock';

import {
  addOrUpdateDeprecationReviewCheck,
  isChecklistComment,
  isReviewLabel,
  maybeAddChecklistComment,
  setupDeprecationReviewStateManagement,
} from '../src/deprecation-review-state';
import {
  REVIEW_LABELS,
  DEPRECATION_REVIEW_CHECK_NAME,
  DEPRECATION_REVIEW_LABELS,
} from '../src/constants';

import { CheckRunStatus } from '../src/enums';

const handler = async (app: Probot) => {
  setupDeprecationReviewStateManagement(app);
};

const CHECKLIST_COMMENT = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'deprecation-checklist.md'),
  'utf-8',
);

describe('deprecation review', () => {
  let robot: Probot;
  let moctokit: any;

  beforeEach(() => {
    nock.disableNetConnect();
    robot = new Probot({
      githubToken: 'test',
      secret: 'secret',
      privateKey: 'private key',
      appId: 690857,
    });

    moctokit = {
      issues: {
        addLabels: jest.fn().mockReturnValue({ data: [] }),
        createComment: jest.fn().mockResolvedValue({}),
        listLabelsOnIssue: jest.fn().mockReturnValue({ data: [] }),
        listComments: jest.fn().mockReturnValue({ data: [] }),
        removeLabel: jest.fn().mockReturnValue({ data: [] }),
      },
      checks: {
        listForRef: jest.fn().mockReturnValue({ data: { check_runs: [] } }),
        create: jest.fn().mockReturnValue({ data: {} }),
        update: jest.fn().mockReturnValue({ data: {} }),
      },
      teams: {
        listMembersInOrg: jest.fn().mockReturnValue({ data: [] }),
      },
      pulls: {
        listReviews: jest.fn().mockReturnValue({ data: [] }),
      },
    } as any as Context['octokit'];

    robot.load(handler);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('isReviewLabel', () => {
    it('should return true for review labels', () => {
      expect(isReviewLabel(DEPRECATION_REVIEW_LABELS.REQUESTED)).toEqual(true);
      expect(isReviewLabel(DEPRECATION_REVIEW_LABELS.COMPLETE)).toEqual(true);
    });

    it('should return false for any other labels', () => {
      expect(isReviewLabel(REVIEW_LABELS.APPROVED)).toEqual(false);
    });
  });

  describe('isChecklistComment', () => {
    it('should return true for the checklist comment', () => {
      const {
        comment,
      } = require('./fixtures/deprecation-review-state/issue_comment.checklist_complete.json');
      expect(isChecklistComment(comment)).toEqual(true);
    });

    it('should false true for any other comment', () => {
      const { comment } = require('./fixtures/deprecation-review-state/issue_comment.edited.json');
      expect(isChecklistComment(comment)).toEqual(false);
    });
  });

  describe('addOrUpdateDeprecationReviewCheck', () => {
    it('should reset the check when PR does not have a deprecation review label', async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.no_review_label.json');

      moctokit.checks.listForRef = jest.fn().mockReturnValue({
        data: {
          check_runs: [
            {
              name: DEPRECATION_REVIEW_CHECK_NAME,
              id: '12345',
            },
          ],
        },
      });

      const expected = {
        name: DEPRECATION_REVIEW_CHECK_NAME,
        status: 'completed',
        output: {
          title: 'Outdated',
          summary: `PR no longer requires ${DEPRECATION_REVIEW_CHECK_NAME}`,
        },
        conclusion: CheckRunStatus.NEUTRAL,
      };

      await addOrUpdateDeprecationReviewCheck(moctokit, pull_request);
      expect(moctokit.checks.update).toHaveBeenCalledWith(expect.objectContaining(expected));

      expect(moctokit.issues.addLabels).not.toHaveBeenCalled();
      expect(moctokit.issues.removeLabel).not.toHaveBeenCalled();

      expect(moctokit.checks.listForRef).toHaveBeenCalled();
      expect(moctokit.checks.update).toHaveBeenCalled();
    });

    it(`should create the check for a PR with the ${DEPRECATION_REVIEW_LABELS.REQUESTED} label`, async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.requested_review_label.json');

      moctokit.checks.listForRef = jest.fn().mockReturnValue({
        data: {
          check_runs: [],
        },
      });

      const expected = {
        name: DEPRECATION_REVIEW_CHECK_NAME,
        status: 'in_progress',
        output: {
          title: 'Pending',
          summary: 'Review in-progress',
        },
      };

      await addOrUpdateDeprecationReviewCheck(moctokit, pull_request);
      expect(moctokit.checks.create).toHaveBeenCalledWith(expect.objectContaining(expected));
    });

    it('should not use Checks API when the PR is from a fork', async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.requested_review_label.json');

      pull_request.head.repo.fork = true;

      await addOrUpdateDeprecationReviewCheck(moctokit, pull_request);
      expect(moctokit.checks.create).not.toHaveBeenCalled();
      expect(moctokit.checks.update).not.toHaveBeenCalled();
    });

    it(`should correctly update deprecation review check for ${DEPRECATION_REVIEW_LABELS.COMPLETE} label`, async () => {
      const payload = require('./fixtures/deprecation-review-state/pull_request.review_complete_label.json');

      moctokit.checks.listForRef = jest.fn().mockReturnValue({
        data: {
          check_runs: [
            {
              name: DEPRECATION_REVIEW_CHECK_NAME,
              id: '12345',
            },
          ],
        },
      });

      const expected = {
        name: DEPRECATION_REVIEW_CHECK_NAME,
        status: 'completed',
        output: {
          title: 'Complete',
          summary: 'All review items have been checked off',
        },
        conclusion: CheckRunStatus.SUCCESS,
      };

      await addOrUpdateDeprecationReviewCheck(moctokit, payload.pull_request);
      expect(moctokit.checks.update).toHaveBeenCalledWith(expect.objectContaining(expected));
    });
  });

  describe('maybeAddChecklistComment', () => {
    it('should comment on the PR when Deprecation Review is requested', async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.requested_review_label.json');

      await maybeAddChecklistComment(moctokit, pull_request);
      expect(moctokit.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          body: CHECKLIST_COMMENT,
        }),
      );
    });

    it('should not comment on a PR when no Deprecation Review is requested', async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.no_review_label.json');

      await maybeAddChecklistComment(moctokit, pull_request);
      expect(moctokit.issues.createComment).not.toHaveBeenCalled();
    });

    it('should not comment on the PR when the comment already exists', async () => {
      const {
        pull_request,
      } = require('./fixtures/deprecation-review-state/pull_request.requested_review_label.json');

      moctokit.issues.listComments = jest.fn().mockReturnValue({
        data: [
          {
            user: {
              login: 'bot',
            },
            body: CHECKLIST_COMMENT,
          },
        ],
      });

      await maybeAddChecklistComment(moctokit, pull_request);
      expect(moctokit.issues.createComment).not.toHaveBeenCalled();
    });
  });

  it(`creates the deprecation review check and comments when review is requested`, async () => {
    const payload = require('./fixtures/deprecation-review-state/pull_request.requested_review_label.json');

    nock('https://api.github.com')
      .get(
        `/repos/dsanders11/deprecation-review/commits/${payload.pull_request.head.sha}/check-runs?per_page=100`,
      )
      .reply(200, {
        check_runs: [],
      });

    nock('https://api.github.com')
      .get(
        `/repos/dsanders11/deprecation-review/issues/${payload.pull_request.number}/comments?per_page=100`,
      )
      .reply(200, []);

    const expected = {
      name: DEPRECATION_REVIEW_CHECK_NAME,
      status: 'in_progress',
      output: {
        title: 'Pending',
        summary: 'Review in-progress',
      },
    };

    nock('https://api.github.com')
      .post(`/repos/dsanders11/deprecation-review/check-runs/`, (body) => {
        expect(body).toMatchObject(expected);
        return true;
      })
      .reply(200);

    nock('https://api.github.com')
      .post(
        `/repos/dsanders11/deprecation-review/issues/${payload.pull_request.number}/comments`,
        ({ body }) => {
          expect(body).toEqual(CHECKLIST_COMMENT);
          return true;
        },
      )
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it(`correctly updates deprecation review check when no review labels are found`, async () => {
    const payload = require('./fixtures/deprecation-review-state/pull_request.no_review_label.json');

    nock('https://api.github.com')
      .get(
        `/repos/dsanders11/deprecation-review/commits/${payload.pull_request.head.sha}/check-runs?per_page=100`,
      )
      .reply(200, {
        check_runs: [
          {
            name: DEPRECATION_REVIEW_CHECK_NAME,
            id: '12345',
          },
        ],
      });

    const expected = {
      name: DEPRECATION_REVIEW_CHECK_NAME,
      status: 'completed',
      output: {
        title: 'Outdated',
        summary: `PR no longer requires ${DEPRECATION_REVIEW_CHECK_NAME}`,
      },
      conclusion: CheckRunStatus.NEUTRAL,
    };

    nock('https://api.github.com')
      .patch(`/repos/dsanders11/deprecation-review/check-runs/12345`, (body) => {
        expect(body).toMatchObject(expected);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('correctly updates deprecation review check and deprecation review label when pr is unlabeled', async () => {
    const payload = require('./fixtures/deprecation-review-state/pull_request.unlabeled.json');

    nock('https://api.github.com')
      .get(
        `/repos/dsanders11/deprecation-review/issues/${payload.number}/labels?per_page=100&page=1`,
      )
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/dsanders11/deprecation-review/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([DEPRECATION_REVIEW_LABELS.COMPLETE]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('does nothing for an edited comment that is not the deprecation checklist', async () => {
    const payload = require('./fixtures/deprecation-review-state/issue_comment.edited.json');

    await robot.receive({
      id: '123-456',
      name: 'issue_comment',
      payload,
    });
    expect(nock.isDone()).toEqual(true);
  });

  it('correctly updates deprecation review check and deprecation review label when checklist complete', async () => {
    const payload = require('./fixtures/deprecation-review-state/issue_comment.checklist_complete.json');

    nock('https://api.github.com')
      .get(
        `/repos/dsanders11/deprecation-review/issues/${payload.number}/labels?per_page=100&page=1`,
      )
      .reply(200, [DEPRECATION_REVIEW_LABELS.REQUESTED]);

    nock('https://api.github.com')
      .post(`/repos/dsanders11/deprecation-review/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([DEPRECATION_REVIEW_LABELS.REQUESTED]);
        return true;
      })
      .reply(200)
      .post(`/repos/dsanders11/deprecation-review/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([DEPRECATION_REVIEW_LABELS.COMPLETE]);
        return true;
      })
      .reply(200);

    const expected = {
      name: DEPRECATION_REVIEW_CHECK_NAME,
      status: 'completed',
      output: {
        title: 'Complete',
        summary: 'All review items have been checked off',
      },
      conclusion: CheckRunStatus.SUCCESS,
    };

    nock('https://api.github.com')
      .patch(`/repos/dsanders11/deprecation-review/check-runs/12345`, (body) => {
        expect(body).toMatchObject(expected);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'issue_comment',
      payload,
    });
  });
});
