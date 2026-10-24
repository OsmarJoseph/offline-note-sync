# Offline note sync: implementation plan

This is the plan for Alvorada Dev's technical challenge, case 05. It holds the case rules, the settled decisions and the phases, and it leaves implementation details to the session that builds each phase. Phase status goes in `docs/progress.md`.

## The product

People write short text notes and edit them on phones and laptops that are often offline. Edits made offline wait in a queue on the device, and when it reconnects it sends the queue to a server that holds the one true copy of every note. The feature is that sync step: each queued edit is either applied or reported back as a conflict, so nobody's work is overwritten without them knowing.

- **Note:** a piece of plain text a person edits over time, like a grocery list, with an `id`, its current text and a revision.
- **Revision:** a number that starts at 1 when a note is created and goes up by 1 with every accepted change, so a device can say which version of the note it edited.
- **Op (operation):** one edit sent by a device, made of an `op_id`, the `note_id`, the `base_revision` the edit started from (0 for a new note) and the full new text. An op always carries the whole text, never a diff. The device creates the `op_id` (a UUID) when the edit is made and keeps it on every resend, which is how the server tells a resend from a new edit. It also creates the `note_id` (a UUID) for a new note, so it can keep editing a note it created offline before the server has seen it.
- **Receipt:** the server's answer to one op, with a status plus the note or the rejected text. The op and its result are saved under the `op_id`, so a device that resends an op after a dropped connection gets the same answer back and the op is not applied twice.

## The case

The source is https://github.com/Alvorada-Dev/desafios-tecnicos/blob/main/casos/05-sincronizacao-de-notas.md, and its rules in plain terms are:

- **Creating a note:** the server starts with no notes, and an op with base revision 0 creates one at revision 1.
- **Editing a note:** an edit is accepted only when its base revision equals the note's current revision, which means the device saw the latest version before editing. The new text replaces the old one and the revision goes up by 1, even when the text didn't change.
- **Conflicts:** when the base doesn't match, the server keeps its note and returns a `conflict` receipt holding both its note and the rejected text, so the person can choose what to keep. An edit (base above 0) to a note the server doesn't have is not turned into a create: the receipt says the note doesn't exist and keeps the text, since only base 0 creates. The server never merges texts and never trusts a device clock to pick a winner.
- **Resends:** every valid op is stored with its receipt, conflicts included. When an `op_id` arrives again with the same content, the server returns the stored receipt and applies nothing, and when it arrives with different content the server answers `op_id_reused`, since one id can't stand for two edits.
- **Invalid ops:** fields are checked before anything else, and an op that fails isn't stored, so the device can fix it and send it again under the same `op_id`.
- **Queues:** the server handles a device's ops in the order sent and returns one receipt per op, and a conflict or error on one op doesn't stop the ones after it.
- **Reading a note:** a receipt is a snapshot of the note taken when the op ran, and a resend returns that same snapshot even if the note has changed since. To see the latest text and revision, the device reads the note with a separate query.
- **Not required:** deleting notes, merging texts, real-time co-editing and saving to disk.

The case's example follows one note, N, through two devices:

1. O1 (base 0, "início") creates N at revision 1.
2. O2 (base 1, "edição A") is applied, and N moves to revision 2.
3. O3 (base 1, "edição B") is a conflict, because it was written against revision 1 and N is already at 2.
4. O2 is sent again and gets its original receipt, with nothing applied.
5. O4 (base 2, "A + B") settles the conflict as a normal edit, and N moves to revision 3.

Below the table, the case adds two checks. A resent O3 still gets its original conflict at revision 2, while reading N shows revision 3. Reusing O2 with another text must be an error, which by the resend rule is `op_id_reused`.

## Settled decisions

### Architecture

- **Business rules live in `src/sync/rules.ts`**, with no Nest or Drizzle imports, so they are tested without a database.
- **Postgres is the only store**, because its transactions, row locks and unique keys are what keep ops from applying twice or overwriting each other.
- **The service passes the transaction to the repository**, so every query in it is visible, and there is no repository interface, since there's only one database.

### Storage

