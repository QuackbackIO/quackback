# Quinn mockup parity

Reference: `/home/james/Downloads/quinn-product-implementation-spec-reconciled.html`, reconciled revision 4. This tracks functional differences as well as appearance. Reference sample names, counts and successful checks must be replaced with real authorized data.

The requested scope includes all 17 connected views and their dialogs. A checkbox here means implemented and verified, not merely present in the prototype.

| Surface                   | Present                                                                                           | Remaining parity work                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                  | Quinn navigation; independent use cards; configuration-aware status; configuration destinations   | Authorized attention queue, real source/guidance/connection summaries, inbox shortcut, tested-draft actions                               |
| Knowledge                 | Per-type and document/page per-row use switches; uploads; URL intake; Help Center management link | Source counts/health, details and references, staged refresh retaining the last good generation, unified Add source entry point           |
| Guidance                  | Lossless legacy projection; filters/search; retained drafts and concurrent-delete errors          | Split editor, canonical shared entries and atomic use bindings, references/examples, saved drafts and publication                         |
| Connections               | External connectors and built-in rules                                                            | Unified selection/editor, independently versioned external per-use policies, reviewed discovery/schema contracts, review-and-save changes |
| Deploy                    | Customer/team controls; channel links; honest setup status                                        | Match channel rows, explicit Email/managed Workspace and Slack rows, exact candidate release actions                                      |
| Test Quinn                | Existing evaluation foundation                                                                    | Exact candidate sandbox, required checks with real results, stale-check invalidation and publication gate                                 |
| Improve                   | Existing involvement/action/team metrics                                                          | Completed-conversation outcomes, authorized review queue/live list, run inspection and conversation-to-guidance improvement               |
| Workflows                 | Existing builder and Quinn blocks                                                                 | Durable correlated Quinn delegation/waits and recoverable run inspection                                                                  |
| Channel lifecycle         | Channel-specific built-in controls, custom/off ownership and retained drafts                      | Approval/result waits integrated with durable ownership and inactivity                                                                    |
| Help Center article       | Per-use switches and exclusion filter                                                             | Source/reference details and contextual exact-candidate tests                                                                             |
| Inbox                     | Ask Quinn and existing approval cards                                                             | Durable action/result states, provenance inspection, approval distinct from takeover, private late results                                |
| Needs approval            | Existing parent-scoped pending-action reads                                                       | Authorized review queue; atomic decision/enqueue; resumable execution and expiry                                                          |
| Feedback                  | Existing conversion and feedback detail                                                           | Internal audience/provenance, idempotent capture/link, isolated publication and private evidence                                          |
| Messenger                 | Validated final answers and current-source checks                                                 | Durable publication fences, truthful approval/result continuation and feedback links                                                      |
| Public source/Help Center | Revocation-aware customer source endpoint                                                         | Rich authorized source display without exposing private originals                                                                         |
| Email                     | Existing conversation and teammate email support                                                  | Match honest availability view; autonomous Quinn replies require separate channel acceptance                                              |
| Workspace/Slack           | Existing managed defaults and linked teammate authority                                           | Consistent source/action inspection and durable result semantics within existing surface policies                                         |

## Dependency order

Follow specification steps 3–12: durable run/snapshot/publication primitives; independent connection contracts; replayable actions and queued approvals; workflow/lifecycle waits; internal feedback privacy; canonical guidance; staged retrieval/evidence; exact-candidate evaluation/publication; operational inspection; channel extensions. Styling and navigation improvements can proceed earlier where the current backend supports their claims.

No Redis is required: durable work uses the existing PostgreSQL job queue and transactional outbox. No push, merge or deployment is included.
