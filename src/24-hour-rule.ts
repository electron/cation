import { Application, Context } from 'probot';

import {
  NEW_PR_LABEL,
  EXCLUDE_LABELS,
  EXCLUDE_PREFIXES,
  EXCLUDE_USERS,
  SEMVER_LABELS,
  MINIMUM_MAJOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  MINIMUM_MINOR_OPEN_TIME,
} from './constants';
import { EventPayloads } from '@octokit/webhooks';
import { addOrUpdateAPIReviewCheck } from './api-review-state';

const CHECK_INTERVAL = 1000 * 60 * 5;

export function setUp24HourRule(probot: Application) {
  const getMinimumOpenTime = (pr: EventPayloads.WebhookPayloadPullRequestPullRequest): number => {
    if (!pr) throw new Error('Unable to find PR');

    const hasLabel = (label: string) => pr.labels.some((l: any) => l.name === label);

    if (hasLabel(SEMVER_LABELS.MAJOR)) return MINIMUM_MAJOR_OPEN_TIME;
    if (hasLabel(SEMVER_LABELS.MINOR)) return MINIMUM_MINOR_OPEN_TIME;
    if (hasLabel(SEMVER_LABELS.PATCH)) return MINIMUM_PATCH_OPEN_TIME;

    // If it's not labeled yet, assume it is semver/major and do not remove the label.
    return MINIMUM_MAJOR_OPEN_TIME;
  };

  const shouldPRHaveLabel = (pr: EventPayloads.WebhookPayloadPullRequestPullRequest): boolean => {
    if (!pr) throw new Error('Unable to find PR');

    const prefix = pr.title.split(':')[0];
    const backportMatch = pr.title.match(/[bB]ackport/);
    const backportInTitle = backportMatch && backportMatch[0];
    const hasExcludedLabel = pr.labels.some((l: any) => {
      return EXCLUDE_LABELS.includes(l.name) && prefix !== 'feat';
    });

    if (
      EXCLUDE_PREFIXES.includes(prefix) ||
      hasExcludedLabel ||
      backportInTitle ||
      EXCLUDE_USERS.includes(pr.user.login)
    )
      return false;

    const created = new Date(pr.created_at).getTime();
    const now = Date.now();

    return now - created < getMinimumOpenTime(pr);
  };

  const applyLabelToPR = async (
    github: Context['octokit'],
    pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
    repoOwner: string,
    repoName: string,
    shouldHaveLabel: boolean,
  ) => {
    if (!pr) throw new Error('Unable to find PR');

    if (shouldHaveLabel) {
      probot.log(`Found PR: ${repoOwner}/${repoName}#${pr.number} should add label.`);
      await github.issues.addLabels({
        issue_number: pr.number,
        labels: [NEW_PR_LABEL],
        repo: repoName,
        owner: repoOwner,
      });
    } else {
      probot.log(`Found PR: ${repoOwner}/${repoName}#${pr.number} should remove label.`);

      try {
        await github.issues.removeLabel({
          owner: repoOwner,
          repo: repoName,
          issue_number: pr.number,
          name: NEW_PR_LABEL,
        });
        pr.labels = pr.labels.filter(l => l.name !== NEW_PR_LABEL);
        await addOrUpdateAPIReviewCheck(github, pr);
      } catch {
        // Ignore the error here, it's a race condition between the Cron job and GitHub webhooks
      }
    }
  };

  probot.on(
    ['pull_request.opened', 'pull_request.unlabeled', 'pull_request.labeled'],
    async context => {
      const { action, label, pull_request: pr, repository } = context.payload;

      // We only care about user labels adds for new-pr and semver labels.
      if (label && action === 'pull_request.labeled') {
        const relevantLabels = [NEW_PR_LABEL, ...Object.keys(SEMVER_LABELS), ...EXCLUDE_LABELS];
        if (!relevantLabels.includes(label.name)) return;
      }

      probot.log(`24-hour rule received PR: ${repository.full_name}#${pr.number} checking now`);

      await applyLabelToPR(
        context.github,
        pr,
        context.repo({}).owner,
        context.repo({}).repo,
        shouldPRHaveLabel(pr),
      );
    },
  );

  runInterval();

  async function runInterval() {
    probot.log('Running 24 hour rule check');
    const github = await probot.auth();
    const { data: installs } = await github.apps.listInstallations({});
    for (const install of installs) {
      try {
        await runCron(probot, install.id);
      } catch (err) {
        probot.log(`Failed to run cron for install: ${install.id} ${err}`);
      }
    }

    setTimeout(runInterval, CHECK_INTERVAL);
  }

  async function runCron(probot: Application, installId: number) {
    const github = await probot.auth(installId);
    const repos = await github.apps.listReposAccessibleToInstallation({});

    for (const repo of repos.data.repositories) {
      probot.log(`Running 24 hour cron job on repo: ${repo.owner.login}/${repo.name}`);
      let page = 0;
      const prs = [];
      let lastPRCount = -1;
      do {
        lastPRCount = prs.length;
        prs.push(
          ...(
            await github.pulls.list({
              owner: repo.owner.login,
              repo: repo.name,
              per_page: 100,
              state: 'open',
              page,
            })
          ).data,
        );
        page++;
      } while (lastPRCount < prs.length);

      probot.log(`Found ${prs.length} prs for repo: ${repo.owner.login}/${repo.name}`);

      for (const pr of prs) {
        await applyLabelToPR(
          github,
          pr as any,
          repo.owner.login,
          repo.name,
          shouldPRHaveLabel(pr as any),
        );
      }
    }
  }
}