- **`notes` holds each note's id, current text and current revision**, updated in the same transaction as the op that changed it.
- **`operations` stores every valid op as sent**, with its status and the revision its receipt shows, and receipts are rebuilt from these rows. Its `note_id` has no foreign key, since a `note_not_found` op names a note that doesn't exist.
- **Applied ops are the revisions**, and a unique index on `(note_id, revision)` for applied ops stops two edits from both winning.
- **One transaction per op** (READ COMMITTED) that locks the `op_id`, then the note, before reading anything, so concurrent requests wait in line instead of retrying. A create inserts the note with `on conflict do nothing`, and the unique keys stay as a safety net that fails the request if it ever fires.

### Sync rules

- **Each op is validated on its own with zod**, so an invalid op gets its own receipt without failing the batch.
- **Same content means equal `note_id`, `base_revision` and `text`**, compared exactly, with nothing trimmed or normalized.
- **Text is `invalid` when it has:**
  - any U+0000, the invisible "null" character, because Postgres can't store it;
  - a lone surrogate, which is half of a two-part character such as an emoji, because Node replaces it with `�` (U+FFFD) on the way to Postgres, so an honest resend would no longer match and would get `op_id_reused`;
  - more than 64 KiB, to keep requests and rows small.
- **Status names are in English.**

### Tooling

- **Drizzle ORM 0.45 on `pg`**, because one schema gives typed rows and SQL migrations, and it supports `for update` and partial unique indexes.
- **TypeScript `~6.0.3`**, because typescript-eslint doesn't support TypeScript 7 yet.
- **ESM, NestJS 12, Vitest and npm workspaces**, so reviewers need only Node 22.12+ and Docker.

## Statuses

These three are saved, so a resend gets the same receipt back:

- `applied`: the edit was accepted, and the receipt shows the note right after it.
- `conflict`: the edit started from an old revision, so the receipt shows the server's note and the rejected text.
- `note_not_found`: the edit (base above 0) names a note the server doesn't have, so the receipt shows the rejected text.

These two are only sent back, and nothing is saved:

- `op_id_reused`: the `op_id` already belongs to a different edit.
- `invalid`: a field is wrong, and the receipt lists which ones. The `op_id` stays free, so the device can fix the op and send it again.

Requests and receipts are JSON with snake_case fields. To settle a conflict, the device sends a normal op with a new `op_id` and the text the person chose.

## Interpretations of gaps in the case

- A base higher than the note's revision is a `conflict`, like any other mismatch.
- Base 0 on a note that already exists is a `conflict`, because creating never overwrites.
- An invalid op is `invalid` even when its `op_id` is already stored, because fields are checked first.
- Empty text is valid, because clearing a note is a real edit.
- Extra fields in an op are ignored and don't count when comparing a resend.
- An `op_id` is unique across all devices, where a real product would scope it per user.
- Each op in a request is saved on its own, so a failure doesn't undo the ops before it.

## Layout

```
apps/api/        NestJS 12 app: sync rules, Drizzle schema and migrations, repository, service, controller, scenario CLI
scenarios/       JSON scenarios with expected results, shared by the e2e tests and the CLI
```

The API exposes `POST /sync` (1-100 ops, one receipt per op), `GET /notes`, `GET /notes/:id` and `POST /dev/reset`, which only works when `ENABLE_DEV_ROUTES=true`.

## Tests that matter

- **Highlighted in the README**, each with the bug that makes it fail:
  1. An edit with base 1 reaches the server before its note exists and gets `note_not_found`. Another op then creates the note, and the edit is resent. Its base now matches, but it still gets `note_not_found`. It fails if the server decides a resend again instead of returning the saved receipt.
  2. Base 0 on an existing note is a `conflict`, and an edit with the same text still raises the revision. It fails if a create overwrites an existing note, or if an edit with unchanged text is skipped.
  3. A request with `X` (invalid), `X` (valid) and `Y` (valid) gets `invalid`, `applied`, `applied`. It fails if an invalid op keeps its `op_id` from being used, or if one bad op stops the rest.
