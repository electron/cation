import { Probot } from 'probot';
import * as nock from 'nock';

import { addBasicPRLabels } from '../src/add-triage-labels';
import { DOCUMENTATION_LABEL, SEMVER_LABELS, SEMVER_NONE_LABEL } from '../src/constants';

const handler = async ({ app }: { app: Probot }) => {
  addBasicPRLabels(app);
};

describe('add-triage-labels', () => {
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
  

  it('adds correct labels to documentation PRs', async () => {
    const payload = require('./fixtures/add-triage-labels/docs_pr_opened.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, body => {
        expect(body).toEqual([SEMVER_LABELS.PATCH, DOCUMENTATION_LABEL]);
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
    const payload = require('./fixtures/add-triage-labels/build_pr_opened.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, body => {
        expect(body).toEqual([SEMVER_NONE_LABEL]);
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
    const payload = require('./fixtures/add-triage-labels/test_pr_opened.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, body => {
        expect(body).toEqual([SEMVER_NONE_LABEL]);
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
    const payload = require('./fixtures/add-triage-labels/ci_pr_opened.json');

    nock('https://api.github.com')
      .get(`/repos/electron/electron/issues/${payload.number}/labels?per_page=100&page=1`)
      .reply(200, []);

    nock('https://api.github.com')
      .post(`/repos/electron/electron/issues/${payload.number}/labels`, body => {
        expect(body).toEqual([SEMVER_NONE_LABEL]);
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