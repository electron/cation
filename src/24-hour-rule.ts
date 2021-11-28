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
  SEMVER_NONE_LABEL,
} from './constants';
import { EventPayloads } from '@octokit/webhooks';
import { addOrUpdateAPIReviewCheck, checkPRReadyForMerge } from './api-review-state';
import { log } from './utils/log-util';
import { addLabels, removeLabel } from './utils/label-utils';
import { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { LogLevel } from './enums';

const CHECK_INTERVAL = 1000 * 60 * 5;

/**
 *
 * @param {EventPayloads.WebhookPayloadPullRequestPullRequest} pr
 * @returns {number} a number representing the minimum open time for the PR
 * based on  its semantic prefix in milliseconds
 */
export const getMinimumOpenTime = (
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
): number => {
  log('getMinimumOpenTime', LogLevel.INFO, `Fetching minimum open time for PR #${pr.number}.`);

  const hasLabel = (label: string) => pr.labels.some((l: any) => l.name === label);

  if (hasLabel(SEMVER_LABELS.MAJOR)) return MINIMUM_MAJOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.MINOR)) return MINIMUM_MINOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.PATCH) || hasLabel(SEMVER_NONE_LABEL)) return MINIMUM_PATCH_OPEN_TIME;

  // If it's not labeled yet, assume it is semver/major and do not remove the label.
  return MINIMUM_MAJOR_OPEN_TIME;
};

/**
 *
 * @param {Context['github']}  github An Octokit instance
 * @param {EventPayloads.WebhookPayloadPullRequestPullRequest} pr
 * @returns {number} a number representing the that cation should use as the
 * open time for the PR in milliseconds, taking draft status into account.
 */
export const getPROpenedTime = async (
  github: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
): Promise<number> => {
  const [owner, repo] = pr.base.repo.full_name.split('/');

  // Fetch PR timeline events.
  const { data: events } = (await github.issues.listEventsForTimeline({
    owner,
    repo,
    issue_number: pr.number,
  })) as RestEndpointMethodTypes['issues']['listEventsForTimeline']['response'];

  // Filter out all except 'Ready For Review' events.
  const readyForReviewEvents = events
    .sort(({ created_at: cA }, { created_at: cB }) => {
      return new Date(cB).getTime() - new Date(cA).getTime();
    })
    .filter(e => e.event === 'ready_for_review');

  // If this PR was a draft PR previously, set its opened time as a function
  // of when it was most recently marked ready for review instead of when it was opened,
  // otherwise return the PR open date.
  return readyForReviewEvents.length > 0
    ? new Date(readyForReviewEvents[0].created_at).getTime()
    : new Date(pr.created_at).getTime();
};

export const shouldPRHaveLabel = async (
  github: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
): Promise<boolean> => {
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

  const created = await getPROpenedTime(github, pr);
  const now = Date.now();

  return now - created < getMinimumOpenTime(pr);
};

export const applyLabelToPR = async (
  github: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
  shouldHaveLabel: boolean,
) => {
  const [owner, repo] = pr.base.repo.full_name.split('/');

  if (shouldHaveLabel) {
    log(
      'applyLabelToPR',
      LogLevel.INFO,
      `Found PR ${owner}/${repo}#${pr.number} - should ensure ${NEW_PR_LABEL} label exists.`,
    );

    await addLabels(github, {
      prNumber: pr.number,
      labels: [NEW_PR_LABEL],
      repo,
      owner,
    });
  } else {
    log(
      'applyLabelToPR',
      LogLevel.INFO,
      `Found PR ${owner}/${repo}#${pr.number} - should ensure ${NEW_PR_LABEL} label does not exist.`,
    );

    try {
      await removeLabel(github, {
        owner,
        repo,
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
  const relevantLabels = [
    NEW_PR_LABEL,
    SEMVER_NONE_LABEL,
    ...Object.values(SEMVER_LABELS),
    ...EXCLUDE_LABELS,
  ];
  return relevantLabels.includes(label.name);
};

export function setUp24HourRule(probot: Probot) {
  probot.on(
    ['pull_request.opened', 'pull_request.unlabeled', 'pull_request.labeled'],
    async context => {
      probot.log('context.octokit', context.octokit);
      const { action, label, pull_request: pr, repository } = context.payload;

      // We only care about user labels adds for new-pr and semver labels.
      if (action === 'pull_request.labeled' && !labelShouldBeChecked(label!)) return;

      probot.log(`24-hour rule received PR: ${repository.full_name}#${pr.number} checking now`);

      const shouldLabel = await shouldPRHaveLabel(context.octokit, pr);

      await applyLabelToPR(context.octokit, pr, shouldLabel);
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
    const octokit = await probot.auth(installId);
    const { data } = await octokit.apps.listReposAccessibleToInstallation({});

    for (const repo of data.repositories) {
      probot.log(`Running 24 hour cron job on repo: ${repo.owner.login}/${repo.name}`);
      let page = 0;
      const prs = [];
      let lastPRCount = -1;
      do {
        lastPRCount = prs.length;
        prs.push(
          ...(
            await octokit.pulls.list({
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
        const shouldLabel = await shouldPRHaveLabel(octokit, pr as any);

        // Ensure that API review labels are updated after waiting period.
        if (!shouldLabel) {
          const approvalState = await addOrUpdateAPIReviewCheck(octokit, pr as any);
          await checkPRReadyForMerge(octokit, pr as any, approvalState);
        }

        await applyLabelToPR(octokit, pr as any, shouldLabel);
      }
    }
  }
}
