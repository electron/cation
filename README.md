# cation

`cation` is Electron's PR monitoring bot, which serves three primary functions - semver label enforcement, PR open time enforcement, and API review bookkeeping. Each of the three are discussed in further detail below.

## Semver Label

This bot is responsible for ensuring that all open PRs to Electron are labeled with a label that reflects their effect on Electron's [Semantic Version](https://semver.org/). If a given PR affects no user-facing code, it must be labeled `semver/none`. The bot will add a pending GitHub Check to the PR, which will only complete successfully when the necessary label is added.

**Before a label is added:**

<img width="739" alt="Screen Shot 2020-12-16 at 9 16 23 AM" src="https://user-images.githubusercontent.com/2036040/102382559-6e5e4380-3f7f-11eb-963f-20e6478c1d84.png">

**After a label is added:**

<img width="739" alt="Screen Shot 2020-12-16 at 9 15 48 AM" src="https://user-images.githubusercontent.com/2036040/102382563-6f8f7080-3f7f-11eb-8fd8-f0ccd2672957.png">

## PR Open Time

The bot is also responsible for ensuring that any given PR is open for an amount of time that reflects its impact on user-facing code. This is also done to ensure that all potential stakeholders for that PR are given ample time to review it and discuss API ergonomics amongst ways it may affect users.

Timespans:
* `semver/major` - 168 hours (7 days)
* `semver/major` - 168 hours (7 days)
* `semver/major` - 24 hours (1 day)
* `semver/none` - 24 hours (1 days), but in some cases (depending on the PR and its goals) there is no minimum time.

Backport PRs (PRs to a release branch that is not `master`) do not require a minimum time, and a `fast-track` label may be optionally applied to a PR to indicate that it is intended to bypass the expected minimum time if sufficient reason exists to do so.

## API Review

The final function of this bot is to control the API review lifecycle on behalf of the [API Working Group](https://github.com/electron/governance/tree/master/wg-api).

This group's review is mandated on all API changes, and their goal is twofold:
 1. To guide Electron’s API surface towards a more ergonomic and usable design.
 2. To reduce the incidence of future breaking changes by anticipating such changes and accommodating them ahead of time with future-proofing.
 
Even changes that seem trivial can often be made more consistent and future-proof with some modifications, and the folks on the API WG have the expertise to spot and suggest those changes.

In accordance with the above goals, this bot performs several bookkeeping duties. When a new PR is opened which is either `semver/minor` or `semver/major`, it will automatically add an `api-review/requested 🗳` label to the PR. To add clarity to whether a review is occurring in a given Electron governance member's capacity as a member of the API WG, this bot then adds a GitHub Check on the PR which members can click on to affirm their review choices:

<img width="557" alt="Screen Shot 2020-12-16 at 9 34 56 AM" src="https://user-images.githubusercontent.com/2036040/102384835-fe9d8800-3f81-11eb-9b45-0e02c552a0a7.png">

If a PR has passed its minimum open time and has the requisite number of approvals with no outstanding requests for changes, the bot will then switch `api-review/requested 🗳` to `api-review/approved ✅`, and the PR is free to be merged. If outstanding change requests persist, then the group will initiate consensus-seeking procedures and ultimately choose to approve or decline the PR. If the decision is made to decline, the API WG chair will then click the relevant button and the bot will update `api-review/requested 🗳` to `api-review/declined ❌`.
