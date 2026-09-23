# Reliability audit — 2026-09-23

Scope: provider adapter, deadlines, cancellation, cache, admission, PostgreSQL freshness checks, authenticated handler ordering, and runtime/source parity. No live-provider requests were made by this agent. Initial audit made no production changes; the subsequently authorized evidence-completeness fix is described below. `.env` and application data were not modified. Integration work used random PostgreSQL schemas on the authorized loopback endpoint; each suite removes its schema.

## Verified tests

- Existing backend unit suite: **20 files, 431 tests passed**, 4.96 s. See `unit.log`.
- Existing backend integration suite: **6 files, 54 passed, 1 deliberately skipped**, 21.82 s. `RUN_LIVE_AI_FLOW=0`; live credentials were cleared only in the test child environment. See `integration.log`. The skipped test belongs to the root agent's separate live-provider scope.
- `db-deadline.mts`: successful characterization against an isolated random schema and synthetic fetch; see `db-deadline.log`.
- `runtime-check.mts`: successful installed-Next environment precedence and generated-route artifact inspection; see `runtime-check.json`. An initial audit harness import used the wrong local `@next/env` resolution; corrected to the installed frontend dependency and rerun successfully. This was a harness error, not an application failure.

## Findings

### R1 — P1: running production UI does not execute the audited source AI policy

Verified at 2026-09-23T11:54Z, before any subsequent rebuild:

- Production API route references `frontend/.next/server/chunks/[root-of-the-server]__01ulpgd._.js`.
- That chunk uses `reasoning_effort: "low"` for both `gpt-6-sol` and `gpt-6-luna`.
- Current source adapter uses `xhigh` for `gpt-6-luna`.
- The built prompt lacks current source instructions containing `DIFFERENT similar_format_penalty` and `Before returning, check every choice`.
- Normalized prompt SHA-256: source `15dfb025b39fa22e58269a08cf41c230d7af723ab39899a5246d8bb396bb0154`; built `3e38f4d006747647a3a428f89093e8325700512a8d3a07e405f2302fcb85e4cd`.
- Build ID mtime 11:33:28Z; prompt source 11:33:50Z; adapter source 11:44:14Z. Root identified the UI on port 3105 as PID 65024; OS process creation time was 11:43:06Z.

**Impact:** source CLI evaluation at the new prompt/effort does not establish the quality of the currently displayed UI. The old prompt is specifically missing fixes relevant to explanation completeness. This is a deployment/parity defect, not evidence that the new source implementation fails.

**Resolution:** root must rebuild and restart the production app using the intended root environment, then confirm artifact parity and repeat authenticated UI smoke. Do not change an active server's `.next` files underneath it. A source-hash/build-hash check in release verification would prevent the discrepancy.

### R2 — P2, conditional: database work after inference has no deadline

`backend/src/services/recommendations.ts` performs session-level lock queries and `readDomainVersionWithClient` on `recommendationLockPool`. Its connection options bound connection acquisition, but do not set `statement_timeout` or `query_timeout`. The transaction-local 15-second timeout in `withTransaction` does not apply to this connection. Caller cancellation is passed only to the provider.

**Reproduction:** synthetic provider succeeds under a 200 ms provider budget. Another connection holds an `ACCESS EXCLUSIVE` lock on the isolated test schema's `employees` table. The post-provider revision query remains blocked after 600 ms and after caller abort; `pg_stat_activity` confirms one waiting revision query. Releasing the lock lets the request return `mode: ai`.

**Impact:** provider timeout guarantees do not bound total recommendation completion or guarantee immediate slot/lock release after provider completion. Under DDL or database stalls, all three local admission slots can remain occupied. Ordinary MVCC row updates do not cause this specific table-lock wait; it is a conditional operational weakness, not a reproduced routine demo failure.

**Resolution:** bound queries on the dedicated pool and map timeout errors consistently. If cancellation is promised for the whole operation, cancellation must also cover DB waits, not only fetch. Retain the dedicated pool and out-of-transaction provider call.

### R3 — P2: alternative local startup picks a different model

