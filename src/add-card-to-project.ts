import { Probot, Context } from 'probot';
import { PROJECT_NAME_REGEX, UNSORTED_COLUMN_ALT_NAME_REGEX } from './constants';
import { LogLevel } from './enums';
import { log } from './utils/log-util';
import { EventPayloads } from '@octokit/webhooks';

export function addCardToProject(probot: Probot) {
  probot.on('issues.labeled', async context => {
    try {
      const { payload, octokit } = context;
      const { name: repo } = payload.repository;
      const { login: owner } = payload.sender;
      const { number: issueNumber } = payload.issue;
      const { name: labelName } = payload.label || {};

      if (labelName == null) {
        log('addCardToProject', LogLevel.ERROR, `No label found`);
      }

      if (!PROJECT_NAME_REGEX.test(labelName!)) {
        throw new Error(`Label doesn't match a project label!`);
      }

      const { data: projects } = await octokit.projects.listForRepo({ owner, repo });

      const project = projects.find(
        (project: EventPayloads.WebhookPayloadProjectProject) => project.name === labelName,
      );

      if (!project) {
        log(
          'addCardToProject',
          LogLevel.ERROR,
          `Unable to find project board with name ${labelName}`,
        );
        throw new Error(`Unable to find project board with name ${labelName}`);
      }

      const { data: projectColumns } = await octokit.projects.listColumns({
        project_id: project.id,
      });

      const unsortedColumn = projectColumns.find(
        (column: EventPayloads.WebhookPayloadProjectColumnProjectColumn) =>
          UNSORTED_COLUMN_ALT_NAME_REGEX.test(column.name),
      );

      if (!unsortedColumn) {
        log('addCardToProject', LogLevel.ERROR, `Unsorted column doesn't exist!`);
        throw new Error("Unsorted column doesn't exist");
      }

      await octokit.projects.createCard({
        column_id: unsortedColumn.id, // This is the id of the Unsorted Issues column, which you'll need to get
        content_id: issueNumber, // This is the issue number
        content_type: 'Issue', // This will always be issue since we're associating an issue
      });
    } catch (err) {
      log(
        'addCardToProject',
        LogLevel.ERROR,
        'Unable to associate issue with project board: ',
        err,
      );
    }
  });
}
