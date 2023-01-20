import { Context, Probot } from 'probot';
import * as nock from 'nock';

import {
  setUp24HourRule,
  getMinimumOpenTime,
  shouldPRHaveLabel,
  labelShouldBeChecked,
} from '../src/24-hour-rule';
import {
  BACKPORT_LABEL,
  BACKPORT_SKIP_LABEL,
  FAST_TRACK_LABEL,
  MINIMUM_MAJOR_OPEN_TIME,
  MINIMUM_MINOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  NEW_PR_LABEL,
  SEMVER_LABELS,
  SEMVER_NONE_LABEL,
} from '../src/constants';

const handler = async (app: Probot) => {
  setUp24HourRule(app, true);
};

describe('pr open time', () => {
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
        listEventsForTimeline: jest.fn().mockReturnValue({ data: [] }),
      },
    } as any as Context['octokit'];

    robot.load(handler);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('correctly returns the time for a semver-patch label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-patch.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_PATCH_OPEN_TIME);
  });

  it('correctly returns the time for a semver-minor label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-minor.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_MINOR_OPEN_TIME);
  });

  it('correctly returns the time for a semver-major label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-major.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_MAJOR_OPEN_TIME);
  });

  it('correctly returns the time for a semver-none label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-none.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_PATCH_OPEN_TIME);
  });

  it('correctly returns the time for a missing semver label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-missing.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_MAJOR_OPEN_TIME);
  });

  it('correctly determines whether to exclude some PRs from labels', async () => {
    const noLabelPayload = require('./fixtures/pr-open-time/pull_request.should_not_label.json');
    const yesLabelPayload = require('./fixtures/pr-open-time/pull_request.should_label.json');

    // Set created_at to yesterday.
    yesLabelPayload.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    const yesLabel = await shouldPRHaveLabel(moctokit, yesLabelPayload);
    const noLabel = await shouldPRHaveLabel(moctokit, noLabelPayload);

    expect(yesLabel).toEqual(true);
    expect(noLabel).toEqual(false);
  });

  it('does not add the new-pr label to merged PRs', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.should_label.json');
    payload.merged = true;

    const label = await shouldPRHaveLabel(moctokit, payload);
    expect(label).toEqual(false);
  });

  it('correctly determines whether a label if relevant to the decision tree', () => {
    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${NEW_PR_LABEL}`,
        name: NEW_PR_LABEL,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${SEMVER_LABELS.MINOR}`,
        name: SEMVER_LABELS.MINOR,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${SEMVER_LABELS.PATCH}`,
        name: SEMVER_LABELS.PATCH,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${SEMVER_LABELS.MAJOR}`,
        name: SEMVER_LABELS.PATCH,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${SEMVER_NONE_LABEL}`,
        name: SEMVER_NONE_LABEL,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${BACKPORT_LABEL}`,
        name: BACKPORT_LABEL,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${BACKPORT_SKIP_LABEL}`,
        name: BACKPORT_SKIP_LABEL,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/${FAST_TRACK_LABEL}`,
        name: FAST_TRACK_LABEL,
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
        description: '',
        node_id: 'id',
        url: 'https://api.github.com/repos/electron/electron/labels/random',
        name: 'random',
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(false);
  });

  it(`can add a ${NEW_PR_LABEL} label to a pull request`, async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.opened.json');

    // Set created_at to yesterday.
    payload.pull_request.created_at = new Date(+new Date() - 1000 * 60 * 60 * 24 * 2);

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/timeline`)
      .reply(200, []);

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, [{ name: 'one' }, { name: 'two' }]);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([NEW_PR_LABEL]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it(`takes draft status into account when adding a ${NEW_PR_LABEL} label`, async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.opened.json');

    // Set created_at to 5 days ago.
    const msInADay = 1638370929101;
    payload.pull_request.created_at = new Date(+new Date() - msInADay * 5);

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/timeline`)
      .reply(200, [
        {
          actor_name: 'codebytere',
          created_at: new Date(+new Date() - 1000 * 60 * 60 * 24 * 2),
          type: 'ready_for_review',
        },
      ]);

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, [{ name: 'one' }, { name: 'two' }]);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, (body) => {
        expect(body).toEqual([NEW_PR_LABEL]);
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
