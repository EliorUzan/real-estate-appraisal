# Environment CLI GovMap admission failure — 27 October 2026

Submission `1a44d95e-c241-4337-8174-c4616a1b6115` woke the existing host successfully but never created a generation job. It was a frontend request UUID, not a job UUID. At 08:38:21 UTC, PostgreSQL reported `generation_jobs_check2`; appraisal returned HTTP 500, followed by lookup HTTP 404. No native inference ran for this submission.

The environment evidence implementation correctly validated and froze GovMap observations, then passed them to the existing `plot_evidence` storage column. The September retention migration restricted that column to `plot_description`. Environment requests with observations therefore failed at database admission. The earlier successful environment request that day had no saved GovMap evidence. Existing TypeScript tests mocked the admission RPC and did not cover this constraint.

Migration `20261027131126_cli_environment_govmap_evidence.sql` replaces the plot-only constraint with a named constraint allowing the existing plot data or CLI environment observations marked `kind=govmap_environment` and `collectionMethod=domain_browser_sdk`. It retains the object requirement and 6 MB storage bound. Existing Edge validation still checks source, address, cadastral identity, freshness and input size. No provider policy, prompt, authentication, permission, worker or frontend change is required. Existing history pruning already clears this column for every section.

Regression coverage in `tests/cli_environment_evidence_db.sql` exercises the real admission RPC, frozen input, same-identity idempotency, malformed/missing discriminators, wrong section/mode, size bound, requests without observations, and retention cleanup. It reproduced the original constraint failure before the migration and passed afterward. All five isolated PostgreSQL suites and eight focused section/model tests passed locally. These tests do not establish multi-session race behavior or live provider success.

Deployment and live verification are recorded below after completion.
