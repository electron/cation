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
import { PullRequest, Label, PullRequestLabeledEvent } from '@octokit/webhooks-types';
import { addOrUpdateAPIReviewCheck, checkPRReadyForMerge } from './api-review-state';
import { log } from './utils/log-util';
import { addLabels, removeLabel } from './utils/label-utils';
import { LogLevel } from './enums';

const CHECK_INTERVAL = 1000 * 60 * 5;

/**
 * @returns a number representing the minimum open time for the PR
 * based on  its semantic prefix in milliseconds
 */
export const getMinimumOpenTime = (pr: PullRequest): number => {
  log('getMinimumOpenTime', LogLevel.INFO, `Fetching minimum open time for PR #${pr.number}.`);

  const hasLabel = (label: string) => pr.labels.some((l) => l.name === label);

  if (hasLabel(SEMVER_LABELS.MAJOR)) return MINIMUM_MAJOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.MINOR)) return MINIMUM_MINOR_OPEN_TIME;
  if (hasLabel(SEMVER_LABELS.PATCH) || hasLabel(SEMVER_NONE_LABEL)) return MINIMUM_PATCH_OPEN_TIME;

  // If it's not labeled yet, assume it is semver/major and do not remove the label.
  return MINIMUM_MAJOR_OPEN_TIME;
};

/**
 * @param github - An Octokit instance
 * @returns a number representing the that cation should use as the
 * open time for the PR in milliseconds, taking draft status into account.
 */
export const getPROpenedTime = async (
  github: Context['octokit'],
  pr: PullRequest,
): Promise<number> => {
  const [owner, repo] = pr.base.repo.full_name.split('/');

  // Fetch PR timeline events.
  const { data: events } = await github.issues.listEventsForTimeline({
    owner,
    repo,
    issue_number: pr.number,
  });

  // Filter out all except 'Ready For Review' events.
  const readyForReviewEvents = events
    .filter((e) => e.event === 'ready_for_review')
    .sort((a, b) => {
      if ('created_at' in a && 'created_at' in b) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return 0;
    });

  // If this PR was a draft PR previously, set its opened time as a function
  // of when it was most recently marked ready for review instead of when it was opened,
  // otherwise return the PR open date.
  return readyForReviewEvents.length > 0 && 'created_at' in readyForReviewEvents[0]
    ? new Date(readyForReviewEvents[0].created_at).getTime()
    : new Date(pr.created_at).getTime();
};

export const shouldPRHaveLabel = async (
  github: Context['octokit'],
  pr: PullRequest,
): Promise<boolean> => {
  log('shouldPRHaveLabel', LogLevel.INFO, `Checking whether #${pr.number} should have label.`);

  const prefix = pr.title.split(':')[0];
  const backportMatch = pr.title.match(/[bB]ackport/);
  const backportInTitle = backportMatch && backportMatch[0];
  const hasExcludedLabel = pr.labels.some((label) => EXCLUDE_LABELS.includes(label.name));

  if (
    EXCLUDE_PREFIXES.includes(prefix) ||
    hasExcludedLabel ||
    backportInTitle ||
    EXCLUDE_USERS.includes(pr.user.login) ||
    pr.merged
  )
    return false;

  const created = await getPROpenedTime(github, pr);
  const now = Date.now();

  return now - created < getMinimumOpenTime(pr);
};

export const applyLabelToPR = async (
  github: Context['octokit'],
  pr: PullRequest,
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

      pr.labels = pr.labels.filter((l) => l.name !== NEW_PR_LABEL);
      await addOrUpdateAPIReviewCheck(github, pr);
    } catch {
      // Ignore the error here, it's a race condition between the Cron job and GitHub webhooks
    }
  }
};

// Returns whether or not a label is relevant to the new-pr decision tree.
export const labelShouldBeChecked = (label: Label) => {
  const relevantLabels = [
    NEW_PR_LABEL,
    SEMVER_NONE_LABEL,
    ...Object.values(SEMVER_LABELS),
    ...EXCLUDE_LABELS,
  ];
  return relevantLabels.includes(label.name);
};

export async function setUp24HourRule(probot: Probot, disableCronForTesting = false) {
  probot.on(
    ['pull_request.opened', 'pull_request.unlabeled', 'pull_request.labeled'],
    async (context: Context<'pull_request'>) => {
      const { action, pull_request: pr, repository } = context.payload;

      // We only care about user labels adds for new-pr and semver labels.
      if (action === 'labeled' || action === 'unlabeled') {
        const { label } = context.payload as PullRequestLabeledEvent;
        if (!labelShouldBeChecked(label!)) return;
      }

      probot.log.info(
        `24-hour rule received PR: ${repository.full_name}#${pr.number} checking now`,
      );

      const shouldLabel = await shouldPRHaveLabel(context.octokit, pr);

      await applyLabelToPR(context.octokit, pr, shouldLabel);
    },
  );

  if (!disableCronForTesting) runInterval();

  async function runInterval() {
    probot.log.info('Running 24 hour rule check');
    const github = await probot.auth();
    const { data: installs } = await github.apps.listInstallations({});
    for (const install of installs) {
      try {
        await runCron(probot, install.id);
      } catch (err) {
        probot.log.info(`Failed to run cron for install: ${install.id} ${err}`);
      }
    }

    setTimeout(runInterval, CHECK_INTERVAL);
  }

  async function runCron(probot: Probot, installId: number) {
    const octokit = await probot.auth(installId);
    const { data } = await octokit.apps.listReposAccessibleToInstallation({});

    for (const repo of data.repositories) {
      probot.log.info(`Running 24 hour cron job on repo: ${repo.owner.login}/${repo.name}`);
      let page = 0;
      const prs: PullRequest[] = [];
      let lastPRCount = -1;
      do {
        lastPRCount = prs.length;
        prs.push(
          ...((
            await octokit.pulls.list({
              owner: repo.owner.login,
              repo: repo.name,
              per_page: 100,
              state: 'open',
              page,
            })
          ).data as PullRequest[]),
        );
        page++;
      } while (lastPRCount < prs.length);

      probot.log.info(`Found ${prs.length} prs for repo: ${repo.owner.login}/${repo.name}`);

      for (const pr of prs) {
        const shouldLabel = await shouldPRHaveLabel(octokit, pr);

        // Ensure that API review labels are updated after waiting period.
        if (!shouldLabel) {
          const approvalState = await addOrUpdateAPIReviewCheck(octokit, pr);
          await checkPRReadyForMerge(octokit, pr, approvalState);
        }

        await applyLabelToPR(octokit, pr, shouldLabel);
      }
    }
  }
}
