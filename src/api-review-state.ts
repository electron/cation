import { Application, Context } from 'probot';
import {
  API_REVIEW_ACTIONS,
  API_REVIEW_CHECK_NAME,
  REVIEW_LABELS,
  SEMVER_LABELS,
} from './constants';
import { CheckRunStatus } from './enums';
import { isAPIReviewRequired } from './utils/check-utils';
import { getEnvVar } from './utils/env-util';
import { EventPayloads } from '@octokit/webhooks';
import { Endpoints } from '@octokit/types';

const checkTitles = {
  [REVIEW_LABELS.APPROVED]: 'Approved',
  [REVIEW_LABELS.DECLINED]: 'Declined',
  [REVIEW_LABELS.REQUESTED]: 'Pending',
};

async function addOrUpdateCheck(
  octokit: Context['octokit'],
  pr: EventPayloads.WebhookPayloadPullRequestPullRequest,
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
      check_run_id: checkRun.id,
      conclusion: CheckRunStatus.NEUTRAL,
      completed_at: new Date().toISOString(),
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

  const checkSummary = checkRun ? checkRun.output.summary : '';

  const updateCheck = async (
    opts: Omit<
      Endpoints['POST /repos/{owner}/{repo}/check-runs']['parameters'],
      'baseUrl' | 'headers' | 'mediaType' | 'owner' | 'repo' | 'name' | 'head_sha'
    >,
  ) => {
    if (checkRun) {
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
  };

  if (currentReviewLabel.name === REVIEW_LABELS.REQUESTED) {
    return updateCheck({
      status: 'in_progress',
      output: {
        title: checkTitles[currentReviewLabel.name],
        summary: checkSummary,
      },
      actions: [
        {
          label: 'API LGTM',
          description: 'Approves this API change',
          identifier: API_REVIEW_ACTIONS.LGTM,
        },
        {
          label: 'Request API Changes',
          description: 'Mark this API as needing changes',
          identifier: API_REVIEW_ACTIONS.REQUEST_CHANGES,
        },
        {
          label: 'Decline API Change',
          description: 'Declines this API change',
          identifier: API_REVIEW_ACTIONS.DECLINE,
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

export function setupAPIReviewStateManagement(probot: Application) {
  probot.on(['pull_request.synchronize', 'pull_request.opened'], async context => {
    await addOrUpdateCheck(context.octokit, context.payload.pull_request);
  });

  probot.on('check_run.requested_action', async context => {
    // Validate sender

    // GitHub plz...
    switch ((context.payload as any).requested_action.identifier) {
      case API_REVIEW_ACTIONS.LGTM:
        probot.log('lgtm');
        break;
      case API_REVIEW_ACTIONS.REQUEST_CHANGES:
        probot.log('req changes');
        break;
      case API_REVIEW_ACTIONS.DECLINE:
        probot.log('decline');
        break;
    }
  });

  probot.on('pull_request.labeled', async context => {
    const { label, pull_request: pr } = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // If a PR is semver-minor or semver-major, automatically
    // add the 'api-review/requested 🗳' label.
    if ([SEMVER_LABELS.MINOR, SEMVER_LABELS.MAJOR].includes(label.name)) {
      probot.log(
        'Received a semver-minor or semver-major PR:',
        `${context.payload.repository.full_name}#${pr.number}`,
        "Adding the 'api-review/requested 🗳' label",
      );

      await context.github.issues.addLabels(
        context.repo({
          issue_number: pr.number,
          labels: [REVIEW_LABELS.REQUESTED],
        }),
      );
    } else if (Object.values(REVIEW_LABELS).includes(label.name)) {
      const sender = context.payload.sender.login;

      // Humans can only add the 'api-review/requested 🗳' manually.
      if (sender !== getEnvVar('BOT_USER_NAME') && label.name !== REVIEW_LABELS.REQUESTED) {
        probot.log(`${sender} tried to add ${label.name} - this is not permitted.`);
        // Remove the label. Bad human.
        await context.github.issues.removeLabel(
          context.repo({
            issue_number: pr.number,
            name: label.name,
          }),
        );
        return;
      }
    }

    await addOrUpdateCheck(context.octokit, context.payload.pull_request);
  });

  probot.on('pull_request.unlabeled', async context => {
    const { label, pull_request: pr } = context.payload;

    if (!label) {
      throw new Error('Something went wrong - label does not exist.');
    }

    // We want to prevent tampering with api-review/* labels other than
    // request labels - the bot should control the full review lifecycle.
    if (Object.values(REVIEW_LABELS).includes(label.name)) {
      // The 'api-review/requested 🗳' label can be removed if it does not violate requirements.
      if (label.name === REVIEW_LABELS.REQUESTED && !isAPIReviewRequired(pr)) {
        // Check will be removed by addOrUpdateCheck
      } else {
        const sender = context.payload.sender.login;
        if (sender !== getEnvVar('BOT_USER_NAME')) {
          probot.log(`${sender} tried to remove ${label.name} - this is not permitted.`);

          // Put the label back. Bad human.
          await context.github.issues.addLabels(
            context.repo({
              issue_number: pr.number,
              labels: [label.name],
            }),
          );
          return;
        }
      }

      await addOrUpdateCheck(context.octokit, context.payload.pull_request);
    }
  });
}
