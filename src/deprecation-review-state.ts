import * as fs from 'fs';
import * as path from 'path';

import { Context, Probot, ProbotOctokit } from 'probot';
import { log } from './utils/log-util';
import { DEPRECATION_REVIEW_CHECK_NAME, DEPRECATION_REVIEW_LABELS } from './constants';
import { CheckRunStatus, LogLevel } from './enums';
import { getEnvVar } from './utils/env-util';
import { IssueCommentEvent, PullRequest } from './types';
import { Endpoints } from '@octokit/types';
import { addLabels, removeLabel } from './utils/label-utils';

const checkTitles = {
  [DEPRECATION_REVIEW_LABELS.COMPLETE]: 'Complete',
  [DEPRECATION_REVIEW_LABELS.REQUESTED]: 'Pending',
};

const isBot = (user: string) => user === getEnvVar('BOT_USER_NAME', 'bot');
export const isReviewLabel = (label: string) =>
  Object.values(DEPRECATION_REVIEW_LABELS).includes(label);

export const isChecklistComment = (comment: IssueCommentEvent) => {
  const { user, body } = comment;
  if (!user) return false;
  return isBot(user.login) && body.startsWith('## 🪦 Deprecation Checklist');
};

export async function addOrUpdateDeprecationReviewCheck(octokit: ProbotOctokit, pr: PullRequest) {
  log(
    'addOrUpdateDeprecationReviewCheck',
    LogLevel.INFO,
    `Validating ${pr.number} by ${pr.user.login}`,
  );

  if (!pr.head.repo) {
    log(
      'addOrUpdateDeprecationReviewCheck',
      LogLevel.WARN,
      `PR #${pr.number} does not have a head repo - cannot update check`,
    );
    return;
  }

  const owner = pr.base.repo.owner.login;
  const repo = pr.head.repo.name;

  if (pr.head.repo.fork) {
    log(
      'addOrUpdateDeprecationReviewCheck',
      LogLevel.INFO,
      `${pr.number} is a fork - checks will not be created or updated`,
    );
    // If the PR is a fork PR, return early as the Checks API doesn't work.
    return;
  }

  // Fetch the latest Deprecation Review check for the PR.
  const checkRun = (
    await octokit.rest.checks.listForRef({
      ref: pr.head.sha,
      per_page: 100,
      owner,
      repo,
    })
  ).data.check_runs.find((run) => run.name === DEPRECATION_REVIEW_CHECK_NAME);

  const resetToNeutral = async () => {
    if (!checkRun) return;
    return await octokit.rest.checks.update({
      owner,
      repo,
      name: DEPRECATION_REVIEW_CHECK_NAME,
      status: 'completed',
      output: {
        title: 'Outdated',
        summary: `PR no longer requires ${DEPRECATION_REVIEW_CHECK_NAME}`,
      },
      check_run_id: checkRun.id,
      conclusion: CheckRunStatus.NEUTRAL,
    });
  };

  // We do not care about PRs without a deprecation review label of any kind.
  const currentReviewLabel = pr.labels.find(({ name }) => isReviewLabel(name));
  if (!currentReviewLabel) {
    await resetToNeutral();
    return;
  }

  // Update the GitHub Check with appropriate deprecation review information.
  const updateCheck = async (
    opts: Omit<
      Endpoints['POST /repos/{owner}/{repo}/check-runs']['parameters'],
      'baseUrl' | 'headers' | 'mediaType' | 'owner' | 'repo' | 'name' | 'head_sha'
    >,
  ) => {
    if (
      checkRun &&
      (checkRun.status === opts.status || !opts.status || opts.status === 'completed')
    ) {
      await octokit.rest.checks.update({
        owner: pr.head.repo!.owner.login,
        repo: pr.head.repo!.name,
        name: DEPRECATION_REVIEW_CHECK_NAME,
        check_run_id: checkRun.id,
        ...opts,
      });
    } else {
      await octokit.rest.checks.create({
        owner: pr.head.repo!.owner.login,
        repo: pr.head.repo!.name,
        name: DEPRECATION_REVIEW_CHECK_NAME,
        head_sha: pr.head.sha,
        ...opts,
      });
    }
  };

  if (currentReviewLabel.name === DEPRECATION_REVIEW_LABELS.REQUESTED) {
    log(
      'addOrUpdateDeprecationReviewCheck',
      LogLevel.INFO,
      `Marking Check for ${pr.number} as Deprecation Review requested`,
    );
    return updateCheck({
      status: 'in_progress',
      output: {
        title: `${checkTitles[currentReviewLabel.name]}`,
        summary: 'Review in-progress',
      },
    });
  } else if (currentReviewLabel.name === DEPRECATION_REVIEW_LABELS.COMPLETE) {
    log(
      'addOrUpdateDeprecationReviewCheck',
      LogLevel.INFO,
      `Marking Check for ${pr.number} as complete`,
    );
    return updateCheck({
      status: 'completed',
      conclusion: 'success',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: 'All review items have been checked off',
      },
    });
  }
}

