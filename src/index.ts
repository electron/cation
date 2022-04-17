import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
  });
}

import { Probot } from 'probot';
import { setUp24HourRule } from './24-hour-rule';
import { setupSemverLabelEnforcement } from './enforce-semver-labels';
import { setupAPIReviewStateManagement } from './api-review-state';
import { addBasicPRLabels } from './add-triage-labels';
import { addCardToProject } from './add-card-to-project';

const probotHandler = async ({ app }: { app: Probot }) => {
  app.on('error', errorEvent => {
    for (const error of Array.from(errorEvent)) {
      if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, {
          req: error.request,
          extra: {
            event: errorEvent.event,
            status: error.status,
          },
        } as any);
      }
    }
  });
  setUp24HourRule(app);
  setupSemverLabelEnforcement(app);
  setupAPIReviewStateManagement(app);
  addBasicPRLabels(app);
  addCardToProject(app);
};

module.exports = probotHandler;

type ProbotHandler = typeof probotHandler;
export { ProbotHandler };
