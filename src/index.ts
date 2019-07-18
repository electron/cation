import { Application } from 'probot';
import { setUp24HourRule } from './24-hour-rule';

const probotHandler = async (robot: Application) => {
  setUp24HourRule(robot);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
