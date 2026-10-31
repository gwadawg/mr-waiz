import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, requireAnyPermission, type AuthContext } from '@/lib/api-auth';
import {
  addClickUpTaskComment,
  applyClickUpFieldMap,
  getClickUpToken,
  parseClickUpObFieldMap,
} from '@/lib/clickup';
import { creativeApexFunnelLink } from '@/lib/creative-qa-links';
import { insertFormSubmission } from '@/lib/form-submissions';
import { listLandingRows } from '@/lib/landing-page/storage';
import {
  formatMediaQaClickUpComment,
  formatQaClickUpComment,
  getQaFormConfig,
  isQaChecklistComplete,
  isQaCompleteForCycle,
  isQaLane,
  isQaLifecycle,
  mediaBuyingQaApplies,
  mediaQaToResponses,
  normalizeAdAccountUrl,
  parseMediaQaBody,
  qaDraftFromSubmitBody,
  qaDraftToResponses,
  resolveQaClickUpFieldKey,
  sealCreativeFunnelLinks,
  validateMediaQaDraft,
} from '@/lib/qa-form';

const QA_PERMISSION_KEYS = ['admin_clients', 'admin_billing'];
const QA_CYCLE_FORM_TYPES = ['tech_qa', 'marketing_qa', 'creative', 'reinstate'] as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; lane: string }> },
) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, QA_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId, lane } = await params;
  if (!isQaLane(lane)) {
    return NextResponse.json({ error: 'Unknown QA lane' }, { status: 404 });
  }

  const config = getQaFormConfig(lane);
  const [clientRes, cycleRes, userRes] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, onboarding_clickup_task_id, landing_page_url, thank_you_page_url, reporting_type, states_licensed, ad_account_url')
      .eq('id', clientId)
      .single(),
    ctx.service
      .from('client_form_submissions')
      .select('id, form_type, submitted_at, submitted_by, status, responses')
      .eq('client_id', clientId)
      .in('form_type', [...QA_CYCLE_FORM_TYPES])
      .in('status', ['applied', 'submitted'])
      .order('submitted_at', { ascending: false }),
    ctx.service.auth.admin.getUserById(ctx.userId),
  ]);

  if (clientRes.error) {
    const status = clientRes.error.code === 'PGRST116' ? 404 : 500;
    return NextResponse.json({ error: clientRes.error.message }, { status });
  }

  const cycleRows = cycleRes.data ?? [];
  const latestSubmission =
    cycleRows.find(row => row.form_type === config.formType) ?? null;

  let links: Record<string, string> | undefined;
  if (config.lane === 'creative') {
    const landingRows = await listLandingRows(ctx.service, clientId);
    const perspective = textOrEmpty(clientRes.data.landing_page_url);
    const thankYou = textOrEmpty(clientRes.data.thank_you_page_url);
    links = {
      perspective_funnel_link: perspective,
      apex_funnel_link: creativeApexFunnelLink(landingRows, perspective) ?? '',
      thank_you_link: thankYou,
    };
  }

  return NextResponse.json({
    client: clientRes.data,
    qa_config: config,
    lifecycle_ok: isQaLifecycle(clientRes.data.lifecycle_status),
    already_complete: isQaCompleteForCycle(cycleRows, config.formType),
    latest_submission: latestSubmission,
    default_completed_by: userRes.data.user?.email ?? ctx.userId,
    states_licensed: clientRes.data.states_licensed ?? [],
    media_buying_applies: lane === 'media_buying' ? mediaBuyingQaApplies(clientRes.data.reporting_type) : true,
    ...(links ? { links } : {}),
  });
}

