import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requirePermission } from '@/lib/api-auth';
import { canViewClientRevenue } from '@/lib/client-revenue-access';
import { buildStateLookerResult, type RawStateLookerClientRow } from '@/lib/state-looker';

/** Team-safe fields only — no billing, emails, or internal IDs. */
const CLIENT_FIELDS =
  'id, name, reporting_type, sales_package, states_licensed, lifecycle_status, is_live, account_group_id, legal_business_name, brokerage_name, nmls, live_transfer_approved, phone_live_transfer, offer_summary, website, city, state, ghl_subaccount_url, ghl_location_id, facebook_page_name, instagram_handle, ad_account_name, ad_account_url, funnel_url, landing_page_url, thank_you_page_url, second_landing_page_url, daily_adspend';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const denied = requirePermission(ctx, 'state_looker');
  if (denied) return denied;

  const subject = { isOwner: ctx.isOwner, allowedPermissions: ctx.allowedPermissions };
  const includeRevenue = canViewClientRevenue(subject);

  const clientsRes = await ctx.service
    .from('clients')
    .select(CLIENT_FIELDS)
    .order('name');

  if (clientsRes.error) {
    return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  }

  const rows = (clientsRes.data ?? []) as unknown as RawStateLookerClientRow[];
  const groupIds = [...new Set(rows.map(c => c.account_group_id).filter(Boolean))] as string[];

  let accountGroups: Record<string, { display_name: string }> = {};
  if (groupIds.length) {
    const groupsRes = await ctx.service
      .from('client_account_groups')
      .select('id, display_name')
      .in('id', groupIds);

    if (groupsRes.error) {
      return NextResponse.json({ error: groupsRes.error.message }, { status: 500 });
    }

    accountGroups = Object.fromEntries(
      (groupsRes.data ?? []).map(g => [g.id, { display_name: g.display_name }]),
    );
  }

  // Daily adspend is the media-buying operating budget, not client revenue.
  // The Media Buying directory always includes it so the buyer can check the rollup.
  const result = buildStateLookerResult(rows, accountGroups);
  return NextResponse.json({ ...result, can_view_revenue: includeRevenue });
}
