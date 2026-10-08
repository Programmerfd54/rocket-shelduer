# Channels and roles when importing users

Open a workspace, then the user import section. Enter the Rocket.Chat admin
credentials and use **Load channels and roles**. The catalogue comes from this
workspace: all public channels and private groups visible to the admin, excluding
archived rooms. Pagination is followed.

Enter usernames and open the preview. Each row has searchable multi-selects for
channels/groups and workspace roles. Optional defaults apply to all rows until
that field is customized. Clearing a row selection explicitly opts that user out
of that default. Reset a row to inherit defaults again, or apply defaults to all.
Returning to the login list preserves choices; changing workspaces resets the
form. Duplicate logins are collapsed case-insensitively in the UI and rejected
by the API to avoid conflicting per-user plans.

Only workspace-level roles are shown. Room-level roles such as moderator require
an explicit room context and remain managed in Rocket.Chat:
https://developer.rocket.chat/apidocs/assign-role-to-user
https://developer.rocket.chat/apidocs/get-roles

## API and recovery

`POST /api/workspace/:id/users/add` accepts `users`, each with `login`,
`channels: [{ id, type: "c" | "p", name? }]`, and `roleIds: string[]`.
Top-level `channels` and `roleIds` act as defaults. Explicit empty arrays override
defaults. The former `logins`, `channelId`, `channelType`, and `roleId` request
format is still accepted. Maximums: 100 users, 100 channels and 50 roles per user.
Access checks run before RC login and are unchanged. Selected channel types and
role scopes are validated against RC before accounts are created.

An `ADDED` result means the account was created and every requested assignment
succeeded. A failed assignment produces `ERROR` with the account ID retained.
`WorkspaceAddedUser.pendingAssignments` stores only unfinished assignments.
Retry uses this saved plan, including empty arrays, even after a page reload or
changes to form defaults. An account with a saved RC ID is not created again.
Existing accounts encountered during creation are skipped under the skip policy;
their roles and memberships are not changed. Legacy failures without a stored
plan use the defaults sent with the retry request.

There is no transaction across RC and PostgreSQL. If the process crashes after
RC creates an account but before its ID is saved, a retry may report that the
account already exists; reconcile that account manually. Simultaneous retries
from separate browser sessions are not serialized by this change.

## Rollout

Before running the updated application against a database, apply the additive
migration `20260910090000_workspace_user_assignments` using the existing migration
workflow:

```sh
npx prisma migrate deploy
npx prisma generate
```

Review any other pending project migrations before deploying. The existing
Docker entrypoint runs `prisma migrate deploy` automatically. This change does
not apply migrations to the configured database by itself.

## Verification

```sh
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

API tests mock RC and Prisma. They cover separate per-user selections, multiple
roles, private groups, partial failures, retries after reload, existing users,
invalid channels/roles, authorization, and missing migrations. Catalogue tests
cover pagination, archived rooms, role scope and API failures. A real RC admin
account is needed for an end-to-end smoke test on a test workspace.