Root `.env` and `frontend/.env.local` contain different `LLM_MODEL` values. Installed `@next/env` confirms direct frontend startup resolves a different model from root configuration; startup with `node --env-file=.env` preserves root values. Key and timeout equality were checked without printing either value.

**Impact:** `npm run dev/start` from the root is consistent with documented configuration. Direct frontend workspace scripts can silently select another model. Root's observed port-3105 process explicitly uses `--env-file=.env`, so R3 does **not** explain R1 or change that process's model selection.

**Resolution:** use one documented startup path, or make the workspace entry points load the same root configuration. No environment files were changed by this audit.

## Strongest defense of the architecture

The model selects only eligible candidate IDs and server-issued evidence IDs. Domain effects, eligibility, and rendered facts are deterministic. The adapter applies a wall-clock race even if the transport ignores abort, handles streamed-body deadlines, caps response bytes, rejects malformed UTF-8 and completion envelopes, and sanitizes errors. It deliberately makes one attempt without hidden retries. Temporary fallbacks are not cached, so recovery can take effect immediately.

Admission is bounded to three operations; the separate lock pool prevents slow inference from exhausting the ordinary request pool. PostgreSQL advisory locks provide cross-process per-profile exclusion; a single SQL statement checks both revisions after inference. Cache keys cover employee identity, version, input/evidence, prompt/schema, and provider configuration, and cached results are cloned. Existing tests exercise stale writes during inference, cancellation cleanup, concurrent overflow, authentication/scoping, and cache invalidation. These are substantial safeguards, not only prompt-level promises.

## Critical review and agreement with adversarial audit

- Agree with `astra_adversarial`: structural validation reliably rejects unknown/duplicate/cross-candidate IDs and fabricated prose. This is stronger than relying on model compliance alone.
- Agree: accepting three legal evidence categories does not guarantee that the selected evidence explains the deciding ranking factor. Their synthetic unlock/history/effort counterexamples are a quality-boundary gap; evaluator failure is not equivalent to runtime rejection. No independent live claim is made here.
- Agree: an eligible but poorly ordered ranking is a model-quality error, not automatically a security exploit. Prompt-injection effectiveness would require controlled live evidence.
- Retracted initial suspicion that a cache hit needs an extra late revision check: the service reads a fresh consistent snapshot before constructing the cache key, and a write can happen after any final check. No distinct reproducible stale-cache defect was established.
- The strongest criticism is deployment parity: extensive correct source tests do not validate the old code being served. R1 must be resolved before presenting source live-evaluation results as UI evidence.

Unknowns: no provider availability/latency claim is made by this agent; root owns real-provider and authenticated live evaluations. The current audit does not establish scale beyond the tested local admission behavior or improvement over the deterministic baseline.

## Authorized follow-up: evidence-completeness guard

At root's request, changed `backend/src/ai/response-validator.ts` and `backend/src/ai/prompt.ts`. Every chosen candidate must cite all existing history and effort facts; candidates with nonempty `unlocks_event_ids` must additionally cite all their target_requirement facts. The original three-distinct-category rule remains. The validator rejects incomplete output without inserting reasons, changing ranking, or parsing opaque IDs. Recommendation orchestration converts rejection to explicit `rules_fallback / invalid_response`.

The prompt states the same contract and explicitly distinguishes evidence coverage from a claim that every factor decided the rank. No pairwise baseline oracle was added. Adapter reasoning effort, database code, and configuration are untouched.

Verification:

- New dedicated regression before fix: **7 failed, 2 passed**. See `evidence-before.log`.
- After fix and updating intentionally valid synthetic responses to the new contract: **440/440 unit tests pass**, including all nine new tests. See `evidence-after-unit.log`.
- After fix: **54 integration tests pass, 1 live test intentionally skipped**. See `evidence-after-integration.log`.
- Backend TypeScript check passes. See `typecheck.log`.
- Initial broad post-change run showed **28 failed / 412 passed**, caused by positive synthetic responses omitting now-required evidence and old assertions deliberately accepting incomplete citations. See `evidence-after-initial.log`; those fixtures/assertions were reviewed and updated, not bypassed.
- Domain-source missing-evidence regressions now explicitly assert fallback and invalid AI counts, while fallback's complete evidence must pass. Malformed-ID/category/comparison tests retain rejection behavior.
- R2 database-wait characterization still reproduces after the evidence change; see `db-deadline-after.log`.
- Independent `astra_method` review approves the bounded fix with no blocker. Main tradeoff: citing all relevant categories may increase response length, latency, or fallback under the unchanged 1,400-token cap. Root owns the required post-patch live re-evaluation and production rebuild.