function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; lane: string }> },
) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, QA_PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId, lane } = await params;
  if (!isQaLane(lane)) {
    return NextResponse.json({ error: 'Unknown QA lane' }, { status: 404 });
  }

  const config = getQaFormConfig(lane);
  const body = await req.json().catch(() => null);
  if (lane === 'media_buying') {
    return submitMediaBuyingQa(ctx, clientId, config, body);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  let draft = qaDraftFromSubmitBody(body as Record<string, unknown>);

  if (!isQaChecklistComplete(draft, config)) {
    return NextResponse.json(
      {
        error: config.requireEveryItem
          ? `Complete every ${config.shortLabel} item and type QA to submit.`
          : `Add who completed ${config.shortLabel} and type QA to submit.`,
      },
      { status: 400 },
    );
  }

  const [clientRes, cycleRes] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, onboarding_clickup_task_id, landing_page_url, thank_you_page_url, reporting_type, states_licensed, ad_account_url')
      .eq('id', clientId)
      .single(),
    ctx.service
      .from('client_form_submissions')
      .select('form_type, submitted_at, status')
      .eq('client_id', clientId)
      .in('form_type', [...QA_CYCLE_FORM_TYPES])
      .in('status', ['applied', 'submitted']),
  ]);

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (!isQaLifecycle(clientRes.data.lifecycle_status)) {
    return NextResponse.json(
      { error: `${config.shortLabel} is only available while the client is in onboarding.` },
      { status: 400 },
    );
  }
  if (isQaCompleteForCycle(cycleRes.data ?? [], config.formType)) {
    return NextResponse.json(
      { error: `${config.shortLabel} is already complete for this onboarding cycle.` },
      { status: 409 },
    );
  }

  const taskId = clientRes.data.onboarding_clickup_task_id?.trim() || null;
  const clickupFieldKey = resolveQaClickUpFieldKey(config, parseClickUpObFieldMap());
  if (!clickupFieldKey) {
    return NextResponse.json(
      {
        error: `${config.shortLabel} ClickUp field is not configured in CLICKUP_OB_FIELD_MAP. Add the key creative_qa.`,
      },
      { status: 500 },
    );
  }

  let perspectiveLink = '';
  if (config.lane === 'creative') {
    const landingRows = await listLandingRows(ctx.service, clientId);
    const thankYou = textOrEmpty(clientRes.data.thank_you_page_url);
    perspectiveLink = draft.links.perspective_funnel_link?.trim() ?? '';
    draft = sealCreativeFunnelLinks(draft, {
      perspective: perspectiveLink,
      apex: creativeApexFunnelLink(landingRows, textOrEmpty(clientRes.data.landing_page_url)),
      thankYou: thankYou || null,
    });
  }

  if (!taskId) {
    return NextResponse.json(
      { error: 'Client is missing a ClickUp onboarding task ID. QA writes only to the onboarding task, not the retired Client Hub task.' },
      { status: 400 },
    );
  }

  const token = getClickUpToken();
  if (!token) {
    return NextResponse.json(
      { error: 'CLICKUP_API_TOKEN is not configured; QA cannot trigger ClickUp automation.' },
      { status: 500 },
    );
  }

  const wrote = await applyClickUpFieldMap(
    taskId,
    token,
    { [clickupFieldKey]: 'Complete' },
    '[qa-form]',
  );
  if (wrote < 1) {
    return NextResponse.json(
      {
        error: config.lane === 'creative'
          ? `${config.shortLabel} ClickUp field is not configured in CLICKUP_OB_FIELD_MAP. Add the key creative_qa.`
          : `${config.shortLabel} ClickUp field is not configured in CLICKUP_OB_FIELD_MAP.`,
      },
      { status: 500 },
    );
  }

  await addClickUpTaskComment(
    taskId,
    token,
    formatQaClickUpComment(clientRes.data, config, draft),
  );

  if (config.lane === 'creative' && perspectiveLink) {
    const { error: linkError } = await ctx.service
      .from('clients')
      .update({ landing_page_url: perspectiveLink })
      .eq('id', clientId);
    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }
  }

  const responses = qaDraftToResponses(draft, config);
  const submission = await insertFormSubmission(ctx.service, {
    client_id: clientId,
    form_type: config.formType,
    status: 'applied',
    submitted_by: ctx.userId,
    responses,
    applied_patch: {
      onboarding_clickup_task_id: taskId,
      clickup_field: clickupFieldKey,
      clickup_value: 'Complete',
      ...(perspectiveLink ? { landing_page_url: perspectiveLink } : {}),
    },
  });

  return NextResponse.json({
    submission,
    clickup_task_id: taskId,
    clickup_field: clickupFieldKey,
  });
}

