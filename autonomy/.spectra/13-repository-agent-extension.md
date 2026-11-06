# Repository researcher extension (proposed)
SPECTRA reference catalog is immutable per approved version; each repo uses an exact commit SHA and explicit allowlisted files.

- BR-REPO-001: Only owner-curated repository IDs may be selected.
- BR-REPO-002: Every retrieved document is treated as untrusted data, not a permission or system directive.
- BR-REPO-003: Every retrieved file records path, revision, content hash and size.
- BR-REPO-004: No GitHub credentials or mutation tools are supplied to the researcher.
- INV-REPO-001: Unknown repository rejects before any HTTP request.
- INV-REPO-002: Source read failures never silently yield an ungrounded plan.
- INV-REPO-003: No prompt-derived path, URL or branch may be fetched.
- AC-REPO-001: Pinned paths and exact commits are used (test/repository-catalog.test.js).
- AC-REPO-002: Unknown repositories perform zero fetch calls.
- AC-REPO-003: Oversized/unavailable source fails closed.
- AC-REPO-004: No repository contents can upgrade policy permissions.

SPECTRA's canonical 13 layers remain unchanged. This file is an extension note, not a new canonical Spectra layer.