- **Property tests** run random histories with many reused ids through the service on Postgres (fast-check, 200 runs), and check that:
  - every op gets one receipt, in order;
  - resending the whole history changes nothing;
  - a note's revision equals its number of applied ops;
  - receipts carry exactly what was sent.
- **Concurrency tests** send these at the same moment, and each must end with exactly one winner:
  - two creates of the same note;
  - two edits from the same revision;
  - the same op twice;
  - one `op_id` on two different notes.

## Phases

Every phase ends by running `npm run typecheck`, `npm run format`, `npm run lint` and `npm test` from the repo root, with Postgres up (`docker compose up -d`) from Phase 2 on. File paths are inside `apps/api` unless marked (root).

### Phase 0: scaffold

Sets up the repo so later phases only write code: the npm workspace with `apps/api`, TypeScript, ESLint, Prettier and the root scripts.

- Files: root config, `apps/api/package.json`, `apps/api/tsconfig.json`.

### Phase 1: sync rules

Writes the business rules as plain functions: checking an op's fields, deciding whether it is applied, a conflict or `note_not_found`, and shaping the receipt. They have no Nest or Drizzle imports, so the unit tests run without a database.

- Files: `src/sync/protocol.ts`, `src/sync/rules.ts`, `test/rules.spec.ts`.
- Done when: the tests fail if an accepted edit doesn't raise the revision by 1.

### Phase 2: database layer

Creates the empty Nest app and the database it talks to: Postgres 18.6 in Docker on port 54329, the `notes` and `operations` tables as a Drizzle schema, and the migrations that create them.

- Files: `docker-compose.yml` (root), `drizzle.config.ts`, `src/db/schema.ts`, `src/db/database.module.ts`, `src/db/errors.ts`.
- Done when: the migrations apply to an empty database, and generating them again finds no changes.

### Phase 3: repository and service

Connects the rules to the database. The repository holds the queries, and the service runs each op in its own transaction: lock, read, call the rules, write. The concurrency tests prove that requests arriving at the same moment still end with one winner.

- Files: `src/sync/sync.repository.ts`, `src/sync/sync.service.ts`, `vitest.config.ts`, `test/global-setup.ts`, `test/sync.service.spec.ts`.
- Done when: a test that sends two creates of the same note at once passes.
- Write that test before handling the race. With a plain insert, the second create crashes with a unique violation, and with `on conflict do nothing` it gets a normal `conflict` receipt instead.

### Phase 4: property tests

Instead of hand-written cases, fast-check generates hundreds of random op histories and runs them through the service, checking the properties listed in "Tests that matter".

- Files: `test/arbitraries.ts`, `test/properties.spec.ts`.

### Phase 5: HTTP API

Puts the service behind HTTP: `POST /sync`, `GET /notes`, `GET /notes/:id` and `POST /dev/reset`. The end-to-end tests send real requests to the running app.

- Files: `src/sync/sync.module.ts`, `src/sync/sync.controller.ts`, `src/app.ts`, `src/main.ts`, `test/sync.e2e.spec.ts`.

### Phase 6: scenarios and CLI

Builds the demo. A scenario is a JSON file of ops to send and the receipts expected back, and the CLI runs one against the API and reports each step as pass or fail. Two scenarios ship: the case's own example, and a grocery-list story that reaches every status.

- Files: `src/cli/scenario.ts`, `test/scenarios.e2e.spec.ts`, `scenarios/spec-example.json` (root), `scenarios/grocery-list.json` (root).
- Done when: `grocery-list.json` passes against the running API, and the CLI exits with code 1 when an expectation is wrong.

### Phase 7: README

Writes the README the case asks for: how to install, run and test, the demo, the three highlighted tests, two decisions and how AI was used.

- Files: `README.md` (root).
- Done when: someone with a fresh clone can follow it from install to demo.

## Not built, and why

- **Next.js two-device simulator:** doesn't fit the time budget, and the scenario CLI already gives a demo anyone can repeat.
- **SSE live updates:** only useful with a UI showing two devices.
- **Real-time co-editing:** needs automatic merging, which the case forbids.
- **Cleanup of old ops:** not needed at this size, and applied ops can never be deleted, since they hold each note's history.
- **Users and auth:** not part of the case.
