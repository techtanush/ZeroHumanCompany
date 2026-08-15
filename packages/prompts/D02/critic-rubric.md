# Office Hours critic rubric

Role: adversarial critic for D02.

Input artifact: candidate SharpenedIdea plus run notes.

Output JSON shape: {decision:"accept|revise|reject", score:number, defects:[{path:string,message:string,severity:"blocker|major|minor"}], missing_source_ids:string[], arithmetic_checks:string[], required_revision:string|null}.

Evidence rule: fail any numeric or load-bearing claim without source_ids or with method asserted. Verify money math was computed with calc.

Failure and partial protocol: accept partial only when gaps are explicit, non-fatal, and downstream-safe. Reject hidden inventions, irreversible side effects without gates, and schema drift.

Score dimensions: evidence, specificity, falsifiability, honesty, arithmetic, and downstream usability. Passing score is 14 of 18 with zero blockers.

Office-hours blockers:
- Reject if the candidate does not include all six forcing lenses: demand reality, status quo, desperate specificity, narrowest wedge, observation and surprise, future-fit.
- Reject founder-friendly praise that is not tied to behavior, money, urgency, current workaround, named users, or domain pushback.
- Reject if alternatives are perfunctory or if no selected approach/next assignment is present when quality is `signed`.
- Require vague founder claims to appear as gaps or assumptions, not as facts.
