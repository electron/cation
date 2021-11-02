import { Context, Probot } from 'probot';
import {
  API_REVIEW_CHECK_NAME,
  API_WORKING_GROUP,
  EXCLUDE_LABELS,
  MINIMUM_MINOR_OPEN_TIME,
  MINIMUM_PATCH_OPEN_TIME,
  NEW_PR_LABEL,
  OWNER,
  REPO,
  REVIEW_LABELS,
  SEMVER_LABELS,
} from './constants';
import { ApiReviewAction, CheckRunStatus } from './enums';
import { isAPIReviewRequired } from './utils/check-utils';
import { getEnvVar } from './utils/env-util';
import { EventPayloads } from '@octokit/webhooks';
import { Endpoints } from '@octokit/types';
import { addLabels, removeLabel } from './utils/label-utils';

type APIApprovalState = ReturnType<typeof addOrUpdateAPIReviewCheck> extends Promise<infer T>
  ? T
  : unknown;

const checkTitles = {
  [REVIEW_LABELS.APPROVED]: 'Approved',
  [REVIEW_LABELS.DECLINED]: 'Declined',
  [REVIEW_LABELS.REQUESTED]: 'Pending',
};

const CHECK_JSON_START = '<!-- || ';
const CHECK_JSON_END = ' || -->';

const isBot = (user: string) => user === getEnvVar('BOT_USER_NAME');
const isReviewLabel = (label: string) => Object.values(REVIEW_LABELS).includes(label);

export async function addOrUpdateAPIReviewCheck(
  octokit: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
  userChanges: {
    approved?: string[];
    requestedChanges?: string[];
    declined?: string[];
  } = {},
) {
  const currentReviewLabel = pr.labels.find(l => Object.values(REVIEW_LABELS).includes(l.name));

  const { data: allChecks } = await octokit.checks.listForRef({
    ref: pr.head.sha,
    per_page: 100,
    owner: pr.head.repo.owner.login,
    repo: pr.head.repo.name,
  });

  const resetToNeutral = async () => {
    if (!checkRun) return;
    return await octokit.checks.update({
      owner: pr.head.repo.owner.login,
      repo: pr.head.repo.name,
      name: API_REVIEW_CHECK_NAME,
      status: 'completed',
      title: 'PR no longer requires API Review',
      check_run_id: checkRun.id,
      conclusion: CheckRunStatus.NEUTRAL,
    });
  };

  const checkRun = allChecks.check_runs.find(run => run.name === API_REVIEW_CHECK_NAME);
  if (!currentReviewLabel) {
    await resetToNeutral();
    return;
  }

  if (!pr.labels.some(l => [SEMVER_LABELS.MAJOR, SEMVER_LABELS.MINOR].includes(l.name))) {
    await resetToNeutral();
    return;
  }

  let checkSummary = checkRun
    ? checkRun.output.summary
    : `${CHECK_JSON_START} {} ${CHECK_JSON_END}`;
  const users: typeof userChanges = JSON.parse(
    checkSummary
      .split(CHECK_JSON_START)[1]
      .split(CHECK_JSON_END)[0]
      .trim(),
  );
  users.approved = (users.approved || [])
    .concat(userChanges.approved || [])
    .filter(u => !userChanges.declined?.includes(u) && !userChanges.requestedChanges?.includes(u));
  users.declined = (users.declined || [])
    .concat(userChanges.declined || [])
    .filter(u => !userChanges.approved?.includes(u) && !userChanges.requestedChanges?.includes(u));
  users.requestedChanges = (users.requestedChanges || [])
    .concat(userChanges.requestedChanges || [])
    .filter(u => !userChanges.approved?.includes(u) && !userChanges.declined?.includes(u));
  users.approved = [...new Set(users.approved)];
  users.declined = [...new Set(users.declined)];
  users.requestedChanges = [...new Set(users.requestedChanges)];

  const parsedUsers: Required<typeof users> = users as any;

  const approved = parsedUsers.approved.length
    ? `#### Approved\n\n${parsedUsers.approved.map(u => `* @${u}`).join('\n')}\n`
    : '';
  const requestedChanges = parsedUsers.requestedChanges.length
    ? `#### Requested Changes\n\n${parsedUsers.requestedChanges.map(u => `* @${u}`).join('\n')}\n`
    : '';
  const declined = parsedUsers.declined.length
    ? `#### Declined\n\n${parsedUsers.declined.map(u => `* @${u}`).join('\n')}\n`
    : '';
  checkSummary = `${CHECK_JSON_START} ${JSON.stringify(
    parsedUsers,
  )} ${CHECK_JSON_END}\n${approved}${requestedChanges}${declined}`;

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
      await octokit.checks.update({
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
        name: API_REVIEW_CHECK_NAME,
        check_run_id: checkRun.id,
        ...opts,
      });
    } else {
      await octokit.checks.create({
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
        name: API_REVIEW_CHECK_NAME,
        head_sha: pr.head.sha,
        ...opts,
      });
    }

    return parsedUsers;
  };

  const getPRReadyDate = (pr: EventPayloads.WebhookPayloadPullRequestPullRequest) => {
    let readyTime = new Date(pr.created_at).getTime();
    const isMajorMinor = pr.labels.some((l: any) =>
      [SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(l.name),
    );
    if (isMajorMinor) {
      readyTime += MINIMUM_MINOR_OPEN_TIME;
    } else {
      readyTime += MINIMUM_PATCH_OPEN_TIME;
    }

    return new Date(readyTime).toISOString().split('T')[0];
  };

  if (currentReviewLabel.name === REVIEW_LABELS.REQUESTED) {
    const lgtmCount = parsedUsers.approved.length;
    return updateCheck({
      status: 'in_progress',
      output: {
        title: `${
          checkTitles[currentReviewLabel.name]
        } (${lgtmCount}/2 LGTMs - ready on ${getPRReadyDate(pr)})`,
        summary: checkSummary,
      },
      actions: [
        {
          label: 'API LGTM',
          description: 'Approves this API change',
          identifier: `${ApiReviewAction.LGTM}|${pr.number}`,
        },
        {
          label: 'Request API Changes',
          description: 'Marks this API as needing changes',
          identifier: `${ApiReviewAction.REQUEST_CHANGES}|${pr.number}`,
        },
        {
          label: 'Decline API Change',
          description: 'Declines this API change',
          identifier: `${ApiReviewAction.DECLINE}|${pr.number}`,
        },
      ],
    });
  } else if (currentReviewLabel.name === REVIEW_LABELS.APPROVED) {
    return updateCheck({
      status: 'completed',
      conclusion: 'success',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
    });
  } else if (currentReviewLabel.name === REVIEW_LABELS.DECLINED) {
    return updateCheck({
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
    });
  }

  // a bunch of other if checks
  throw new Error('Unreachable ??');
}

