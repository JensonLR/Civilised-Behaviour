export const CONTRAST_PAIRS: [string, string][];
export const MIN_CONTRAST: number;
export function makeTokens(): Promise<{ css: string; vars: Record<string, string>; contrast: Record<string, number> }>;
export function renderDisclosure(d: unknown): string;
export function buildSite(opts?: { outdir?: string; register?: string; registerText?: string }): Promise<{ outdir: string; disclosure: { lines: { label: string; line: string; model: boolean }[]; entries: number; pending: number; nothingModelGenerated: boolean }; tokens: { css: string } }>;
