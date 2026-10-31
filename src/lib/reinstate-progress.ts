import type { FormType } from '@/lib/form-submissions';

export type SubmissionStamp = {
  form_type: string;
  submitted_at: string;
  status?: string;
};

export function latestReinstateCutoffIso(
  rows: Array<{ form_type: string; submitted_at: string }>,
): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.form_type !== 'reinstate') continue;
    if (!latest || row.submitted_at > latest) latest = row.submitted_at;
  }
  return latest;
}

function inCycle(row: SubmissionStamp, cutoffIso: string | null): boolean {
  if (!cutoffIso) return true; // no reinstate → full history (legacy path)
  return row.submitted_at >= cutoffIso;
}

/** Map cycle submissions onto the Sign→OB→KO→Kit→Live strip keys. */
export function mapCycleProgress(
  rows: SubmissionStamp[],
  cutoffIso: string | null,
): Partial<Record<FormType, boolean>> {
  const out: Partial<Record<FormType, boolean>> = {};
  for (const row of rows) {
    if (row.status && row.status !== 'applied' && row.status !== 'submitted') continue;
    if (!inCycle(row, cutoffIso)) continue;
    if (row.form_type === 'reinstate') out.new_client = true;
    else if (row.form_type === 'reinstate_onboarding') out.onboarding = true;
    else if (
      row.form_type === 'new_client' ||
      row.form_type === 'onboarding' ||
      row.form_type === 'kickoff' ||
      row.form_type === 'tech_qa' ||
      row.form_type === 'marketing_qa' ||
      row.form_type === 'creative' ||
      row.form_type === 'launch_kit' ||
      row.form_type === 'virtual_card' ||
      row.form_type === 'launch'
    ) {
      out[row.form_type as FormType] = true;
    }
  }
  return out;
}

/** True when this cycle has a filed kick-off. A pre-reinstate kick-off does not count. */
export function cycleKickoffFiled(
  rows: Array<{ form_type: string; submitted_at: string; status?: string | null }>,
): boolean {
  const stamps = rows.map(row => ({
    form_type: row.form_type,
    submitted_at: row.submitted_at,
    status: row.status ?? undefined,
  }));
  return mapCycleProgress(stamps, latestReinstateCutoffIso(stamps)).kickoff === true;
}

export function isLaunchBlockingForCycle(
  launchRows: SubmissionStamp[],
  cutoffIso: string | null,
): boolean {
  return launchRows.some(
    (row) =>
      row.form_type === 'launch' &&
      (!row.status || row.status === 'applied') &&
      inCycle(row, cutoffIso),
  );
}