Earlier runtime hashes and stale-build findings intentionally describe the pre-fix observation. The new source prompt has a different hash again; old live metrics must not be retroactively labeled as results of this contract.

## Authorized follow-up: six-tier policy rejection

After root reported live outputs with complete legal citations but a worse conditional-benefit/history choice, the team revised the earlier decision to allow such rankings. The product already defines the comparison priorities explicitly, so these priorities are now enforced rather than entrusted only to the prompt. This change is **policy enforcement, not evidence of AI uplift**.

`backend/src/domain/baseline.ts` now provides a shared `comparePolicyPriority` for all six substantive priorities, in order:

1. More closed critical gaps.
2. Higher direct weighted target gain plus 0.5 times the best unlocked weighted gain.
3. Fewer recent negative outcomes for the same event.
4. Lower observed negative share for a sufficiently observed similar format.
5. Shorter duration.
6. Continuing an equivalent existing activity.

Baseline sorting uses that comparator, then its existing stable event/candidate ID tie-breaks. `backend/src/ai/recommend.ts` checks every selected card against all remaining eligible candidates using precomputed factors; any strictly better remaining candidate rejects the whole AI response into `rules_fallback / invalid_response`. Prior selected candidates are removed from consideration. The guard does not reorder the model's choices, insert explanations, require a complete limit-sized list, or enforce arbitrary ID order among candidates tied on all six priorities. Its comparison work is O(k*n), with k <= 3.

The initial four-tier proposal was expanded to six after method review observed that duration and continuation were also explicit product priorities. No new weights, output contracts, configuration, adapter logic, or prompt changes were made by this follow-up. Root owns contemporaneous adapter/prompt edits and live re-evaluation.

Validation:

- Dedicated final-scope regression before guard: **7 failed, 4 passed** (`policy-before-six-tiers.log`). The earlier four-tier-only reproduction is separately preserved in `policy-before.log`.
- Final unit suite: **451/451 passed**, including all eleven policy tests (`policy-after-unit.log`). Each substantive priority, wrong later card, valid prefixes of one/two/three, exact six-tier ties, and provider-output immutability are covered.
- Initial broad post-guard run: **3 failed, 448 passed** (`policy-after-unit-initial.log`). These tests intentionally supply bad rankings and formerly expected accepted AI; they now explicitly require CLI exit 1, invalid-response fallback, invalid AI counts, and no accepted-AI quality credit even when fallback returns the expected winner/order.
- Final integration: **54 passed, one live test intentionally skipped** (`policy-after-integration.log`). TypeScript passes (`policy-typecheck.log`).
- Independent `astra_method` production-diff review found no blocker: old baseline business order remains intact, ID tie-breaks remain baseline-only, and the remaining-candidate loop rejects whole responses correctly. The lower-level legacy `rankCandidates` helper is used only by its tests; the exported HTTP production flow uses `recommend`. Claim scope is all production recommendations, not every internal compatibility helper.

Tradeoff: the model's ranking freedom is now restricted to substantive ties, prefix length, evidence selection within the completeness contract, and optional comparisons. Valid provider mistakes remain visible as fallback and count against AI acceptance; they are not silently repaired and rebranded as AI. The policy itself is still a heuristic and its correctness or user benefit cannot be established merely by agreeing with it.

Read-only static parity was repeated into `runtime-check-after-build.json` at 12:18:26Z. The 11:59 build contains the earlier evidence-completeness changes, but root's subsequent 12:11 adapter and 12:13 prompt edits again differ from that build. A final rebuild must cover all final source changes, including this guard. No server startup was attempted after root reported policy-blocked startup.
