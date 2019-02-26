import { Application } from 'probot';

import { NEW_PR_LABEL, MINIMUM_OPEN_TIME, BACKPORT_LABEL } from '../constants';

const CHECK_INTERVAL = 1000 * 60;

export function setUp24HourRule(probot: Application) {
  probot.on(['pull_request.opened', 'pull_request.unlabeled'], async context => {
    const pr = context.payload.pull_request;
    const excludedLabels = [NEW_PR_LABEL, BACKPORT_LABEL];
    const excludedPrefixes = ['build', 'ci'];

    const prefix = pr.title.split(':')[0];
    const hasExcludedLabel = pr.labels.some((l: any) => excludedLabels.includes(l.name));
    if (excludedPrefixes.includes(prefix) || hasExcludedLabel) return;

    probot.log(
      'received PR:',
      `${context.payload.repository.full_name}#${pr.number}`,
      'checking now',
    );

    const created = new Date(pr.created_at).getTime();
    const now = Date.now();
    const shouldAdd = now - created < MINIMUM_OPEN_TIME;

    if (shouldAdd) {
      context.github.issues.addLabels(
        context.repo({
          number: context.payload.pull_request.number,
          labels: [NEW_PR_LABEL],
        }),
      );
    }
  });

  runInterval();

  setInterval(runInterval, CHECK_INTERVAL);

  async function runInterval() {
    probot.log('Running 24 hour rule check');
    const github = await probot.auth();
    const { data: installs } = await github.apps.listInstallations({});
    for (const install of installs) {
      await runCron(probot, install.id);
    }
  }
}

async function runCron(probot: Application, installId: number) {
  const github = await probot.auth(installId);
  const repos = await github.apps.listRepos({});

  for (const repo of repos.data.repositories) {
    probot.log('Running 24 hour cron job on repo:', `${repo.owner.login}/${repo.name}`);
    // TODO: Paginate the PR list
    const prs = await github.pullRequests.list({
      owner: repo.owner.login,
      repo: repo.name,
      per_page: 100,
      state: 'open',
    });

    for (const pr of prs.data) {
      if (!pr.labels.some(l => l.name === NEW_PR_LABEL)) continue;
      const created = new Date(pr.created_at).getTime();
      const now = Date.now();
      const shouldRemove = now - created >= MINIMUM_OPEN_TIME;

      if (shouldRemove) {
        probot.log(
          'Found PR:',
          `${repo.owner.login}/${repo.name}#${pr.number}`,
          `created ${now - created} ms ago`,
          'therefore removing label.',
        );

        await github.issues.removeLabel({
          owner: repo.owner.login,
          repo: repo.name,
          number: pr.number,
          name: NEW_PR_LABEL,
        });
      }
    }
  }
}
