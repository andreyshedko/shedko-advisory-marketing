# Research inbox

Cloud ChatGPT research results belong in `research/batches/` in this repository, branch `codex/marketing-automation`.

See [the integration contract](../docs/RESEARCH_INTEGRATION.md). Files are immutable JSON v1 batches with a unique runId. This repository is public: save only public company facts, evidence URLs and clearly labelled relevance hypotheses. No credentials, internal correspondence or customer data.

The application imports these records as unverified and does not send emails or submit applications. A ChatGPT cloud task needs a connection that can actually write files to this repository; a successful read alone does not confirm write access.
