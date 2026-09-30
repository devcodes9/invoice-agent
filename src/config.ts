export const MODELS = {
  cheap: { primary: "anthropic/claude-haiku-4.5", second: "google/gemini-3.8-flash" },
  strong: { primary: "anthropic/claude-sonnet-5.5", second: "google/gemini-3.1-pro-preview" },
} as const;

export const TIER: keyof typeof MODELS = "cheap";

export const TOLERANCE = { match: 0.01, sums: 0.01 };