async function submitMediaBuyingQa(
  ctx: AuthContext,
  clientId: string,
  config: ReturnType<typeof getQaFormConfig>,
  body: unknown,
) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const mediaDraft = parseMediaQaBody(body as Record<string, unknown>);
  const problem = validateMediaQaDraft(mediaDraft);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const [clientRes, cycleRes] = await Promise.all([
    ctx.service
      .from('clients')
      .select('id, name, lifecycle_status, onboarding_clickup_task_id, reporting_type, ad_account_url')
      .eq('id', clientId)
      .single(),
    ctx.service
      .from('client_form_submissions')
      .select('form_type, submitted_at, status')
      .eq('client_id', clientId)
      .in('form_type', [...QA_CYCLE_FORM_TYPES])
      .in('status', ['applied', 'submitted']),
  ]);

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (!isQaLifecycle(clientRes.data.lifecycle_status)) {
    return NextResponse.json(
      { error: `${config.shortLabel} is only available while the client is in onboarding.` },
      { status: 400 },
    );
  }
  if (isQaCompleteForCycle(cycleRes.data ?? [], config.formType)) {
    return NextResponse.json(
      { error: `${config.shortLabel} is already complete for this onboarding cycle.` },
      { status: 409 },
    );
  }
  if (!mediaBuyingQaApplies(clientRes.data.reporting_type)) {
    return NextResponse.json(
      { error: 'Media Buying QA does not apply to HE clients. Nothing was stored.' },
      { status: 400 },
    );
  }

  const taskId = clientRes.data.onboarding_clickup_task_id?.trim() || null;
  if (!taskId) {
    return NextResponse.json(
      { error: 'Client is missing a ClickUp onboarding task ID. QA writes only to the onboarding task, not the retired Client Hub task.' },
      { status: 400 },
    );
  }

  const clickupFieldKey = resolveQaClickUpFieldKey(config, parseClickUpObFieldMap());
  if (!clickupFieldKey) {
    return NextResponse.json(
      { error: `${config.shortLabel} ClickUp field is not configured in CLICKUP_OB_FIELD_MAP.` },
      { status: 500 },
    );
  }

  const token = getClickUpToken();
  if (!token) {
    return NextResponse.json(
      { error: 'CLICKUP_API_TOKEN is not configured; QA cannot trigger ClickUp automation.' },
      { status: 500 },
    );
  }

  const wrote = await applyClickUpFieldMap(
    taskId,
    token,
    { [clickupFieldKey]: 'Complete' },
    '[qa-form]',
  );
  if (wrote < 1) {
    return NextResponse.json(
      { error: `${config.shortLabel} ClickUp field is not configured in CLICKUP_OB_FIELD_MAP.` },
      { status: 500 },
    );
  }

  await addClickUpTaskComment(
    taskId,
    token,
    formatMediaQaClickUpComment(clientRes.data, mediaDraft),
  );

  let savedAdAccountUrl: string | null = null;
  if (!mediaDraft.ad_account_skipped) {
    savedAdAccountUrl = normalizeAdAccountUrl(mediaDraft.ad_account_url);
    const linkUpdate = await ctx.service
      .from('clients')
      .update({ ad_account_url: savedAdAccountUrl })
      .eq('id', clientId);
    if (linkUpdate.error) {
      return NextResponse.json(
        { error: `ClickUp was marked complete, but the ad account link was not saved: ${linkUpdate.error.message}` },
        { status: 500 },
      );
    }
  }

  const submission = await insertFormSubmission(ctx.service, {
    client_id: clientId,
    form_type: config.formType,
    status: 'applied',
    submitted_by: ctx.userId,
    responses: mediaQaToResponses(mediaDraft),
    applied_patch: {
      onboarding_clickup_task_id: taskId,
      clickup_field: clickupFieldKey,
      clickup_value: 'Complete',
      ad_account_url: mediaDraft.ad_account_skipped ? null : savedAdAccountUrl,
    },
  });

  return NextResponse.json({
    submission,
    clickup_task_id: taskId,
    clickup_field: clickupFieldKey,
  });
}

