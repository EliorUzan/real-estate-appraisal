# Dependency follow-up — review due 7 November 2026

Status: advisory remains open; this document does not suppress or close the scanner alert.

minimatch occurs in the web ESLint/TypeScript-ESLint development tree; the npm audit count propagates the same advisory through its parent tools.

No application route accepting attacker-supplied glob patterns was identified in the audit. Frozen installs and trusted build inputs remain required. Do not run changed build scripts from untrusted pull requests with deployment credentials. The repaired public request handlers do not call these glob APIs.

The reported fixed minimatch 11 / glob 14 releases cross major API boundaries for their callers. A blanket override can break CSS generation, linting or packaging. Upgrade compatible parent tools or use a reviewed backport, then rerun CSS/build/regression checks. No forced audit fix or unrelated framework migration is authorized by this exception.

Track GHSA-g3hv-75wg-m249 and, for SemiTechnical, GHSA-3g3m-2fjr-6pw4 and GHSA-gcqx-w48m-w2h4. Reassess on the due date or immediately if an untrusted runtime path is found. No production exploit of these dependency paths was demonstrated.
