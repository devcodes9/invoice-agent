// Two independent readers per tier. Order doesn't matter: values are kept only where they agree.
export const MODELS = {
  cheap: ["anthropic/claude-haiku-4.5", "google/gemini-3.8-flash"],
  strong: ["anthropic/claude-sonnet-5.5", "google/gemini-3.1-pro-preview"],
} as const;

export const TIER: keyof typeof MODELS = "cheap";

export const TOLERANCE = { match: 0.01, sums: 0.01 };