export async function checkPRReadyForMerge(
  octokit: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
  userApprovalState: APIApprovalState,
) {
  const addExclusiveLabel = async (newLabel: string) => {
    const currentLabel = pr.labels.find(l => Object.values(REVIEW_LABELS).includes(l.name));
    if (currentLabel && currentLabel.name !== newLabel) {
      await removeLabel(octokit, {
        owner: OWNER,
        repo: REPO,
        prNumber: pr.number,
        name: currentLabel.name,
      });
    }
    if (!currentLabel || currentLabel.name !== newLabel) {
      await addLabels(octokit, {
        owner: OWNER,
        repo: REPO,
        prNumber: pr.number,
        labels: [newLabel],
      });
    }
  };

  if (userApprovalState && userApprovalState.declined.length > 0) {
    await addExclusiveLabel(REVIEW_LABELS.DECLINED);
    return;
  }

  if (userApprovalState && !pr.labels.some(l => l.name === NEW_PR_LABEL)) {
    if (
      userApprovalState.approved.length >= 2 &&
      userApprovalState.declined.length === 0 &&
      userApprovalState.requestedChanges.length === 0
    ) {
      await addExclusiveLabel(REVIEW_LABELS.APPROVED);
    } else {
      await addExclusiveLabel(REVIEW_LABELS.REQUESTED);
    }
  }
}

