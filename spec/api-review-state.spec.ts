import { Probot, Context } from 'probot';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  API_SKIP_DELAY_LABEL,
  API_SKIP_REVIEW_LABEL,
  API_WORKING_GROUP,
} from '../src/constants';

import { CheckRunStatus } from '../src/enums';
import { loadFixture } from './utils';

const GH_API = 'https://api.github.com';

const APP_ID = 690857;

const CHECK_RUNS_QUERY = {
  check_name: API_REVIEW_CHECK_NAME,
  app_id: APP_ID,
  per_page: 100,
};

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
  setupAPIReviewStateManagement(app, true);
};

describe('api review', () => {
  let robot: Probot;
  let moctokit: any;

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
    vi.stubEnv('APP_ID', String(APP_ID));
    robot = new Probot({
      githubToken: 'test',
      secret: 'secret',
      privateKey: 'private key',
      appId: APP_ID,
    });

    moctokit = {
      rest: {
        issues: {
          addLabels: vi.fn().mockReturnValue({ data: [] }),
          removeLabel: vi.fn().mockReturnValue({ data: [] }),
          listLabelsOnIssue: vi.fn().mockReturnValue({ data: [] }),
          listComments: vi.fn().mockReturnValue({ data: [] }),
          listEventsForTimeline: vi.fn().mockReturnValue({ data: [] }),
        },
        checks: {
          listForRef: vi.fn().mockReturnValue({ data: { check_runs: [] } }),
          create: vi.fn().mockReturnValue({ data: {} }),
          update: vi.fn().mockReturnValue({ data: {} }),
        },
        teams: {
          listMembersInOrg: vi.fn().mockReturnValue({ data: [] }),
        },
        pulls: {
          listReviews: vi.fn().mockReturnValue({ data: [] }),
        },
      },
      paginate: (endpoint: Function, params: any) => endpoint(params)?.data,
    } as any as Context['octokit'];

    robot.load(handler);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    expect(nock.isDone()).toEqual(true);
    nock.cleanAll();
  });

  it('should returns true for review labels', () => {
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
    const { pull_request } = loadFixture('api-review-state/pull_request.semver-minor.json');

    // Set created_at to yesterday.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    moctokit.rest.issues.listEventsForTimeline = vi.fn().mockReturnValue({ data: [] });

    const expectedTime = pull_request.created_at.getTime() + MINIMUM_MINOR_OPEN_TIME;
    const expectedDate = new Date(expectedTime).toISOString().split('T')[0];
    const readyDate = await getPRReadyDate(moctokit, pull_request);

    expect(readyDate).toEqual(expectedDate);
  });

  it('correctly returns PR ready date when semver-major/semver-minor labels not found', async () => {
    const payload = loadFixture('api-review-state/pull_request.semver-patch.json');

    // Set created_at to yesterday.
    payload.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    moctokit.rest.issues.listEventsForTimeline = vi.fn().mockReturnValue({ data: [] });

    const expectedTime = payload.created_at.getTime() + MINIMUM_PATCH_OPEN_TIME;
    const expectedDate = new Date(expectedTime).toISOString().split('T')[0];
    const readyDate = await getPRReadyDate(moctokit, payload);

    expect(readyDate).toEqual(expectedDate);
  });

  it('correctly returns PR ready date when skip-timeout label is found', async () => {
    const payload = loadFixture('api-review-state/pull_request.api-skip-delay_label.json');

    // Set created_at to yesterday.
    payload.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    moctokit.rest.issues.listEventsForTimeline = vi.fn().mockReturnValue({ data: [] });

    const expectedDate = payload.created_at.toISOString().split('T')[0];
    const readyDate = await getPRReadyDate(moctokit, payload);

    expect(readyDate).toEqual(expectedDate);
  });

  it('correctly returns PR ready date based on ready_for_review event when PR was a draft', async () => {
    const { pull_request } = loadFixture('api-review-state/pull_request.semver-minor.json');

    // PR was created 10 days ago but marked ready 2 days ago.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 10).toISOString();
    const readyForReviewTime = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    moctokit.rest.issues.listEventsForTimeline = vi.fn().mockReturnValue({
      data: [
        {
          event: 'ready_for_review',
          created_at: readyForReviewTime.toISOString(),
        },
      ],
    });

    const expectedTime = readyForReviewTime.getTime() + MINIMUM_MINOR_OPEN_TIME;
    const expectedDate = new Date(expectedTime).toISOString().split('T')[0];
    const readyDate = await getPRReadyDate(moctokit, pull_request);

    expect(readyDate).toEqual(expectedDate);
  });

  const NOT_REQUIRED = {
    name: API_REVIEW_CHECK_NAME,
    status: 'completed',
    conclusion: CheckRunStatus.SUCCESS,
  };

  it('should mark the existing check as not required when PR does not have an API review label', async () => {
    let { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    moctokit.rest.checks.listForRef = vi.fn().mockReturnValue({
      data: {
        check_runs: [
          {
            name: API_REVIEW_CHECK_NAME,
            id: '12345',
            status: 'in_progress',
          },
        ],
      },
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual(undefined);

    expect(moctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();

    expect(moctokit.rest.checks.listForRef).toHaveBeenCalled();
    expect(moctokit.rest.checks.create).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ...NOT_REQUIRED,
        check_run_id: '12345',
        output: {
          title: 'Not required',
          summary: 'This PR does not require API review: it has no API review label.',
        },
      }),
    );
  });

  it('should create a passing check on the base repo when a fork PR does not have an API review label', async () => {
    let { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    pull_request.head.repo = {
      ...pull_request.head.repo,
      name: 'electron-fork',
      full_name: 'contributor/electron-fork',
      owner: { login: 'contributor' },
      fork: true,
    };

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual(undefined);

    expect(moctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();

    expect(moctokit.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'electron', repo: 'electron', ref: pull_request.head.sha }),
    );
    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...NOT_REQUIRED,
        owner: 'electron',
        repo: 'electron',
        head_sha: pull_request.head.sha,
      }),
    );
  });

  it('should create a passing check when a semver-patch PR has no existing check', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );
    pull_request.labels = [{ name: REVIEW_LABELS.REQUESTED }, { name: SEMVER_LABELS.PATCH }];

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual(undefined);

    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...NOT_REQUIRED,
        head_sha: pull_request.head.sha,
        output: {
          title: 'Not required',
          summary: 'This PR does not require API review: it is not semver-minor or semver-major.',
        },
      }),
    );
  });

  it('should create a passing check when a PR has the skip-review label and no existing check', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );
    pull_request.labels = [
      { name: REVIEW_LABELS.REQUESTED },
      { name: SEMVER_LABELS.MINOR },
      { name: API_SKIP_REVIEW_LABEL },
    ];

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual(undefined);

    expect(moctokit.rest.teams.listMembersInOrg).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...NOT_REQUIRED,
        head_sha: pull_request.head.sha,
        output: {
          title: 'Not required',
          summary: `This PR does not require API review: it has the "${API_SKIP_REVIEW_LABEL}" label.`,
        },
      }),
    );
  });

  it('should not write a passing check when the check lookup throws', async () => {
    const { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    moctokit.rest.checks.listForRef = vi.fn().mockRejectedValue(new Error('Server Error'));

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual(undefined);
    expect(moctokit.rest.checks.create).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
  });

  it('should supersede a not required check with a new in-progress run when API review is requested', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    moctokit.rest.checks.listForRef = vi.fn().mockReturnValue({
      data: {
        check_runs: [
          {
            name: API_REVIEW_CHECK_NAME,
            id: '12345',
            status: 'completed',
            conclusion: CheckRunStatus.SUCCESS,
          },
        ],
      },
    });

    await addOrUpdateAPIReviewCheck(moctokit, pull_request);

    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: API_REVIEW_CHECK_NAME,
        head_sha: pull_request.head.sha,
        status: 'in_progress',
      }),
    );
  });

  it('should only look up API Review check runs created by Cation', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    // Simulate the API filtering by app: a same-named run from another app
    // (e.g. a fork PR's Actions job) is only returned when not filtering.
    moctokit.rest.checks.listForRef = vi.fn().mockImplementation(({ app_id }) => ({
      data: {
        check_runs:
          app_id === APP_ID
            ? []
            : [{ name: API_REVIEW_CHECK_NAME, id: '67890', app: { id: 15368 } }],
      },
    }));

    await addOrUpdateAPIReviewCheck(moctokit, pull_request);

    expect(moctokit.rest.checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ check_name: API_REVIEW_CHECK_NAME, app_id: APP_ID }),
    );
    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: API_REVIEW_CHECK_NAME, head_sha: pull_request.head.sha }),
    );
  });

  it('should still return approval state on a fork PR when the Checks API throws', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    pull_request.head.repo = {
      ...pull_request.head.repo,
      name: 'electron-fork',
      full_name: 'contributor/electron-fork',
      owner: { login: 'contributor' },
      fork: true,
    };

    moctokit.rest.checks.create = vi.fn().mockRejectedValue(new Error('Resource not accessible'));
    moctokit.rest.pulls.listReviews.mockReturnValue({
      data: [
        { user: { id: 1, login: 'codebytere' }, body: 'API LGTM', state: 'COMMENTED' },
        { user: { id: 2, login: 'jkleinsc' }, body: 'API LGTM', state: 'COMMENTED' },
      ],
    });
    moctokit.rest.teams.listMembersInOrg.mockReturnValue({
      data: [{ login: 'codebytere' }, { login: 'jkleinsc' }],
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(moctokit.rest.checks.create).toHaveBeenCalled();
    expect(users).toEqual({
      approved: ['codebytere', 'jkleinsc'],
      declined: [],
      requestedChanges: [],
    });

    await checkPRReadyForMerge(moctokit, pull_request, users);
    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: [REVIEW_LABELS.APPROVED] }),
    );
  });

  it('should still return approval state without writing the check when the check lookup throws', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    moctokit.rest.checks.listForRef = vi.fn().mockRejectedValue(new Error('Server Error'));
    moctokit.rest.pulls.listReviews.mockReturnValue({
      data: [{ user: { id: 1, login: 'codebytere' }, body: 'API DECLINED', state: 'COMMENTED' }],
    });
    moctokit.rest.teams.listMembersInOrg.mockReturnValue({
      data: [{ login: 'codebytere' }],
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual({ approved: [], declined: ['codebytere'], requestedChanges: [] });
    expect(moctokit.rest.checks.create).not.toHaveBeenCalled();
    expect(moctokit.rest.checks.update).not.toHaveBeenCalled();
  });

  it(`should correctly parse user approval status for ${REVIEW_LABELS.REQUESTED} label`, async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    moctokit.rest.pulls.listReviews.mockReturnValue({
      data: [
        {
          user: { id: 1, login: 'ckerr' },
          body: 'API CHANGES REQUESTED',
          state: 'CHANGES_REQUESTED',
        },
        {
          user: { id: 2, login: 'codebytere' },
          body: 'API LGTM',
          state: 'APPROVED',
        },
        {
          user: { id: 3, login: 'nornagon' },
          body: 'API LGTM',
          state: 'COMMENTED',
        },
        {
          user: { id: 4, login: 'jkleinsc' },
          body: 'API DECLINED',
          state: 'COMMENTED',
        },
        {
          user: { id: 5, login: 'itsananderson' },
          body: 'API CHANGES REQUESTED',
          state: 'COMMENTED',
        },
      ],
    });

    moctokit.rest.teams.listMembersInOrg.mockReturnValue({
      data: [
        { login: 'codebytere' },
        { login: 'jkleinsc' },
        { login: 'nornagon' },
        { login: 'ckerr' },
        { login: 'itsananderson' },
      ],
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(moctokit.rest.checks.create).toHaveBeenCalledWith({
      head_sha: 'c6b1b7168ab850a47f856c4a30f7a441bede1117',
      name: 'API Review',
      output: {
        summary: `#### Approved

* @codebytere
* @nornagon
#### Requested Changes

* @ckerr
* @itsananderson
#### Declined

* @jkleinsc
`,
        title: 'Pending (2/2 LGTMs - ready on 2020-12-15)',
      },
      owner: 'electron',
      repo: 'electron',
      status: 'in_progress',
    });

    expect(users).toEqual({
      approved: ['codebytere', 'nornagon'],
      declined: ['jkleinsc'],
      requestedChanges: ['ckerr', 'itsananderson'],
    });
  });

  it('should correctly parse user approvals when a previous approver requests changes', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    moctokit.rest.pulls.listReviews.mockReturnValue({
      data: [
        {
          user: { id: 1, login: 'nornagon' },
          body: 'API LGTM',
          state: 'COMMENTED',
        },
        {
          user: { id: 2, login: 'jkleinsc' },
          body: 'API LGTM',
          state: 'COMMENTED',
          submitted_at: '2020-12-09T01:24:55Z',
        },
        {
          user: { id: 2, login: 'jkleinsc' },
          body: 'API CHANGES REQUESTED',
          state: 'COMMENTED',
          submitted_at: '2020-12-10T01:24:55Z',
        },
      ],
    });

    moctokit.rest.teams.listMembersInOrg.mockReturnValue({
      data: [{ login: 'jkleinsc' }, { login: 'nornagon' }],
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual({
      approved: ['nornagon'],
      declined: [],
      requestedChanges: ['jkleinsc'],
    });
  });

  it('should correctly parse user approvals when a reviewer requests changes and then approves', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    moctokit.rest.pulls.listReviews.mockReturnValue({
      data: [
        {
          user: { id: 2, login: 'marshallofsound' },
          body: 'API CHANGES REQUESTED',
          state: 'COMMENTED',
          submitted_at: '2020-12-09T01:24:55Z',
        },
        {
          user: { id: 2, login: 'marshallofsound' },
          body: 'API LGTM',
          state: 'COMMENTED',
          submitted_at: '2020-12-10T01:24:55Z',
        },
      ],
    });

    moctokit.rest.teams.listMembersInOrg.mockReturnValue({
      data: [{ login: 'marshallofsound' }],
    });

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual({
      approved: ['marshallofsound'],
      declined: [],
      requestedChanges: [],
    });
  });

  it(`should correctly update api review check for ${REVIEW_LABELS.APPROVED} label`, async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.approved_review_label.json',
    );

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual({
      approved: [],
      declined: [],
      requestedChanges: [],
    });
  });

  it(`should correctly update api review check for ${REVIEW_LABELS.DECLINED} label`, async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.declined_review_label.json',
    );

    const users = await addOrUpdateAPIReviewCheck(moctokit, pull_request);
    expect(users).toEqual({
      approved: [],
      declined: [],
      requestedChanges: [],
    });
  });

  it('should not update api review label if the PR has not passed its minimum open time', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    // Set created_at to yesterday.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24).toISOString();

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc', 'codebytere'],
      declined: [],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('should not update api review label if the PR was marked ready for review within its minimum open time', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    // PR was created 10 days ago but marked ready 2 days ago.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 10).toISOString();
    moctokit.rest.issues.listEventsForTimeline = vi.fn().mockReturnValue({
      data: [
        {
          event: 'ready_for_review',
          created_at: new Date(+new Date() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        },
      ],
    });

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc', 'codebytere'],
      declined: [],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it('should update api review label once the PR has passed its minimum open time', async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    // Set created_at to 8 days ago.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 8).toISOString();

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc', 'codebytere'],
      declined: [],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: pull_request.number,
      labels: [REVIEW_LABELS.APPROVED],
      owner: 'electron',
      repo: 'electron',
    });
  });

  it(`should update api review label within the minimum open time if the PR has ${API_SKIP_DELAY_LABEL}`, async () => {
    const { pull_request } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );

    // Set created_at to yesterday.
    pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24).toISOString();
    pull_request.labels.push({ name: API_SKIP_DELAY_LABEL });

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc', 'codebytere'],
      declined: [],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: pull_request.number,
      labels: [REVIEW_LABELS.APPROVED],
      owner: 'electron',
      repo: 'electron',
    });
  });

  it(`should update api review label for ${REVIEW_LABELS.DECLINED}`, async () => {
    const { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: [],
      declined: ['jkleinsc', 'codebytere'],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: pull_request.number,
      labels: [REVIEW_LABELS.DECLINED],
      owner: 'electron',
      repo: 'electron',
    });
  });

  it(`should update API review label for ${REVIEW_LABELS.APPROVED}`, async () => {
    const { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc', 'codebytere'],
      declined: [],
      requestedChanges: [],
    });

    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: pull_request.number,
      labels: [REVIEW_LABELS.APPROVED],
      owner: 'electron',
      repo: 'electron',
    });
  });

  it(`should set ${REVIEW_LABELS.REQUESTED} when there is one API LGTM and one request changes`, async () => {
    const { pull_request } = loadFixture('api-review-state/pull_request.no_review_label.json');

    await checkPRReadyForMerge(moctokit, pull_request, {
      approved: ['jkleinsc'],
      declined: [],
      requestedChanges: ['nornagon'],
    });

    expect(moctokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(moctokit.rest.issues.addLabels).toHaveBeenCalledWith({
      issue_number: pull_request.number,
      labels: [REVIEW_LABELS.REQUESTED],
      owner: 'electron',
      repo: 'electron',
    });
  });

  it(`correctly updates api review check when no review labels are found`, async () => {
    const payload = loadFixture('api-review-state/pull_request.no_review_label.json');

    nock(GH_API)
      .get(`/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs`)
      .query(CHECK_RUNS_QUERY)
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
      output: {
        title: 'Not required',
        summary: 'This PR does not require API review: it has no API review label.',
      },
      conclusion: CheckRunStatus.SUCCESS,
    };

    nock(GH_API)
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

  it('correctly returns PR ready date when skip-review label is found', async () => {
    const payload = loadFixture('api-review-state/pull_request.api-skip-review_label.json');

    nock(GH_API)
      .get(`/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs`)
      .query(CHECK_RUNS_QUERY)
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
      output: {
        title: 'Not required',
        summary: 'This PR does not require API review: it has no API review label.',
      },
      conclusion: CheckRunStatus.SUCCESS,
    };

    nock(GH_API)
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
        const payload = loadFixture('api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = loadFixture('api-review-state/pull_request_review/base/review_lgtm.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        const c1 = loadFixture('api-review-state/pull_request_review/base/comment_neutral.json');
        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
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
        const payload = loadFixture('api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = loadFixture('api-review-state/pull_request_review/base/review_lgtm.json');
        const r2 = loadFixture('api-review-state/pull_request_review/base/review_lgtm_2.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1, r2]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
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

        nock(GH_API)
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
        nock(GH_API)
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

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock(GH_API)
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, ({ labels }) => {
            expect(labels).toEqual([REVIEW_LABELS.APPROVED]);
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
        const payload = loadFixture('api-review-state/pull_request_review/base/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, {
            check_runs: [
              {
                name: API_REVIEW_CHECK_NAME,
                id: '12345',
              },
            ],
          });

        const r1 = loadFixture('api-review-state/pull_request_review/base/review_declined.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
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

        nock(GH_API)
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
        nock(GH_API)
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

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock(GH_API)
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, ({ labels }) => {
            expect(labels).toEqual([REVIEW_LABELS.DECLINED]);
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
        const payload = loadFixture('api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, { check_runs: [] });

        const r1 = loadFixture('api-review-state/pull_request_review/fork/review_lgtm.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        const c1 = loadFixture('api-review-state/pull_request_review/fork/comment_neutral.json');
        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: API_REVIEW_CHECK_NAME,
              head_sha: pull_request.head.sha,
              status: 'in_progress',
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

      it('sets the label to APPROVED when there are two API LGTMs', async () => {
        const payload = loadFixture('api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, { check_runs: [] });

        const r1 = loadFixture('api-review-state/pull_request_review/fork/review_lgtm.json');
        const r2 = loadFixture('api-review-state/pull_request_review/fork/review_lgtm_2.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1, r2]);

        const c1 = loadFixture('api-review-state/pull_request_review/fork/comment_neutral.json');
        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, [c1]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: API_REVIEW_CHECK_NAME,
              head_sha: pull_request.head.sha,
              status: 'in_progress',
            });
            return true;
          })
          .reply(200);

        nock(GH_API)
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
        nock(GH_API)
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

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock(GH_API)
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, ({ labels }) => {
            expect(labels).toEqual([REVIEW_LABELS.APPROVED]);
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
        const payload = loadFixture('api-review-state/pull_request_review/fork/submitted.json');
        const { pull_request } = payload;

        nock(GH_API)
          .get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`)
          .reply(200, API_WORKING_GROUP_MEMBERS);

        nock(GH_API)
          .get(`/repos/electron/electron/commits/${pull_request.head.sha}/check-runs`)
          .query(CHECK_RUNS_QUERY)
          .reply(200, { check_runs: [] });

        const r1 = loadFixture('api-review-state/pull_request_review/fork/review_declined.json');
        nock(GH_API)
          .get(`/repos/electron/electron/pulls/${pull_request.number}/reviews`)
          .reply(200, [r1]);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/comments`)
          .reply(200, []);

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/timeline`)
          .times(2)
          .reply(200, []);

        nock(GH_API)
          .post('/repos/electron/electron/check-runs', (body) => {
            expect(body).toMatchObject({
              name: API_REVIEW_CHECK_NAME,
              head_sha: pull_request.head.sha,
              status: 'in_progress',
            });
            return true;
          })
          .reply(200);

        nock(GH_API)
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
        nock(GH_API)
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

        nock(GH_API)
          .get(`/repos/electron/electron/issues/${pull_request.number}/labels?per_page=100&page=1`)
          .reply(200, []);

        nock(GH_API)
          .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, ({ labels }) => {
            expect(labels).toEqual([REVIEW_LABELS.DECLINED]);
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
    const payload = loadFixture('api-review-state/pull_request.semver-minor.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([REVIEW_LABELS.REQUESTED]);
        return true;
      })
      .reply(200);

    nock(GH_API)
      .get(`/repos/electron/electron/commits/${payload.pull_request.head.sha}/check-runs`)
      .query(CHECK_RUNS_QUERY)
      .reply(200, { check_runs: [] });

    // This event's payload predates the requested label, so the check is marked
    // not required here and then superseded by the labeled event for that label.
    nock(GH_API)
      .post('/repos/electron/electron/check-runs', (body) => {
        expect(body).toMatchObject({
          name: API_REVIEW_CHECK_NAME,
          head_sha: payload.pull_request.head.sha,
          conclusion: CheckRunStatus.SUCCESS,
        });
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('adds the API requested label if a PR is marked ready for review', async () => {
    const payload = loadFixture('api-review-state/pull_request.ready_for_review.json');
    const { pull_request } = payload;

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, [
        {
          id: 1034512799,
          node_id: 'MDU6TGFiZWwxMDM0NTEyNzk5',
          url: 'https://api.github.com/repos/electron/electron/labels/semver/minor',
          name: 'semver/minor',
          color: '6ac2dd',
          default: false,
          description: 'backwards-compatible bug fixes',
        },
      ]);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${pull_request.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([REVIEW_LABELS.REQUESTED]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('removes the API requested label if a PR is put in draft mode', async () => {
    const payload = loadFixture('api-review-state/pull_request.converted_to_draft.json');
    const { pull_request } = payload;

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, [
        {
          id: 1034512799,
          node_id: 'MDU6TGFiZWwxMDM0NTEyNzk5',
          url: 'https://api.github.com/repos/electron/electron/labels/semver/minor',
          name: 'semver/minor',
          color: '6ac2dd',
          default: false,
          description: 'backwards-compatible bug fixes',
        },
        {
          id: 1603621692,
          node_id: 'MDU6TGFiZWwxNjAzNjIxNjky',
          url: 'https://api.github.com/repos/electron/electron/labels/api-review/requested%20%F0%9F%97%B3',
          name: REVIEW_LABELS.REQUESTED,
          color: 'c918ba',
          default: false,
          description: '',
        },
      ]);

    const encoded = encodeURIComponent(REVIEW_LABELS.REQUESTED);
    nock(GH_API)
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

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('correctly updates API review check and API review label when pr is unlabeled', async () => {
    const payload = loadFixture('api-review-state/pull_request.unlabeled.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([REVIEW_LABELS.APPROVED]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('continues the cron pass past a PR that fails to update', async () => {
    const { pull_request: failingPR } = loadFixture(
      'api-review-state/pull_request.requested_review_label.json',
    );
    const passingPR = {
      ...failingPR,
      number: failingPR.number + 1,
      head: { ...failingPR.head, sha: 'b7d7b8b1a1a0e6c0bdb56b2f6b0c4d2b1e0a9f31' },
      labels: [{ name: REVIEW_LABELS.REQUESTED }],
    };

    nock(GH_API)
      .get('/app/installations')
      .reply(200, [{ id: 1 }]);

    nock(GH_API)
      .get('/installation/repositories')
      .reply(200, { repositories: [{ name: 'electron', owner: { login: 'electron' } }] });

    nock(GH_API)
      .get('/repos/electron/electron/pulls')
      .query({ per_page: 100, state: 'open' })
      .reply(200, [failingPR, passingPR]);

    // The first PR throws while fetching API WG members.
    nock(GH_API)
      .get(`/repos/electron/electron/commits/${failingPR.head.sha}/check-runs`)
      .query(CHECK_RUNS_QUERY)
      .reply(200, { check_runs: [] });

    nock(GH_API).get(`/orgs/electron/teams/${API_WORKING_GROUP}/members`).reply(404);

    // The second PR is no longer semver-minor, so its check is marked not required.
    nock(GH_API)
      .get(`/repos/electron/electron/commits/${passingPR.head.sha}/check-runs`)
      .query(CHECK_RUNS_QUERY)
      .reply(200, { check_runs: [{ name: API_REVIEW_CHECK_NAME, id: '12345' }] });

    nock(GH_API)
      .patch('/repos/electron/electron/check-runs/12345', (body) => {
        expect(body).toMatchObject({ conclusion: CheckRunStatus.SUCCESS });
        return true;
      })
      .reply(200);

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    try {
      robot.load((app: Probot) => setupAPIReviewStateManagement(app));

      // The pass is complete once the next interval is scheduled.
      const nextRun = await vi.waitFor(() => {
        const index = setTimeoutSpy.mock.calls.findIndex(([, ms]) => ms === 1000 * 60 * 5);
        expect(index).not.toEqual(-1);
        return setTimeoutSpy.mock.results[index].value;
      });
      clearTimeout(nextRun);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