export async function maybeAddChecklistComment(octokit: ProbotOctokit, pr: PullRequest) {
  if (!pr.head.repo) {
    log(
      'maybeAddChecklistComment',
      LogLevel.WARN,
      `PR #${pr.number} does not have a head repo - cannot add checklist comment`,
    );
    return;
  }

  const owner = pr.base.repo.owner.login;
  const repo = pr.head.repo.name;

  // We do not care about PRs without the deprecation review requested label.
  const currentReviewLabel = pr.labels.find(({ name }) => isReviewLabel(name));
  if (currentReviewLabel?.name !== DEPRECATION_REVIEW_LABELS.REQUESTED) return;

  // Find the checklist comment from the bot, if it exists
  const comment = (
    await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pr.number,
      per_page: 100,
    })
  ).data.find((comment) => comment.user && isChecklistComment(comment as IssueCommentEvent));

  if (!comment) {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pr.number,
      body: fs.readFileSync(
        path.join(__dirname, '..', 'assets', 'deprecation-checklist.md'),
        'utf-8',
      ),
    });
  }
}

export function setupDeprecationReviewStateManagement(probot: Probot) {
  probot.on(['pull_request.synchronize', 'pull_request.opened'], async (context) => {
    const pr = context.payload.pull_request as PullRequest;
    await addOrUpdateDeprecationReviewCheck(context.octokit, pr);
  });

  /**
   * The deprecation-review/requested label initiates deprecation review,
   * but the deprecation-review/complete label is solely controlled by cation
   */
  probot.on('pull_request.labeled', async (context) => {
    const {
      label,
      sender: { login: initiator },
    } = context.payload;

    const pr = context.payload.pull_request as PullRequest;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // Once a PR is merged, allow tampering.
    if (pr.merged) return;

    if (isReviewLabel(label.name)) {
      if (!isBot(initiator) && label.name !== DEPRECATION_REVIEW_LABELS.REQUESTED) {
        log(
          'pull_request.labeled',
          LogLevel.WARN,
          `${initiator} tried to add ${label.name} to PR #${pr.number} - this is not permitted.`,
        );

        await removeLabel(context.octokit, {
          ...context.repo({}),
          prNumber: pr.number,
          name: label.name,
        });
      }

      if (label.name === DEPRECATION_REVIEW_LABELS.REQUESTED) {
        await maybeAddChecklistComment(context.octokit, pr);
      }
    }

    await addOrUpdateDeprecationReviewCheck(context.octokit, pr);
  });

  /**
   * If a PR is unlabeled, we want to ensure solely that a human
   * did not remove a deprecation-review state label other than
   * deprecation-review-requested.
   */
  probot.on('pull_request.unlabeled', async (context) => {
    const {
      label,
      sender: { login: initiator },
    } = context.payload;

    const pr = context.payload.pull_request as PullRequest;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // Once a PR is merged, allow tampering.
    if (pr.merged) return;

    // We want to prevent tampering with deprecation-review/* labels other than
    // request labels - the bot should control the full review lifecycle.
    if (isReviewLabel(label.name)) {
      // The 'deprecation-review/requested 📝' label can be removed.
      if (label.name === DEPRECATION_REVIEW_LABELS.REQUESTED) {
        // Check will be removed by addOrUpdateDeprecationReviewCheck
      } else {
        if (!isBot(initiator)) {
          log(
            'pull_request.labeled',
            LogLevel.WARN,
            `${initiator} tried to remove ${label.name} from PR #${pr.number} - this is not permitted.`,
          );

          await addLabels(context.octokit, {
            ...context.repo({}),
            prNumber: pr.number,
            labels: [label.name],
          });

          return;
        }
      }

      await addOrUpdateDeprecationReviewCheck(context.octokit, pr);
    }
  });

  probot.on('issue_comment.edited', async (context) => {
    const {
      comment,
      issue: { labels, number: prNumber, pull_request: pr },
    } = context.payload;

    if (!pr) return;

    // We do not care about PRs without a deprecation review label of any kind, or
    // ones which do not have a deprecation-review/requested label.
    const currentReviewLabel = labels.find(({ name }) => isReviewLabel(name));
    if (currentReviewLabel?.name !== DEPRECATION_REVIEW_LABELS.REQUESTED) return;

    // We only care about the checklist comment from this bot
    if (!isChecklistComment(comment)) return;

    // If there are no unchecked items then add the review completed label
    if (comment.body.search(/^- \[ \] /gm) === -1) {
      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: prNumber,
        labels: [DEPRECATION_REVIEW_LABELS.COMPLETE],
      });
      await removeLabel(context.octokit, {
        ...context.repo({}),
        prNumber: prNumber,
        name: DEPRECATION_REVIEW_LABELS.REQUESTED,
      });
    }
  });
}
