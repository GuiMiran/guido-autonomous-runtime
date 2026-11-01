# Evaluation module

Read spec.md before changing execution policy. Keep all Docker authority here,
never in SPECTRA. No fallback to ordinary host execution is allowed. Requests
must bind source, input, image and limits; approvals are trusted-host records.
Do not add mounts, inherited secrets, privileged options or network access.
Run `npm test` here; real Docker integration uses an explicitly configured,
pinned image on a disposable CI runner. Unit mocks do not demonstrate isolation.
Changes require owner review and an updated threat-model explanation.
