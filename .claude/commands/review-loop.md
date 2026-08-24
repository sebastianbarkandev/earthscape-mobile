---
description: Implement-review-fix loop until the reviewer ships it
---

Run the self-review loop on the work just completed (or on: $ARGUMENTS).

1. Ensure the change is complete and tests pass locally.
2. Invoke the code-reviewer subagent on the current diff.
3. If VERDICT: ITERATE — fix every CRITICAL and WARNING (use judgment on
   SUGGESTIONS), then invoke a FRESH code-reviewer again on the new diff.
4. Repeat until VERDICT: SHIP, or after 3 iterations — then STOP and present
   the remaining findings to me with your assessment instead of looping further.
5. On SHIP: summarize what changed across iterations. Do NOT commit — wait for me.