import { Probot } from 'probot';
import * as nock from 'nock';

process.env.DISABLE_WEBHOOK_EVENT_CHECK = 'true';

import { setUp24HourRule } from '../src/24-hour-rule';

const handler = async ({ app }: { app: Probot }) => {
  setUp24HourRule(app);
};

describe('semver-enforcement', () => {
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

  it('correctly responds to a missing semver label', async () => {
    const payload = require('./fixtures/semver-enforcement/pull_request.opened.json');

    const expected = {
      name: 'Semver Label Enforcement',
      head_sha: '578fd4af98861ef7e6374d7d1fa1ccca6bc7136d',
      status: 'in_progress',
      output: {
        title: 'No semver/* label found',
        summary: "We couldn't find a semver/* label, please add one",
      },
    };

    nock('https://api.github.com')
      .post('/repos/electron/electron/check-runs', body => {
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
});
