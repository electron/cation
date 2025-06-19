import { Probot, ProbotOctokit } from 'probot';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addBasicPRLabels } from '../src/add-triage-labels';
import { DOCUMENTATION_LABEL, SEMVER_LABELS, SEMVER_NONE_LABEL } from '../src/constants';
import { loadFixture } from './utils';

const GH_API = 'https://api.github.com';

const handler = async (app: Probot) => {
  addBasicPRLabels(app);
};

describe('add-triage-labels', () => {
  let robot: Probot;

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();

    robot = new Probot({
      githubToken: 'test',
      Octokit: ProbotOctokit.defaults({
        retry: { enabled: false },
        throttle: { enabled: false },
      }),
    });

    robot.load(handler);
  });

  afterEach(() => {
    expect(nock.isDone()).toEqual(true);
    nock.cleanAll();
  });

  it('adds correct labels to documentation PRs', async () => {
    const payload = loadFixture('add-triage-labels/docs_pr_opened.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([SEMVER_LABELS.PATCH, DOCUMENTATION_LABEL]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('adds correct labels to build PRs', async () => {
    const payload = loadFixture('add-triage-labels/build_pr_opened.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([SEMVER_NONE_LABEL]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('adds correct labels to test PRs', async () => {
    const payload = loadFixture('add-triage-labels/test_pr_opened.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([SEMVER_NONE_LABEL]);
        return true;
      })
      .reply(200);

    await robot.receive({
      id: '123-456',
      name: 'pull_request',
      payload,
    });
  });

  it('adds correct labels to CI PRs', async () => {
    const payload = loadFixture('add-triage-labels/ci_pr_opened.json');

    nock(GH_API)
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock(GH_API)
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, ({ labels }) => {
        expect(labels).toEqual([SEMVER_NONE_LABEL]);
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
