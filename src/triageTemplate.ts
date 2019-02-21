const semver = require('semver');
import { Context } from 'probot';

const triageVersion = async (version: string, context: Context) => {
  if (!version) {
    await createMissingInfoComment(context);
  } else {
    if (!semver.valid(version)) {
      // inform user their version is not a valid version
    } else if ((semver.lt('3.0.0'), version)) {
      // TODO(codebytere): inform user their version is too old
    } else {
      // create label for affected version
      const parts = semver.parse(version);
      const minor = parts.minor === 0 ? 0 : parts.minor;
      await context.github.issues.addLabels(
        context.repo({
          number: context.payload.issue.number,
          labels: [`${parts.major}-${minor}-x`],
        }),
      );
    }
  }
};

const triagePlatform = async (platform: string, context: Context) => {
  if (!platform) {
    // TODO(codebytere): somehow let opener know we require platform
  } else {
    // TODO(codebytere): a super terrible regex for platforms
    const platformMatch = platform.match(/some shit here/);
    if (platformMatch && platformMatch[0]) {
      // TODO(codebytere): add label for affected platform(s)
    } else {
      // TODO(codebytere): inform user they did not provide a valid platform
    }
  }
};

const createMissingInfoComment = async (context: Context) => {
  await context.github.issues.createComment(
    context.issue({
      body:
        'Please fill out all applicable sections of the template correctly for the maintainers to be able to triage your issue.',
    }),
  );
};

export const triageBugReport = async (components: string[], context: Context) => {
  const electronVersion: string = components['Electron Version'].raw;
  await triageVersion(electronVersion, context);

  const platform: string = components['Operating System'].raw;
  await triagePlatform(platform, context);

  const expectedBehavior = components['Expected Behavior'].raw;
  if (expectedBehavior === '') {
    // TODO(codebytere): inform user they did not fill our required expected behavior section
  }

  const actualBehavior = components['Actual Behavior'].raw;
  if (actualBehavior === '') await createMissingInfoComment(context);
};

export const triageFeatureRequest = async (components: string[], context: Context) => {
  // TODO: implement triageFeatureRequest
};

export const triageMASRejection = async (components: string[], context: Context) => {
  const electronVersion: string = components['Electron Version'].raw;
  await triageVersion(electronVersion, context);

  const rejectionEmail: string = components['Rejection Email'].raw;
  if (rejectionEmail === '') await createMissingInfoComment(context);
};
