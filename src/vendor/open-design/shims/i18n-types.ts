// Hand-written adapter (not vendored). Upstream's `Dict` is the typed key set
// of every locale; here keys are plain strings resolved by src/i18n.
export type Dict = Record<string, string>;
