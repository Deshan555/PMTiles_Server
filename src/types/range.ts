export type ParsedRange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "unsatisfiable" }
  | { kind: "bytes"; start: number; end: number };
