import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext, isAuthError, requireAnyPermission } from "@/lib/api-auth";
import { recordClientFormNote } from "@/lib/client-form-notes";
import { insertFormSubmission, kickoffFiledClientIds } from "@/lib/form-submissions";
import { isKickoffIncomplete } from "@/lib/kickoff";
import {
  VIRTUAL_CARD_CLIENT_FIELDS,
  VIRTUAL_CARD_TEMPLATE_VERSION,
  clientPatchFromPublish,
  draftFromClient,
  VIRTUAL_CARD_NOTE_MARKER,
  draftToResponses,
  draftToVirtualCard,
  virtualCardClientFileNoteSections,
  parseVirtualCardDraft,
  smsSnippet,
  validateForPublish,
  type VirtualCardClient,
} from "@/lib/virtual-card/intake";
import { listStylePacks } from "@/lib/virtual-card/packs";
import {
  getLatestPublishedVirtualCard,
  getLatestVirtualCardDraft,
  isSlugTaken,
} from "@/lib/virtual-card/storage";
import { cardPublicUrl, learnPublicUrl } from "@/lib/virtual-card/types";
import { notifyMrWaizActivity, resolveActorDisplayName } from "@/lib/mr-waiz-activity-notify";

const PERMISSION_KEYS = ["admin_clients", "admin_billing"];

async function loadClient(service: SupabaseClient, clientId: string) {
  const { data, error } = await service
    .from("clients")
    .select(VIRTUAL_CARD_CLIENT_FIELDS)
    .eq("id", clientId)
    .single();
  if (error || !data) return null;
  return data as unknown as VirtualCardClient;
}

async function loadCalendarFromLaunchKit(
  service: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data } = await service
    .from("client_form_submissions")
    .select("responses, status, submitted_at")
    .eq("client_id", clientId)
    .eq("form_type", "launch_kit")
    .in("status", ["applied", "draft"])
    .order("submitted_at", { ascending: false })
    .limit(5);
  for (const row of data ?? []) {
    const r = row.responses as Record<string, unknown> | null;
    const url = typeof r?.calendar_url === "string" ? r.calendar_url.trim() : "";
    if (url) return url;
  }
  return null;
}

async function loadHeadshotUrl(
  service: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  // Prefer public headshot from storage listing if column not present —
  // many clients store headshot in onboarding responses.
  const { data } = await service
    .from("client_form_submissions")
    .select("responses")
    .eq("client_id", clientId)
    .in("form_type", ["onboarding", "kickoff", "new_client"])
    .in("status", ["applied", "submitted"])
    .order("submitted_at", { ascending: false })
    .limit(10);
  for (const row of data ?? []) {
    const r = row.responses as Record<string, unknown> | null;
    if (!r) continue;
    for (const key of ["headshot_url", "headshotUrl", "photo_url", "photoUrl"]) {
      const v = r[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) return v.trim();
    }
  }
  return null;
}

