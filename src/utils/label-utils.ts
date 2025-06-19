import { log } from './log-util';
import { LogLevel } from '../enums';
import { ProbotOctokit } from 'probot';

export const addLabels = async (
  octokit: ProbotOctokit,
  data: {
    prNumber: number;
    owner: string;
    repo: string;
    labels: string[];
  },
) => {
  log(
    'addLabels',
    LogLevel.INFO,
    `Attempting to add ${data.labels.join(', ')} to PR #${data.prNumber}`,
  );

  // If the PR already has the label, don't try to add it.
  const existingLabels = await getLabelsForPR(octokit, data);
  const labels = data.labels.filter(async (label) => !existingLabels.includes(label));

  await octokit.rest.issues.addLabels({
    owner: data.owner,
    repo: data.repo,
    issue_number: data.prNumber,
    labels,
  });
};

export const removeLabel = async (
  octokit: ProbotOctokit,
  data: {
    prNumber: number;
    name: string;
    owner: string;
    repo: string;
  },
) => {
  log('removeLabel', LogLevel.INFO, `Attempting to remove ${data.name} from PR #${data.prNumber}`);

  // If the issue does not have the label, don't try remove it.
  const labelExists = await labelExistsOnPR(octokit, data);
  if (labelExists) {
    await octokit.rest.issues.removeLabel({
      owner: data.owner,
      repo: data.repo,
      issue_number: data.prNumber,
      name: data.name,
    });
    log('removeLabel', LogLevel.INFO, `Successfully removed ${data.name} from #${data.prNumber}.`);
  } else {
    log(
      'removeLabel',
      LogLevel.INFO,
      `Determined ${data.name} does not exist on #${data.prNumber}.`,
    );
  }
};

export const getLabelsForPR = async (
  octokit: ProbotOctokit,
  data: {
    prNumber: number;
    owner: string;
    repo: string;
  },
) => {
  log('getLabelsForPR', LogLevel.INFO, `Fetching all labels for #${data.prNumber}`);

  const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
    owner: data.owner,
    repo: data.repo,
    issue_number: data.prNumber,
    per_page: 100,
    page: 1,
  });

  log('getLabelsForPR', LogLevel.INFO, `Found ${labels.length} labels for #${data.prNumber}`);

  return labels.map((l) => l.name);
};

export const labelExistsOnPR = async (
  octokit: ProbotOctokit,
  data: {
    prNumber: number;
    name: string;
    owner: string;
    repo: string;
  },
) => {
  log('labelExistsOnPR', LogLevel.INFO, `Checking if ${data.name} exists on #${data.prNumber}`);

  const labels = await getLabelsForPR(octokit, data);
  return labels.some((label) => label === data.name);
};
