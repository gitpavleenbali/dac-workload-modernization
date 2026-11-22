# Workload documentation refresh

**Outcome:** A reviewed code change can be understood from the diagrams and guides already in this repository.

| Acceptance criterion | Evidence |
| --- | --- |
| Generated facts reflect the current declared architecture. | A change to a supported fact in `infra/`, `deploy/`, `Dockerfile`, or `openapi/openapi.yaml` is reflected in a managed section. Changes that do not alter supported facts may leave generated content unchanged. |
| Existing documents remain the place to read the result. | `README.md` and `docs/architecture.md` keep their paths. `BEGIN DAC` and `END DAC` bound the generated updates. |
| Human-authored content is unchanged. | Review of the diff outside the managed blocks. Existing rationale, notes and policies remain in place. |
| The result can be reviewed before it is published. | `npm run dac:verify` and `npm test` results accompany the local diff. No deployment, push, or central-repository write is part of the local task. |

Source commits describe intended configuration, not live Azure state. If an application change is not represented in a supported contract, it needs a separate documentation decision. The central pull request is handled by the repository workflow.