async function loadOnboardingCall(service: SupabaseClient, clientId: string) {
  const { data } = await service
    .from("client_calls")
    .select("id, recording_url")
    .eq("client_id", clientId)
    .eq("call_type", "onboarding")
    .is("deleted_at", null)
    .order("called_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const [client, onboardingCall, draftRow, publishedRow, calendarUrl, headshotUrl, kickoffFiled] =
    await Promise.all([
      loadClient(ctx.service, clientId),
      loadOnboardingCall(ctx.service, clientId),
      getLatestVirtualCardDraft(ctx.service, clientId),
      getLatestPublishedVirtualCard(ctx.service, clientId),
      loadCalendarFromLaunchKit(ctx.service, clientId),
      loadHeadshotUrl(ctx.service, clientId),
      kickoffFiledClientIds(ctx.service, [clientId]),
    ]);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const prefillSource =
    draftRow && (!publishedRow || draftRow.submitted_at > publishedRow.submitted_at)
      ? draftRow
      : publishedRow;

  const draft = draftFromClient(client, prefillSource?.responses ?? null, {
    calendarUrl,
    headshotUrl,
  });

  const product = draft.product === "dscr" || draft.product === "rm" ? draft.product : "rm";
  const packs = listStylePacks(product).map(p => ({
    pack_id: p.pack_id,
    display_name: p.display_name,
    mood: p.mood,
    light_or_dark: p.light_or_dark,
    accent: p.colors.accent,
    paper: p.colors.paper,
    sample_value_line: p.sample_value_line,
  }));

  const publishedCard = publishedRow
    ? draftToVirtualCard(parseVirtualCardDraft(publishedRow.responses), clientId)
    : null;

  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      lifecycle_status: client.lifecycle_status,
      reporting_type: client.reporting_type,
      virtual_business_card_url: client.virtual_business_card_url,
      virtual_card_slug: client.virtual_card_slug,
    },
    kickoff_complete: !isKickoffIncomplete(client, onboardingCall, kickoffFiled.has(clientId)),
    draft,
    prefill_source: prefillSource ? prefillSource.status : null,
    packs,
    published: publishedCard
      ? {
          slug: publishedCard.slug,
          card_url: cardPublicUrl(publishedCard.slug),
          learn_url: learnPublicUrl(publishedCard.slug),
          sms_snippet: smsSnippet(publishedCard),
          qr_url: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(cardPublicUrl(publishedCard.slug))}`,
        }
      : null,
    template_version: VIRTUAL_CARD_TEMPLATE_VERSION,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const body = (await req.json().catch(() => null)) as {
    mode?: string;
    draft?: unknown;
  } | null;
  const mode = body?.mode === "publish" ? "publish" : "draft";
  const draft = parseVirtualCardDraft(body?.draft);

  const client = await loadClient(ctx.service, clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  if (mode === "draft") {
    await recordClientFormNote(
      ctx.service,
      clientId,
      VIRTUAL_CARD_NOTE_MARKER,
      virtualCardClientFileNoteSections(draft),
      ctx.userId,
    );
    const submission = await insertFormSubmission(ctx.service, {
      client_id: clientId,
      form_type: "virtual_card",
      status: "draft",
      submitted_by: ctx.userId,
      responses: draftToResponses(draft),
    });
    return NextResponse.json({ mode, submission_id: submission.id });
  }

  const errors = validateForPublish(draft);
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  if (await isSlugTaken(ctx.service, draft.slug, clientId)) {
    return NextResponse.json(
      { error: `Slug "${draft.slug}" is already used by another card` },
      { status: 400 },
    );
  }

  const card = draftToVirtualCard(draft, clientId);
  const clientPatch = clientPatchFromPublish(card);

  const { error: patchErr } = await ctx.service
    .from("clients")
    .update(clientPatch)
    .eq("id", clientId);
  if (patchErr) {
    console.error("[virtual-card] client patch failed", patchErr.message);
    return NextResponse.json({ error: `Failed to save card URL: ${patchErr.message}` }, { status: 500 });
  }

  const responses = {
    ...draftToResponses(draft),
    ...card,
    published_at: new Date().toISOString(),
    template_version: VIRTUAL_CARD_TEMPLATE_VERSION,
  };

  await recordClientFormNote(
    ctx.service,
    clientId,
    VIRTUAL_CARD_NOTE_MARKER,
    virtualCardClientFileNoteSections(draft),
    ctx.userId,
  );

  const submission = await insertFormSubmission(ctx.service, {
    client_id: clientId,
    form_type: "virtual_card",
    status: "applied",
    submitted_by: ctx.userId,
    responses,
    applied_patch: clientPatch,
  });

  await ctx.service
    .from("client_form_submissions")
    .update({ status: "dismissed" })
    .eq("client_id", clientId)
    .eq("form_type", "virtual_card")
    .eq("status", "draft");

  const cardUrl = cardPublicUrl(card.slug);
  const learnUrl = learnPublicUrl(card.slug);
  const snippet = smsSnippet(card);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(cardUrl)}`;

  const actor = await resolveActorDisplayName(ctx.service, { userId: ctx.userId });
  void notifyMrWaizActivity(ctx.service, {
    eventKey: "client.virtual_card_published",
    actor: { userId: ctx.userId, label: actor },
    fields: {
      client_name: client.name,
      slug: card.slug,
      card_url: cardUrl,
      product: card.product,
    },
  }).catch(() => {});

  return NextResponse.json({
    mode: "publish",
    submission_id: submission.id,
    card_url: cardUrl,
    learn_url: learnUrl,
    sms_snippet: snippet,
    qr_url: qrUrl,
    virtual_business_card_url: cardUrl,
    virtual_card_slug: card.slug,
  });
}
