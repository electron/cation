import { Probot } from 'probot';
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
} from '../src/constants';

const handler = async ({ app }: { app: Probot }) => {
  setUp24HourRule(app);
};

describe('pr open time', () => {
  let robot: Probot;

  beforeEach(() => {
    nock.disableNetConnect();

    robot = new Probot({
      githubToken: 'test',
      secret: 'secret',
      privateKey: 'private key',
      id: 690857,
    });

    robot.load(handler);
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

  it('correctly returns the time for a missing semver label', async () => {
    const payload = require('./fixtures/pr-open-time/pull_request.semver-missing.json');
    const minTime = getMinimumOpenTime(payload);

    expect(minTime).toEqual(MINIMUM_MAJOR_OPEN_TIME);
  });

  it('correctly determines whether to exclude some PRs from labels', () => {
    const payload = require('./fixtures/pr-open-time/pull_request.should_label.json');

    const shouldLabel = shouldPRHaveLabel(payload);
    expect(shouldLabel).toEqual(false);
  });

  it('correctly determines whether a label if relevant to the decision tree', () => {
    expect(
      labelShouldBeChecked({
        id: 12345,
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
        node_id: 'id',
        url: 'https://api.github.com/repos/electron/electron/labels/semver/minor',
        name: 'semver/minor',
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(true);

    expect(
      labelShouldBeChecked({
        id: 12345,
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
        node_id: 'id',
        url: `https://api.github.com/repos/electron/electron/labels/random`,
        name: 'random',
        color: '6ac2dd',
        default: false,
      }),
    ).toEqual(false);
  });
});
