export function parseTypes(cell: string): { kind: string; qualifier: string }[];
export function parseRegister(markdown: string): { date: string; item: string; type: string; tool: string; edit: string; ships: string }[];
export function disclosureFrom(markdown: string): { lines: { label: string; line: string; model: boolean; entries: number }[]; entries: number; pending: number; modelAudioOrImages: boolean; nothingModelGenerated: boolean };
