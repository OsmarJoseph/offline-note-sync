# Offline note sync: implementation plan

This is the plan for Alvorada Dev's technical challenge, case 05. It holds the case rules, the settled decisions and the phases, and it leaves implementation details to the session that builds each phase. Each phase shows its status, and the session that finishes a phase marks it done.

## The product

People write short text notes and edit them on phones and laptops that are often offline. Edits made offline wait in a queue on the device, and when it reconnects it sends the queue to a server that holds the one true copy of every note. The feature is that sync step: each queued edit is either applied or reported back as a conflict, so nobody's work is overwritten without them knowing.

- **Note:** a piece of plain text a person edits over time, like a grocery list, with an `id`, its current text and a revision.
- **Revision:** a number that starts at 1 when a note is created and goes up by 1 with every accepted change, so a device can say which version of the note it edited.
- **Operation:** one edit sent by a device, made of an `op_id` (the API's name for the operation id), the `note_id`, the `base_revision` the edit started from (0 for a new note) and the full new text. An operation always carries the whole text, never a diff. The device creates the `op_id` (a UUID) when the edit is made and keeps it on every resend, which is how the server tells a resend from a new edit. It also creates the `note_id` (a UUID) for a new note, so it can keep editing a note it created offline before the server has seen it.
- **Operation result:** the server's answer to one operation, with a status plus the note or the rejected text. The operation and its result are saved under the `op_id`, so a device that resends an operation after a dropped connection gets the same answer back and the operation is not applied twice.

## The case

The source is https://github.com/Alvorada-Dev/desafios-tecnicos/blob/main/casos/05-sincronizacao-de-notas.md, and its rules in plain terms are:

- **Creating a note:** the server starts with no notes, and an operation with base revision 0 creates one at revision 1.
- **Editing a note:** an edit is accepted only when its base revision equals the note's current revision, which means the device saw the latest version before editing. The new text replaces the old one and the revision goes up by 1, even when the text didn't change.
- **Conflicts:** when the base doesn't match, the server keeps its note and returns a `conflict` result holding both its note and the rejected text, so the person can choose what to keep. An edit (base above 0) to a note the server doesn't have is not turned into a create: the result says the note doesn't exist and keeps the text, since only base 0 creates. The server never merges texts and never trusts a device clock to pick a winner.
- **Resends:** every valid operation is stored with its result, conflicts included. When an `op_id` arrives again with the same content, the server returns the stored result and applies nothing, and when it arrives with different content the server answers `op_id_reused`, since one id can't stand for two edits.
- **Invalid operations:** fields are checked before anything else, and an operation that fails isn't stored, so the device can fix it and send it again under the same `op_id`.
- **Queues:** the server handles a device's operations in the order sent and returns one result per operation, and a conflict or error on one operation doesn't stop the ones after it.
- **Reading a note:** a result is a snapshot of the note taken when the operation ran, and a resend returns that same snapshot even if the note has changed since. To see the latest text and revision, the device reads the note with a separate query.
- **Not required:** deleting notes, merging texts, real-time co-editing and saving to disk.

The case's example follows one note, N, through two devices:

1. O1 (base 0, "início") creates N at revision 1.
2. O2 (base 1, "edição A") is applied, and N moves to revision 2.
3. O3 (base 1, "edição B") is a conflict, because it was written against revision 1 and N is already at 2.
4. O2 is sent again and gets its original result, with nothing applied.
5. O4 (base 2, "A + B") settles the conflict as a normal edit, and N moves to revision 3.

Below its table, the case adds two checks. A resent O3 still gets its original conflict at revision 2, while reading N shows revision 3. Reusing O2 with another text must be an error, which by the resend rule is `op_id_reused`.

## Settled decisions

### Architecture

- **Types and field validation live in a domain module** with no Nest or Drizzle imports, so they are tested without a database.
- **The sync rules live in the service**, next to the transaction that reads and writes the rows they decide on, so they are tested on Postgres.
- **Postgres is the only store**, because its transactions, row locks and unique keys are what keep operations from applying twice or overwriting each other.
- **The service passes the transaction to the repository**, so the service code shows every query that runs inside the transaction, and there is no repository interface, since there's only one database.

### Storage

- **`notes` holds each note's id, current text and current revision**, updated in the same transaction as the operation that changed it.
- **`operations` stores every valid operation as sent**, with its status and the revision its result shows, and results are rebuilt from these rows. Its `note_id` has no foreign key, since a `note_not_found` operation names a note that doesn't exist.
- **Applied operations are the revisions**, and a unique index on `(note_id, revision)` for applied operations stops two edits from both winning.
- **One transaction per operation** (READ COMMITTED) that takes an advisory lock on the `op_id`, then on the `note_id`, before reading anything, so concurrent requests wait in line instead of retrying. Advisory locks work before either row exists, which a row lock can't. A create inserts the note with `on conflict do nothing`, and the unique keys stay as a safety net that fails the request if it ever fires.

### Sync rules

- **The controller validates each operation on its own with zod**, so an invalid operation gets its own result in its place without failing the batch, and the service only ever receives valid operations.
- **Same content means equal `note_id`, `base_revision` and `text`**, compared exactly, with nothing trimmed or normalized.
- **Text is `invalid` when it has:**
  - any U+0000, the invisible "null" character, because Postgres can't store it;
  - a lone surrogate, which is half of a two-part character such as an emoji, because Node replaces it with `�` (U+FFFD) on the way to Postgres, so an honest resend would no longer match and would get `op_id_reused`;
  - more than 64 KiB, to keep requests and rows small.
- **Status names are in English.**

### Tooling

- **Drizzle ORM 0.45 on `pg`**, because one schema gives typed rows and SQL migrations, and it supports partial unique indexes and raw SQL for the advisory locks.
- **TypeScript `~6.0.3`**, because typescript-eslint doesn't support TypeScript 7 yet.
- **ESM, NestJS 12, Vitest and npm workspaces**, so reviewers need only Node 22.12+ and Docker.

## Statuses

These three are saved, so a resend gets the same result back:

- `applied`: the edit was accepted, and the result shows the note right after it.
- `conflict`: the edit started from an old revision, so the result shows the server's note and the rejected text.
- `note_not_found`: the edit (base above 0) names a note the server doesn't have, so the result shows the rejected text.

These two are only sent back, and nothing is saved:

- `op_id_reused`: the `op_id` already belongs to a different edit.
- `invalid`: a field is wrong, and the result lists which ones. The `op_id` stays free, so the device can fix the operation and send it again.

Requests and results are JSON with snake_case fields. To settle a conflict, the device sends a normal operation with a new `op_id` and the text the person chose.

## Interpretations of gaps in the case

- A base higher than the note's revision is a `conflict`, like any other mismatch.
- Base 0 on a note that already exists is a `conflict`, because creating never overwrites.
- An invalid operation is `invalid` even when its `op_id` is already stored, because fields are checked first.
- Empty text is valid, because clearing a note is a real edit.
- Extra fields in an operation are ignored and don't count when comparing a resend.
- An `op_id` is unique across all devices, where a real product would scope it per user.
- Each operation in a request is saved on its own, so a failure doesn't undo the operations before it.

## Layout

```
apps/api/        NestJS 12 app: sync rules, Drizzle schema and migrations, repository, service, controller
```

The API exposes `POST /sync` (a body of `{ operations }` with 1-100 operations, answered with `{ results }`, one result per operation), `GET /notes`, `GET /notes/:id` and `POST /dev/reset`, which only works when `ENABLE_DEV_ROUTES=true`.

## Tests that matter

- **Highlighted in the README**, each with the bug that makes it fail:
  1. An edit with base 1 reaches the server before its note exists and gets `note_not_found`. Another operation then creates the note, and the edit is resent. Its base now matches, but it still gets `note_not_found`. It fails if the server decides a resend again instead of returning the saved result.
  2. Base 0 on an existing note is a `conflict`, and an edit with the same text still raises the revision. It fails if a create overwrites an existing note, or if an edit with unchanged text is skipped.
  3. A request with `X` (invalid), `X` (valid) and `Y` (valid) gets `invalid`, `applied`, `applied`. It fails if an invalid operation keeps its `op_id` from being used, or if one bad operation stops the rest.
- **Concurrency tests** send these at the same moment, and each must end with exactly one winner:
  - two creates of the same note;
  - two edits from the same revision;
  - the same operation twice;
  - one `op_id` on two different notes.

## Phases

Every phase ends by running `npm run typecheck`, `npm run format`, `npm run lint` and `npm test` from the repo root, with Postgres up (`docker compose up -d`) from Phase 2 on.

### Phase 0: scaffold

Status: done.

Sets up the repo so later phases only write code: the npm workspace with `apps/api`, TypeScript, ESLint, Prettier and the root scripts.

### Phase 1: types and validation

Status: done.

Writes the operation and result types and the zod parsing that checks an operation's fields before anything is read. They have no Nest or Drizzle imports, so the unit tests run without a database.

- Done when: an invalid operation gets `invalid` naming each failing field.

### Phase 2: database layer

Status: done.

Adds Nest and the database it talks to: Postgres 18.6 in Docker on port 54329, the `notes` and `operations` tables as a Drizzle schema, and the migrations that create them, and a global Nest module that provides the database connection. The app bootstrap waits for Phase 4.

- Done when: the migrations apply to an empty database, and generating them again finds no changes.

### Phase 3: repository and service

Status: done.

Connects the rules to the database. The repository holds the queries, and the service runs each operation in its own transaction: lock, read, apply the sync rules, write. The service tests on Postgres cover the case example, the first two highlighted tests and the resend rules, and the concurrency tests prove that requests arriving at the same moment still end with one winner.

- Done when: a test that sends two creates of the same note at once passes, and the tests fail if an accepted edit doesn't raise the revision by 1.
- Write that test before handling the race. With a plain insert, the second create crashes with a unique violation, and with `on conflict do nothing` it gets a normal `conflict` result instead.

### Phase 4: HTTP API

Status: done.

Puts the service behind HTTP: `POST /sync`, `GET /notes`, `GET /notes/:id` and `POST /dev/reset`. The controller validates each operation and sends only the valid ones to the service, in order. The end-to-end tests send real requests to the running app and cover the third highlighted test and invalid operations in a queue.

### Phase 5: README

Status: not started.

Writes the README the case asks for: how to install, run and test, the demo, the three highlighted tests, two decisions and how AI was used. The demo is the case's example as curl commands against the running API, with the result each one returns.

- Done when: someone with a fresh clone can follow it from install to demo.

## Not built, and why

- **Next.js two-device simulator:** doesn't fit the time budget, and the curl commands in the README already give a demo anyone can repeat.
- **SSE live updates:** only useful with a UI showing two devices.
- **Real-time co-editing:** needs automatic merging, which the case forbids.
- **Cleanup of old operations:** not needed at this size, and applied operations can never be deleted, since they hold each note's history.
- **Users and auth:** not part of the case.
