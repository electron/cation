import { components } from '@octokit/openapi-webhooks-types';

type Schemas = components['schemas'];

export type PullRequest = Schemas['pull-request'];
export type Label = Schemas['label'];

export type IssueCommentEvent = Schemas[
  | 'webhook-issue-comment-created'
  | 'webhook-issue-comment-edited']['comment'];
export type PullRequestLabeledEvent = Schemas['webhook-pull-request-labeled'];
