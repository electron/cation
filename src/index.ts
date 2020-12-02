import { Application } from 'probot';
import { setUp24HourRule } from './24-hour-rule';
import { setupSemverLabelEnforcement } from './enforce-semver-labels';
import { setupAPIReviewStateManagement } from './api-review-state';

const probotHandler = async (robot: Application) => {
  setUp24HourRule(robot);
  setupSemverLabelEnforcement(robot);
  setupAPIReviewStateManagement(robot);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
