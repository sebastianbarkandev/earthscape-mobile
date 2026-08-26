/** Types for the verbatim mergeGraphData.js port. graphs = {category: {name: series}}. */
export type GraphData = Record<string, Record<string, Array<[number, unknown]>>>;
export function mergeGraphData(a: GraphData | null | undefined, b: GraphData | null | undefined): GraphData;
