export interface CutRequest {
  instruction: string;
  style: string;
  characters: string[];
}

export interface SuggestedCut {
  name: string;
  setting: string;
  emotion: string;
}

export interface CutSuggestion {
  cuts: SuggestedCut[];
  // Zero means the user did not specify a repeat count.
  repeats: number;
}

export type CutResult =
  { ok: true; suggestion: CutSuggestion } | { ok: false; message: string };
