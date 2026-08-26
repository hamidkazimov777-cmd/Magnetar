# Changelog

## Unreleased

### Added

- Step 0 baseline implementation plan with feature-parity matrix and acceptance IDs.
- Quality gates, security policy, architecture baseline and release checklist.
- Frontend Vitest harness with initial guard, relevance and adaptive-routing tests.

### Documented gaps

- Current in-memory 5,000-file index limit.
- Plaintext-at-rest `secrets.json` development posture pending Keychain hardening.
- Missing frontend unit-test script, backend authorization boundary and CSP.
- Existing build warnings and large Monaco-related chunks.
- npm audit could not be completed in the restricted environment; dependency
  install reported 2 vulnerabilities and needs a networked review.
- Removed the confirmed unreachable duplicate `new_project` agent case.
- Made the smoke fixture portable by defaulting it to the OS temp directory.
- Added shared redacted error normalization/reporting and a frontend/Rust CI workflow.
