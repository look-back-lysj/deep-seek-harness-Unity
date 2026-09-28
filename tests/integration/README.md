# Official Desktop integration evidence

The executed Windows x64 official Desktop batch is recorded in
`../../ACCEPTANCE.md`. It covers final package activation, real market UI,
fixture catalog rendering, immutable plan generation, verified local artifact
delivery, official `installBundle`, completed task state, profile files and
inventory agreement.

Unit tests in this directory must remain isolated from the user profile. Any
new official Desktop run must record its DSH_HOME, package SHA256, host version,
steps, actual disk result, pass/fail/blocked/not-run status and unverified items.
Do not copy the previous result into a new report.
