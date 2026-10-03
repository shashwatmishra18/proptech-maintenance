# Temporary braces mitigation

GHSA-vfj7-8cjw-p6xm affects braces <=3.0.3. At verification, upstream has no patched release:
https://github.com/advisories/GHSA-vfj7-8cjw-p6xm

`scripts/guard-braces.cjs` runs on npm postinstall, including Docker dependency installation. It wraps the installed braces 3.0.3 parse/compile/expand/stringify entry points. An iterative input check rejects nesting beyond 64 before parsing; an iterative AST check rejects depth beyond 64, cycles, and more than 65,536 nodes before recursive walkers. Original package versions are unchanged. Unexpected versions fail installation and require review.

`npm run audit:security` still executes npm audit. Only this exact advisory, its <=3.0.3 range, and parent findings whose entire advisory chain leads to it are permitted. The installed guard must match its source exactly and pass functional checks. Additional copies, other advisories, invalid reports, and modified/missing guards fail the gate. npm audit is not disabled globally.

Application source does not import braces, micromatch or fast-glob or pass user input to glob evaluation. These packages serve trusted build/lint configuration. The guard nevertheless covers their installed dependency entry points before any pattern can reach recursive processing. Production builds and Docker installation use the same guarded dependencies. Focused tests exercise public braces/micromatch paths with 20,000 nested levels in a low-stack child process, direct AST walkers, normal globs, cycles, and fail-closed audit scope.

Remove this exception and install the upstream patched version as soon as one is available. Recheck upstream on every dependency/security update. This mitigates the named recursion advisory; it is not an exception for other vulnerabilities or an unrestricted glob resource-budget guarantee.
