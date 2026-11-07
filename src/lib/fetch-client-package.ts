import type { SupabaseClient } from '@supabase/supabase-js';
import { VOIDED_BILLING_STATUS } from '@/lib/billing-query';
import { CLIENT_CALL_FIELDS } from '@/lib/client-calls';
import {
  buildBillingSummary,
  extractChurnContext,
  type ClientContextPackage,
} from '@/lib/client-context';

const PROFILE_FIELDS =
  'id, name, is_live, reporting_type, lifecycle_status, client_stage, mrr, billing_type, billing_day, launch_date, date_signed, contract_end_date, contract_term_months, daily_adspend, performance_terms, cs_status, ad_status, email, phone, source, offer, churned_at, kpi_benchmarks, created_at';

const HISTORY_FIELDS =
  'id, previous_status, new_status, reason_code, note, mrr_at_change, changed_at, related_call_id';

const NOTE_FIELDS =
  'id, note_type, reason_code, body, related_call_id, created_at, created_by, updated_at';

const BILLING_FIELDS =
  'id, billed_on, amount, amount_paid, status, revenue_type, revenue_segment, term_months, processing_fee, stripe_invoice_id, is_first_payment, note, paid_on, status_history_id';

const ACTION_FIELDS =
  'id, title, layer, constraint_label, change_description, status, outcome_notes, created_at';

const ATTRIBUTE_FIELDS = 'id, attr_key, attr_value, updated_at';

const ACTIVITY_FIELDS =
  'source_id, activity_type, occurred_at, subtype, summary, source_table';

const SNAPSHOT_FIELDS =
  'id, period_start, period_end, window_code, cpconv, cpql, cpl, conversation_yield, show_rate, booking_rate, lead_to_qual, attention_score, worst_tier, primary_constraint, constraint_label, ai_diagnosis, created_at';

export type FetchPackageOptions = {
  includeRevenue?: boolean;
  redactClient?: (row: Record<string, unknown>) => Record<string, unknown>;
  redactBillings?: (rows: Record<string, unknown>[] | null) => Record<string, unknown>[];
};

/** CRM context package shared by /context API and AI diagnose. */
export async function fetchClientContextPackage(
  service: SupabaseClient,
  clientId: string,
  opts: FetchPackageOptions = {},
): Promise<{ pkg: ClientContextPackage; rawBillings: Record<string, unknown>[] } | { error: string }> {
  const includeRevenue = opts.includeRevenue ?? true;

  const [
    clientRes,
    historyRes,
    callsRes,
    notesRes,
    billingsRes,
    actionsRes,
    attrsRes,
    activityRes,
    snapshotRes,
  ] = await Promise.all([
    service.from('clients').select(PROFILE_FIELDS).eq('id', clientId).single(),
    service
      .from('client_status_history')
      .select(HISTORY_FIELDS)
      .eq('client_id', clientId)
      .order('changed_at', { ascending: false })
      .limit(50),
    service
      .from('client_calls')
      .select(CLIENT_CALL_FIELDS)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('called_at', { ascending: false })
      .limit(30),
    service
      .from('client_notes')
      .select(NOTE_FIELDS)
      .eq('client_id', clientId)
      .is('contact_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    service
      .from('client_billings')
      .select(BILLING_FIELDS)
      .neq('status', VOIDED_BILLING_STATUS)
      .eq('client_id', clientId)
      .order('billed_on', { ascending: false })
      .limit(24),
    service
      .from('client_action_logs')
      .select(ACTION_FIELDS)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(30),
    service.from('client_attributes').select(ATTRIBUTE_FIELDS).eq('client_id', clientId).order('attr_key'),
    service
      .from('v_client_activity')
      .select(ACTIVITY_FIELDS)
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(80),
    service
      .from('client_health_snapshots')
      .select(SNAPSHOT_FIELDS)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (clientRes.error) {
    return { error: clientRes.error.message };
  }

  const profile = opts.redactClient
    ? opts.redactClient(clientRes.data as Record<string, unknown>)
    : (clientRes.data as Record<string, unknown>);
  const lifecycle = historyRes.data ?? [];
  const calls = callsRes.data ?? [];
  const notes = notesRes.data ?? [];
  const rawBillings = (billingsRes.data ?? []) as Record<string, unknown>[];
  const billings = opts.redactBillings ? opts.redactBillings(rawBillings) : rawBillings;
  const actions = actionsRes.data ?? [];
  const attributes = attrsRes.data ?? [];
  const activity_timeline = activityRes.data ?? [];
  const health_latest = snapshotRes.data?.[0] ?? null;

  const pkg: ClientContextPackage = {
    profile,
    lifecycle: lifecycle as Record<string, unknown>[],
    calls: calls as Record<string, unknown>[],
    notes: notes as Record<string, unknown>[],
    billings,
    billing_summary: buildBillingSummary(
      rawBillings as Array<{
        billed_on: string;
        status: string | null;
        amount: number;
        amount_paid?: number | null;
      }>,
      includeRevenue ? ((clientRes.data?.mrr as number | null) ?? null) : null,
    ),
    actions: actions as Record<string, unknown>[],
    attributes: attributes as Record<string, unknown>[],
    activity_timeline: activity_timeline as ClientContextPackage['activity_timeline'],
    health_latest: health_latest as Record<string, unknown> | null,
    churn: extractChurnContext(
      clientRes.data ?? {},
      lifecycle as Array<{ new_status: string; reason_code?: string | null; note?: string | null }>,
    ),
  };

  return { pkg, rawBillings };
}

/** Compact CRM summary for AI prompts (token-conscious). */
export function formatCrmContextForAi(pkg: ClientContextPackage): string {
  const lines: string[] = [];
  lines.push(`Lifecycle: ${pkg.profile.lifecycle_status ?? 'unknown'}; live=${pkg.profile.is_live ?? false}`);
  if (pkg.churn.latest_churn_reason) {
    lines.push(`Latest churn/off-board reason: ${pkg.churn.latest_churn_reason}${pkg.churn.latest_churn_note ? ` — ${pkg.churn.latest_churn_note}` : ''}`);
  }
  if (pkg.notes.length) {
    lines.push('Recent notes:');
    for (const n of pkg.notes.slice(0, 8)) {
      lines.push(`- [${n.note_type}] ${String(n.body).slice(0, 200)}`);
    }
  }
  if (pkg.calls.length) {
    lines.push('Recent account calls:');
    for (const c of pkg.calls.slice(0, 6)) {
      lines.push(
        `- ${c.call_type} @ ${c.called_at}: ${String(c.notes ?? c.transcript ?? '').slice(0, 160) || '(no notes)'}`,
      );
    }
  }
  if (pkg.billing_summary.mrr != null) {
    lines.push(
      `Billing: MRR $${pkg.billing_summary.mrr}; outstanding $${pkg.billing_summary.outstanding_balance}; last ${pkg.billing_summary.last_billing_on ?? 'none'}`,
    );
  }
  if (pkg.actions.length) {
    lines.push('Recent interventions:');
    for (const a of pkg.actions.slice(0, 5)) {
      lines.push(`- ${a.title} (${a.status}): ${String(a.change_description ?? '').slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}
