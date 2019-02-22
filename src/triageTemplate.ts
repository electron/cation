const semver = require('semver');
import { Context } from 'probot';
import * as utils from './utils';

const triageVersion = async (version: string, context: Context): Promise<Boolean> => {
  if (version) {
    if (!semver.valid(version)) {
      // TODO: inform user their version is not a valid version
    } else if (semver.lt('3.0.0', version)) {
      // TODO(codebytere): inform user their version is too old
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
    // TODO(codebytere): a super terrible regex for platforms
    const platformMatch = platform.match(/some shit here/);
    if (platformMatch && platformMatch[0]) {
      // TODO(codebytere): add label for affected platform(s)
    } else {
      // TODO(codebytere): inform user they did not provide a valid platform
    }
    return true;
  }
  return false;
};

export const triageBugReport = async (
  components: Record<string, { raw: string }>,
  context: Context,
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

  if (missingInfo.length > 0) await utils.notifyMissingInfo(context, missingInfo);
};

export const triageFeatureRequest = async (
  components: Record<string, { raw: string }>,
  context: Context,
) => {
  // TODO: implement triageFeatureRequest
};

export const triageMASRejection = async (
  components: Record<string, { raw: string }>,
  context: Context,
) => {
  let missingInfo: string[] = [];

  const electronVersion: string = components['Electron Version'].raw;
  if (!(await triageVersion(electronVersion, context))) missingInfo.push('Electron Version');

  const rejectionEmail: string = components['Rejection Email'].raw;
  if (rejectionEmail === '') missingInfo.push('Rejection Email');

  if (missingInfo.length > 0) await utils.notifyMissingInfo(context, missingInfo);
};
