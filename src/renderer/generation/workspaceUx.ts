import { requiresAnlasWarning } from './generationPresentation';
import type { GenerationPlan } from '../../workspaceGeneration';

export default function needsSingleUsageConfirmation(
  plan: Pick<GenerationPlan, 'steps' | 'reference'> &
    Partial<Pick<GenerationPlan, 'width' | 'height'>>,
  referenceAcknowledged: boolean,
): boolean {
  return (
    requiresAnlasWarning(plan) || (!!plan.reference && !referenceAcknowledged)
  );
}
