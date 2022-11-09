import { Probot, Context } from 'probot';
import * as nock from 'nock';

import {
  isReviewLabel,
  isSemverMajorMinorLabel,
  getPRReadyDate,
  setupAPIReviewStateManagement,
  addOrUpdateAPIReviewCheck,
  checkPRReadyForMerge,
} from '../src/api-review-state';
import {
  SEMVER_LABELS,
  REVIEW_LABELS,
  MINIMUM_MINOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  API_REVIEW_CHECK_NAME,
  NEW_PR_LABEL,
  API_WORKING_GROUP,
} from '../src/constants';

import { CheckRunStatus } from '../src/enums';

const API_WORKING_GROUP_MEMBERS = [
  { login: 'ckerr' },
  { login: 'codebytere' },
  { login: 'itsananderson' },
  { login: 'jkleinsc' },
  { login: 'marshallofsound' },
  { login: 'miniak' },
  { login: 'nornagon' },
  { login: 'samuelmaddock' },
  { login: 'zcbenz' },
];

const handler = async (app: Probot) => {
  setupAPIReviewStateManagement(app);
};

describe('api review', () => {
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
        listLabelsOnIssue: jest.fn().mockReturnValue({ data: [] }),
        listComments: jest.fn().mockReturnValue({ data: [] }),
      },
      checks: {
        listForRef: jest.fn().mockReturnValue({ data: { check_runs: [] } }),
        create: jest.fn().mockReturnValue({ data: {} }),
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

  it('should returns true for review lables', () => {
    expect(isReviewLabel(REVIEW_LABELS.APPROVED)).toEqual(true);
    expect(isReviewLabel(REVIEW_LABELS.DECLINED)).toEqual(true);
    expect(isReviewLabel(REVIEW_LABELS.REQUESTED)).toEqual(true);
  });

  it('should returns true for semver-major and semver-minor label', () => {
    expect(isSemverMajorMinorLabel(SEMVER_LABELS.MAJOR)).toEqual(true);
    expect(isSemverMajorMinorLabel(SEMVER_LABELS.MINOR)).toEqual(true);
  });

  it('should returns false for any other labels', () => {
    expect(isSemverMajorMinorLabel(SEMVER_LABELS.PATCH)).toEqual(false);
    expect(isReviewLabel(SEMVER_LABELS.MAJOR)).toEqual(false);
  });

  it('correctly returns PR ready date for semver-major/semver-minor labels', async () => {
    const payload = require('./fixtures/api-review-state/pull_request.semver-minor.json');

    // Set created_at to yesterday.
    payload.pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    const readyDate = getPRReadyDate(payload.pull_request);
    const expectedDate = new Date(
      payload.pull_request.created_at.getTime() + MINIMUM_MINOR_OPEN_TIME,
    )
      .toISOString()
      .split('T')[0];

    expect(readyDate).toEqual(expectedDate);
  });

  it('correctly returns PR ready date when semver-major/semver-minor labels not found', async () => {
    const payload = require('./fixtures/api-review-state/pull_request.semver-patch.json');

    // Set created_at to yesterday.
    payload.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    const readyDate = getPRReadyDate(payload);
    const expectedDate = new Date(payload.created_at.getTime() + MINIMUM_PATCH_OPEN_TIME)
      .toISOString()
      .split('T')[0];

    expect(readyDate).toEqual(expectedDate);
  });

  it(`should correctly update api review check when no review and semver/major or semver/minor labels found`, async () => {
    let payload = require('./fixtures/api-review-state/pull_request.no_review_label.json');

    const response = await addOrUpdateAPIReviewCheck(moctokit, payload.pull_request);
    expect(response).toEqual(undefined);
  });

  it(`should correctly update api review check for ${REVIEW_LABELS.REQUESTED} label`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.requested_review_label.json');

    const users = await addOrUpdateAPIReviewCheck(moctokit, payload.pull_request);
    const expectedUsers = {
      approved: [],
      declined: [],
      requestedChanges: [],
    };

    expect(users).toEqual(expectedUsers);
  });

  it(`should correctly update api review check for ${REVIEW_LABELS.APPROVED} label`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.approved_review_label.json');

    const users = await addOrUpdateAPIReviewCheck(moctokit, payload.pull_request);
    const expectedUsers = {
      approved: [],
      declined: [],
      requestedChanges: [],
    };

    expect(users).toEqual(expectedUsers);
  });

  it(`should correctly update api review check for ${REVIEW_LABELS.DECLINED} label`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.declined_review_label.json');

    const users = await addOrUpdateAPIReviewCheck(moctokit, payload.pull_request);
    const expectedUsers = {
      approved: [],
      declined: [],
      requestedChanges: [],
    };

    expect(users).toEqual(expectedUsers);
  });

  it(`should correctly update api review label if pr contains ${NEW_PR_LABEL} label`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.new-pr_label.json');
    const response = await checkPRReadyForMerge(moctokit, payload.pull_request, undefined);
    expect(response).toEqual(undefined);
  });

  it('should correctly update api review label according to reviews by wg-api', async () => {
    const noReviewLabelPayload = require('./fixtures/api-review-state/pull_request.no_review_label.json');

    // if one or more member of wg-api declined
    const response = await checkPRReadyForMerge(moctokit, noReviewLabelPayload.pull_request, {
      approved: [],
      declined: [' ', ' '],
      requestedChanges: [],
    });
    expect(response).toEqual(undefined);

    // if two or more member of wg-api approved and none of them requested changes
    const response2 = await checkPRReadyForMerge(moctokit, noReviewLabelPayload.pull_request, {
      approved: [' ', ' '],
      declined: [],
      requestedChanges: [],
    });
    expect(response2).toEqual(undefined);

    // in any other case
    const response3 = await checkPRReadyForMerge(moctokit, noReviewLabelPayload.pull_request, {
      approved: [' '],
      declined: [],
      requestedChanges: [' '],
    });
    expect(response3).toEqual(undefined);
  });

  it(`correctly updates api review check when no review labels are found`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.no_review_label.json');

    nock('https://api.github.com')
      .get(
        `/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs?per_page=100`,
      )
      .reply(200, {
        check_runs: [
          {
            name: API_REVIEW_CHECK_NAME,
            id: '12345',
          },
        ],
      });

    const expected = {
      name: API_REVIEW_CHECK_NAME,
      status: 'completed',
      title: 'PR no longer requires API Review',
      conclusion: CheckRunStatus.NEUTRAL,
    };

    nock('https://api.github.com')
      .patch(`/repos/electron/electron/check-runs/12345`, (body) => {
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

  describe('correctly updates API Review data when a PR review is submitted', () => {
    describe('from the base repo', () => {
      it('updates the check when there is one API LGTM', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs?per_page=100`)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = require('./fixtures/api-review-state/pull_request_review/base/review_lgtm.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        const c1 = require('./fixtures/api-review-state/pull_request_review/base/comment_neutral.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: API_REVIEW_CHECK_NAME,
              status: 'in_progress',
              output: {
                summary: `#### Approved

* @codebytere
`,
                title: 'Pending (1/2 LGTMs - ready on 2022-11-08)',
              },
            });
            return true;
          })
          .reply(200);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });

      it('sets the label to APPROVED when there are two API LGTMs and updates the check', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs?per_page=100`)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = require('./fixtures/api-review-state/pull_request_review/base/review_lgtm.json');
        const r2 = require('./fixtures/api-review-state/pull_request_review/base/review_lgtm_2.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1, r2]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: 'API Review',
              head_sha: '7562c752c4352aff581c9b60826de3a3c369f564',
              status: 'in_progress',
              output: {
                summary: `#### Approved

* @codebytere
* @nornagon
`,
                title: 'Pending (2/2 LGTMs - ready on 2022-11-08)',
              },
            });
            return true;
          })
          .reply(200);

        const encoded = encodeURIComponent(REVIEW_LABELS.REQUESTED);
        nock('https://api.github.com')
          .delete(`/repos/electron/electron/issues/${pull_request.number}/labels/${encoded}`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${encoded}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock('https://api.github.com')
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, (body) => {
            expect(body).toEqual([REVIEW_LABELS.APPROVED]);
            return true;
          })
          .reply(200);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });

      it('sets the label to DECLINED when there is one API DECLINED', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs?per_page=100`)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = require('./fixtures/api-review-state/pull_request_review/base/review_declined.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: 'API Review',
              head_sha: '7562c752c4352aff581c9b60826de3a3c369f564',
              status: 'in_progress',
              output: {
                summary: `#### Declined

* @jkleinsc
`,
                title: 'Pending (0/2 LGTMs - ready on 2022-11-08)',
              },
            });
            return true;
          })
          .reply(200);

        const encoded = encodeURIComponent(REVIEW_LABELS.REQUESTED);
        nock('https://api.github.com')
          .delete(`/repos/electron/electron/issues/${pull_request.number}/labels/${encoded}`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${encoded}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock('https://api.github.com')
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, (body) => {
            expect(body).toEqual([REVIEW_LABELS.DECLINED]);
            return true;
          })
          .reply(200);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });
    });

    describe('from a fork repo', () => {
      it('the label remains REQUESTED when there is one API LGTM', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        const r1 = require('./fixtures/api-review-state/pull_request_review/fork/review_lgtm.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        const c1 = require('./fixtures/api-review-state/pull_request_review/fork/comment_neutral.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });

      it('sets the label to APPROVED when there are two API LGTMs', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        const r1 = require('./fixtures/api-review-state/pull_request_review/fork/review_lgtm.json');
        const r2 = require('./fixtures/api-review-state/pull_request_review/fork/review_lgtm_2.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1, r2]);

        const c1 = require('./fixtures/api-review-state/pull_request_review/fork/comment_neutral.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        const encoded = encodeURIComponent(REVIEW_LABELS.REQUESTED);
        nock('https://api.github.com')
          .delete(`/repos/electron/electron/issues/${pull_request.number}/labels/${encoded}`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${encoded}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock('https://api.github.com')
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, (body) => {
            expect(body).toEqual([REVIEW_LABELS.APPROVED]);
            return true;
          })
          .reply(200);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });

      it('sets the label to DECLINED when there is one API DECLINED', async () => {
        const payload = require('./fixtures/api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock('https://api.github.com')
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        const r1 = require('./fixtures/api-review-state/pull_request_review/fork/review_declined.json');
        nock('https://api.github.com')
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${REVIEW_LABELS.REQUESTED}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        const encoded = encodeURIComponent(REVIEW_LABELS.REQUESTED);
        nock('https://api.github.com')
          .delete(`/repos/electron/electron/issues/${pull_request.number}/labels/${encoded}`)
          .reply(200, [
            {
              id: 208045946,
              node_id: 'MDU6TGFiZWwyMDgwNDU5NDY=',
              url: `https://api.github.com/repos/electron/electron/labels/${encoded}`,
              name: REVIEW_LABELS.REQUESTED,
              description: '',
              color: 'f29513',
              default: true,
            },
          ]);

        nock('https://api.github.com')
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock('https://api.github.com')
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, (body) => {
            expect(body).toEqual([REVIEW_LABELS.DECLINED]);
            return true;
          })
          .reply(200);

        await robot.receive({
          id: '123-456',
          name: 'pull_request_review',
          payload,
        });
      });
    });
  });

  it(`adds ${REVIEW_LABELS.REQUESTED} label if pr has semver/major or semver/minor label and no exclusion labels`, async () => {
    const payload = require('./fixtures/api-review-state/pull_request.semver-minor.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([REVIEW_LABELS.REQUESTED]);
        return true;
      })
      .reply(200);
    nock('https://api.github.com')
      .get(
        `/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs?per_page=100`,
      )
      .reply(200, { check_runs: [] });

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('correctly update api review check and api review label when pr is unlabeled', async () => {
    const payload = require('./fixtures/api-review-state/pull_request.unlabeled.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([REVIEW_LABELS.APPROVED]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });
});
