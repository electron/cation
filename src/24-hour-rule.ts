import { Context, Probot } from 'probot';

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
import { log } from './utils/log-util';
import { addLabels, removeLabel } from './utils/label-utils';
import { LogLevel } from './enums';

const CHECK_INTERVAL = 1000 * 60 * 5;

export const getMinimumOpenTime = (
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
): number => {
  log('getMinimumOpenTime', LogLevel.INFO, `Fetching minimum open time for PR #${pr.number}.`);

  const hasLabel = (label: string) => pr.labels.some((l: any) => l.name === label);

  if (hasLabel(SEMVER_LABELS.MAJOR)) return MINIMUM_MAJOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.MINOR)) return MINIMUM_MINOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.PATCH)) return MINIMUM_PATCH_OPEN_TIME;

  // If it's not labeled yet, assume it is semver/major and do not remove the label.
  return MINIMUM_MAJOR_OPEN_TIME;
};

export const shouldPRHaveLabel = (
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
): boolean => {
  log('shouldPRHaveLabel', LogLevel.INFO, `Checking whether #${pr.number} should have label.`);

  const prefix = pr.title.split(':')[0];
  const backportMatch = pr.title.match(/[bB]ackport/);
  const backportInTitle = backportMatch && backportMatch[0];
  const hasExcludedLabel = pr.labels.some((label: any) => EXCLUDE_LABELS.includes(label.name));

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

export const applyLabelToPR = async (
  github: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
  repoOwner: string,
  repoName: string,
  shouldHaveLabel: boolean,
) => {
  if (shouldHaveLabel) {
    log(
      'applyLabelToPR',
      LogLevel.INFO,
      `Found PR ${repoOwner}/${repoName}#${pr.number} - should ensure ${NEW_PR_LABEL} label exists.`,
    );

    await addLabels(github, {
      prNumber: pr.number,
      labels: [NEW_PR_LABEL],
      repo: repoName,
      owner: repoOwner,
    });
  } else {
    log(
      'applyLabelToPR',
      LogLevel.INFO,
      `Found PR ${repoOwner}/${repoName}#${pr.number} - should ensure ${NEW_PR_LABEL} label does not exist.`,
    );

    try {
      await removeLabel(github, {
        owner: repoOwner,
        repo: repoName,
        prNumber: pr.number,
        name: NEW_PR_LABEL,
      });

      pr.labels = pr.labels.filter(l => l.name !== NEW_PR_LABEL);
      await addOrUpdateAPIReviewCheck(github, pr);
    } catch {
      // Ignore the error here, it's a race condition between the Cron job and GitHub webhooks
    }
  }
};

// Returns whether or not a label is relevant to the new-pr decision tree.
export const labelShouldBeChecked = (label: EventPayloads.WebhookPayloadPullRequestLabel) => {
  const relevantLabels = [NEW_PR_LABEL, ...Object.values(SEMVER_LABELS), ...EXCLUDE_LABELS];
  return relevantLabels.includes(label.name);
};

export function setUp24HourRule(probot: Probot) {
  probot.on(
    ['pull_request.opened', 'pull_request.unlabeled', 'pull_request.labeled'],
    async context => {
      const { action, label, pull_request: pr, repository } = context.payload;

      // We only care about user labels adds for new-pr and semver labels.
      if (action === 'pull_request.labeled' && !labelShouldBeChecked(label!)) return;

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

  async function runCron(probot: Probot, installId: number) {
    const github = await probot.auth(installId);
    const { data } = await github.apps.listReposAccessibleToInstallation({});

    for (const repo of data.repositories) {
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