export function setupAPIReviewStateManagement(probot: Probot) {
  probot.on(['pull_request.synchronize', 'pull_request.opened'], async (context: Context) => {
    await addOrUpdateAPIReviewCheck(context.octokit, context.payload.pull_request);
  });

  probot.on('check_run.requested_action', async (context: Context) => {
    const {
      repository,
      requested_action,
      sender: { login: initiator },
    }: EventPayloads.WebhookPayloadCheckRun = context.payload;

    const { data } = await context.octokit.teams.listMembersInOrg({
      org: repository.owner.login,
      team_slug: API_WORKING_GROUP,
    });

    const members = data.map(m => m.login);

    if (!members.includes(initiator)) {
      probot.log(
        `${initiator} is not a member of the API Working Group and cannot review this PR.`,
      );
      return;
    }

    let userApprovalState: APIApprovalState;

    const [id, prNumber] = requested_action!.identifier.split('|');
    const { data: pr } = await context.octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: parseInt(prNumber, 10),
    });

    switch (id) {
      case ApiReviewAction.LGTM: {
        // The author of the PR should not be able to LGTM their own API.
        if (initiator === pr.user.login) {
          probot.log(`User ${initiator} tried to LGTM their own API - this is not permitted.`);
        } else {
          userApprovalState = await addOrUpdateAPIReviewCheck(context.octokit, pr as any, {
            approved: [initiator],
          });
        }
        break;
      }
      case ApiReviewAction.REQUEST_CHANGES: {
        userApprovalState = await addOrUpdateAPIReviewCheck(context.octokit, pr as any, {
          requestedChanges: [initiator],
        });
        break;
      }
      case ApiReviewAction.DECLINE: {
        const { data: maintainers } = await context.octokit.teams.listMembersInOrg({
          org: repository.owner.login,
          team_slug: API_WORKING_GROUP,
          role: 'maintainer',
        });

        const teamMaintainer = maintainers[0].login;

        // Only allow the API WG chair to decline an API on behalf of the WG.
        if (initiator !== teamMaintainer) {
          probot.log(
            `User ${initiator} tried to decline an API - only the Chair ${teamMaintainer} can do this`,
          );
        } else {
          userApprovalState = await addOrUpdateAPIReviewCheck(context.octokit, pr as any, {
            declined: [initiator],
          });
        }
        break;
      }
    }

    checkPRReadyForMerge(context.octokit, pr as any, userApprovalState);
  });

  /**
   * If a potential API PR is labeled, there are several decision trees we
   * can potentially take, outlined as follows:
   *
   *  - Semver Labels:
   *    - If a semver-major or semver-minor PR is opened, API review is requisite.
   *      The api-review-requested label must be added.
   *    - If a semver-patch label is added, do not add any api-review-{state} labels and
   *      remove them if they exist.
   *  - Exclusion Labels:
   *    - If an exclusion label is added, then this PR is exempt from API review. Do not add any
   *      api-review-{state} labels and remove them if they have previously been added.
   *  - api-review-{state} labels
   *    - If any api-review-{state} label besides api-review-requested is added, remove it.
   *      API approval is controlled solely by cation.
   */
  probot.on('pull_request.labeled', async context => {
    const {
      label,
      pull_request: pr,
      repository,
      sender: { login: initiator },
    }: EventPayloads.WebhookPayloadPullRequest = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    const isSemverMajorMinorLabel = [SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(label.name);
    const shouldExclude =
      pr.labels.some(l => EXCLUDE_LABELS.includes(l.name)) ||
      pr.base.ref !== pr.base.repo.default_branch ||
      label.name === SEMVER_LABELS.PATCH;

    // If a PR is semver-minor or semver-major and the PR does not have an
    // exclusion label, automatically add the 'api-review/requested 🗳' label.
    if (isSemverMajorMinorLabel && !shouldExclude) {
      probot.log(
        'Received a semver-minor or semver-major PR:',
        `${repository.full_name}#${pr.number}`,
        "Adding the 'api-review/requested 🗳' label",
      );

      await addLabels(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        labels: [REVIEW_LABELS.REQUESTED],
      });
    } else if (isReviewLabel(label.name)) {
      // Humans can only add the 'api-review/requested 🗳' manually.
      if (!isBot(initiator) && label.name !== REVIEW_LABELS.REQUESTED) {
        probot.log(
          `${initiator} tried to add ${label.name} to PR #${pr.number} - this is not permitted.`,
        );

        await removeLabel(context.octokit, {
          ...context.repo({}),
          prNumber: pr.number,
          name: label.name,
        });

        return;
      }
    } else if (shouldExclude) {
      // Remove the api-review/requested label if it was added prior to an exclusion label -
      // for example if the backport label was added by trop after cation got to it.
      await removeLabel(context.octokit, {
        ...context.repo({}),
        prNumber: pr.number,
        name: REVIEW_LABELS.REQUESTED,
      });
    }

    await addOrUpdateAPIReviewCheck(context.octokit, pr);
  });

  /**
   * If a PR is unlabeled, we want to ensure solely that a human
   * did not remove an api-review state label other than api-review-requested.
   *
   * If they remove a semver-minor or semver-major label to replace it with a
   * semver-patch label, we'll let that get handled when they add the semver-patch
   * label.
   *
   */
  probot.on('pull_request.unlabeled', async context => {
    const {
      label,
      pull_request: pr,
      sender: { login: initiator },
    }: EventPayloads.WebhookPayloadPullRequest = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // We want to prevent tampering with api-review/* labels other than
    // request labels - the bot should control the full review lifecycle.
    if (isReviewLabel(label.name)) {
      // The 'api-review/requested 🗳' label can be removed if it does not violate requirements.
      if (label.name === REVIEW_LABELS.REQUESTED && !isAPIReviewRequired(pr)) {
        // Check will be removed by addOrUpdateCheck
      } else {
        if (!isBot(initiator)) {
          probot.log(
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

      await addOrUpdateAPIReviewCheck(context.octokit, pr);
    }
  });
}
