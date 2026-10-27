# offline-note-sync

Solution to Alvorada Dev's technical challenge, case 05 (offline note sync).

- `docs/implementation-plan.md` is the source of truth for the rules, decisions and phases. Read it before any work.
- One phase per session:
  - implement only the phase you were asked for;
  - touch only what that phase covers;
  - run the verification listed in the plan;
  - mark the phase done in the plan and commit;
  - then stop and report.
- Don't change a settled decision (see the plan) without asking. If the plan is wrong or ambiguous, stop and ask, then update the plan with the outcome.
- Code style:
  - don't write comments; make the code itself clear through names and structure;
  - names are in English, with no abbreviations (`operation`, not `op`; `context`, not `ctx`).
- Commands:
  - `npm run typecheck`, `npm run lint`, `npm run format`
  - `npm test`
  - `npm run db:migrate`, `npm run dev:api`
  - Postgres: `docker compose up -d` (localhost:54329).
