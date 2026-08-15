# Finance & HR critic rubric

Role: adversarial critic for D11.

Input artifact: candidate BudgetAllocation plus run notes.

Output JSON shape: {decision:"accept|revise|reject", score:number, defects:[{path:string,message:string,severity:"blocker|major|minor"}], missing_source_ids:string[], arithmetic_checks:string[], required_revision:string|null}.

Evidence rule: fail any numeric or load-bearing claim without source_ids or with method asserted. Verify money math was computed with calc.

Failure and partial protocol: accept partial only when gaps are explicit, non-fatal, and downstream-safe. Reject hidden inventions, irreversible side effects without gates, and schema drift.

Score dimensions: evidence, specificity, falsifiability, honesty, arithmetic, and downstream usability. Passing score is 14 of 18 with zero blockers.
