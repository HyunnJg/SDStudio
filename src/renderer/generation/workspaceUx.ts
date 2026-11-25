import type { GenerationPlan } from '../../workspaceGeneration';

export default function needsSingleUsageConfirmation(
  plan: Pick<GenerationPlan, 'steps' | 'reference'>,
  referenceAcknowledged: boolean,
): boolean {
  return plan.steps > 28 || (!!plan.reference && !referenceAcknowledged);
}
