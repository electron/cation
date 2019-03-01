const semver = require('semver');
import { Context } from 'probot';
import * as utils from './utils';
import {
  ENHANCEMENT_LABEL,
  BUG_LABEL,
  PLATFORM_MAC,
  PLATFORM_WIN,
  PLATFORM_LINUX,
  APP_STORE_LABEL,
  MISSING_INFO_LABEL,
} from './constants';

const triageVersion = async (version: string, context: Context): Promise<Boolean> => {
  if (version) {
    if (!semver.valid(version)) {
      await context.github.issues.createComment(
        context.issue({
          body: 'The version you provided does not appear to be valid. Please re-check it!',
        }),
      );
    } else if (semver.lt('3.0.0', version)) {
      await context.github.issues.createComment(
        context.issue({
          body: `The version of Electron you provided is no longer actively maintained,
and as such we are no longer implementing fixes. Please check this issue with a newer version
of Electron to see if it still persists, and if it does the maintainers can triage your issue.`,
        }),
      );
    } else {
      const parts = semver.parse(version);
      const minor = parts.minor === 0 ? 0 : parts.minor;
      await context.github.issues.addLabels(
        context.repo({
          number: context.payload.issue.number,
          labels: [`${parts.major}-${minor}-x`],
        }),
      );
    }
    return true;
  }
  return false;
};

const triagePlatform = async (platform: string, context: Context): Promise<Boolean> => {
  if (platform) {
    const labelsToAdd: string[] = [];

    const macOSMatch = platform.match(/([mM]ac[oO]?[sS]?)|(darwin)/);
    const windowsMatch = platform.match(/([wW]indows)|(win32)/);
    const linuxMatch = platform.match(/(ubuntu)|(arch)|(linux)|(mint)/);

    if (macOSMatch && macOSMatch[0]) labelsToAdd.push(PLATFORM_MAC);
    if (windowsMatch && windowsMatch[0]) labelsToAdd.push(PLATFORM_WIN);
    if (linuxMatch && linuxMatch[0]) labelsToAdd.push(PLATFORM_LINUX);

    if (labelsToAdd.length === 0) {
      await context.github.issues.createComment(
        context.issue({
          body:
            'The operating system you provided does not appear to be valid. Please re-check it!',
        }),
      );
    } else {
      await utils.addIssueLabels(context, labelsToAdd);
    }
    return true;
  }
  return false;
};

export const triageBugReport = async (
  components: Record<string, { raw: string }>,
  context: Context,
  isUpdate: Boolean,
) => {
  let missingInfo: string[] = [];

  const electronVersion: string = components['Electron Version:'].raw;
  if (!(await triageVersion(electronVersion, context))) missingInfo.push('Electron Version');

  const platform: string = components['Operating System:'].raw;
  if (!(await triagePlatform(platform, context))) missingInfo.push('Operating System');

  const expectedBehavior = components['Expected Behavior'].raw;
  if (expectedBehavior === '') missingInfo.push('Expected Behavior');

  const actualBehavior = components['Actual Behavior'].raw;
  if (actualBehavior === '') missingInfo.push('Actual Behavior');

  // comment on the pr notifying user of missing required fields
  if (!isUpdate && missingInfo.length > 0) {
    await utils.notifyMissingInfo(context, missingInfo);
    return;
  }

  // only edit labels if this isn't the issue's initial open event
  if (isUpdate && utils.labelExistsOnIssue(context, MISSING_INFO_LABEL)) {
    await utils.removeIssueLabel(context, MISSING_INFO_LABEL);
  } else {
    await utils.addIssueLabels(context, [BUG_LABEL]);
  }
};

export const triageFeatureRequest = async (
  components: Record<string, { raw: string }>,
  context: Context,
  isUpdate: Boolean,
) => {
  let missingInfo: string[] = [];

  const featureDescription: string = components['Problem Description'].raw;
  if (featureDescription === '') missingInfo.push('Feature Description');

  const proposedSolution: string = components['Proposed Solution'].raw;
  if (proposedSolution === '') missingInfo.push('Proposed Solution');

  const alternativeConsidered: string = components['Alternatives Considered'].raw;
  if (alternativeConsidered === '') missingInfo.push('Alternatives Considered');

  // comment on the pr notifying user of missing required fields
  if (!isUpdate && missingInfo.length > 0) {
    await utils.notifyMissingInfo(context, missingInfo);
    return;
  }

  // only edit labels if this isn't the issue's initial open event
  if (isUpdate && utils.labelExistsOnIssue(context, MISSING_INFO_LABEL)) {
    await utils.removeIssueLabel(context, MISSING_INFO_LABEL);
  } else {
    await utils.addIssueLabels(context, [ENHANCEMENT_LABEL]);
  }
};

export const triageMASRejection = async (
  components: Record<string, { raw: string }>,
  context: Context,
  isUpdate: Boolean,
) => {
  let missingInfo: string[] = [];

  const electronVersion: string = components['Electron Version:'].raw;
  if (!(await triageVersion(electronVersion, context))) missingInfo.push('Electron Version');

  const rejectionEmail: string = components['Rejection Email'].raw;
  if (rejectionEmail === '') missingInfo.push('Rejection Email');

  // comment on the pr notifying user of missing required fields
  if (!isUpdate && missingInfo.length > 0) {
    await utils.notifyMissingInfo(context, missingInfo);
    return;
  }

  // only edit labels if this isn't the issue's initial open event
  if (isUpdate && utils.labelExistsOnIssue(context, MISSING_INFO_LABEL)) {
    await utils.removeIssueLabel(context, MISSING_INFO_LABEL);
  } else {
    await utils.addIssueLabels(context, [APP_STORE_LABEL]);
  }
};
