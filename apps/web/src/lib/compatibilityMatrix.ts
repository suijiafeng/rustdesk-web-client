// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export type MatrixStatus = 'untested';

export interface CompatibilityRow {
  controller: string;
  controlled: string;
  status: MatrixStatus;
  evidence: string;
}

/** Real-device pairs from the migration plan. Automated tests do not mark these as tested. */
export const COMPATIBILITY_MATRIX: readonly CompatibilityRow[] = [
  { controller: 'Chrome / Windows', controlled: 'Windows', status: 'untested', evidence: '' },
  { controller: 'Chrome / macOS', controlled: 'Windows', status: 'untested', evidence: '' },
  { controller: 'Edge / Windows', controlled: 'Windows', status: 'untested', evidence: '' },
  { controller: 'Chrome / Android', controlled: 'Windows', status: 'untested', evidence: '' },
  { controller: 'Safari / iOS', controlled: 'Windows', status: 'untested', evidence: '' },
  { controller: 'Chrome / macOS', controlled: 'macOS', status: 'untested', evidence: '' },
  { controller: 'Chrome / Linux', controlled: 'Linux', status: 'untested', evidence: '' },
  { controller: 'Safari / iOS', controlled: 'macOS', status: 'untested', evidence: '' },
];

export function untestedRows(rows: readonly CompatibilityRow[]): CompatibilityRow[] {
  return rows.filter((row) => row.status !== 'untested' || row.evidence !== '');
}
