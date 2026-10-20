import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FORM_SUBMISSION_FIELDS,
  insertFormSubmission,
  type FormSubmissionRow,
} from "@/lib/form-submissions";
import { landingPageUrl, thankYouPageUrl, type LandingProduct } from "./products";
import {
  emptyPublish,
  fieldsFromResponses,
  productFromResponses,
  publishMetaFromResponses,
  toLandingResponses,
} from "./responses";
import {
  LEGACY_SITE_ID,
  rowsMatchSite,
  shouldWritePrimaryUrl,
  siteIdFromResponses,
} from "./sites";
import type { LandingDraft, LandingPublishMeta } from "./types";
import { productionPageIsLive } from "./live";

export async function listLandingRows(
  service: SupabaseClient,
  clientId: string,
): Promise<FormSubmissionRow[]> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select(FORM_SUBMISSION_FIELDS)
    .eq("client_id", clientId)
    .eq("form_type", "landing_page")
    .in("status", ["draft", "submitted", "applied"])
    .order("submitted_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FormSubmissionRow[];
}

export function rowsForSite(rows: FormSubmissionRow[], clientId: string, siteId: string): FormSubmissionRow[] {
  return rows.filter(row => rowsMatchSite(row, clientId, siteId));
}

/**
 * Open publish wins. Else a draft that is at least as new as the last applied
 * save (WIP after a live page). A draft left behind from before that publish is
 * ignored so reopen shows the published fields, not the create-time prefill.
 */
export function landingEditSource(
  submitted: FormSubmissionRow | null,
  draft: FormSubmissionRow | null,
  applied: FormSubmissionRow | null,
): FormSubmissionRow | null {
  if (submitted) return submitted;
  if (draft && applied) {
    return draft.submitted_at >= applied.submitted_at ? draft : applied;
  }
  return draft ?? applied;
}

export async function takenSlugsForProduct(
  service: SupabaseClient,
  product: LandingProduct,
): Promise<Set<string>> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select("responses")
    .eq("form_type", "landing_page")
    .in("status", ["draft", "submitted", "applied"])
    .limit(5000);
  if (error) throw new Error(error.message);
  const taken = new Set<string>();
  for (const row of data ?? []) {
    const responses = row.responses as Record<string, unknown> | null;
    if (productFromResponses(responses) !== product) continue;
    const slug = fieldsFromResponses(responses)?.slug;
    if (slug) taken.add(slug);
  }
  return taken;
}

/** Give an older one-page client a stable id before a second page can be confused with it. */
export async function claimLegacySite(
  service: SupabaseClient,
  clientId: string,
): Promise<string> {
  const rows = rowsForSite(await listLandingRows(service, clientId), clientId, LEGACY_SITE_ID);
  if (rows.length === 0) throw new Error("That landing page was not found");
  const siteId = crypto.randomUUID();
  for (const row of rows) {
    const { error } = await service
      .from("client_form_submissions")
      .update({ responses: { ...row.responses, site_id: siteId } })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  }
  return siteId;
}

export async function getSubmittedByPrNumber(
  service: SupabaseClient,
  prNumber: number,
  repo: string,
): Promise<FormSubmissionRow | null> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select(FORM_SUBMISSION_FIELDS)
    .eq("form_type", "landing_page")
    .eq("status", "submitted")
    .filter("responses->>template_repo", "eq", repo)
    .filter("responses->publish->>pr_number", "eq", String(prNumber))
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormSubmissionRow | null) ?? null;
}

export async function slugTakenByOtherSite(
  service: SupabaseClient,
  slug: string,
  product: LandingProduct,
  owner: { clientId: string; siteId: string },
): Promise<boolean> {
  const key = slug.trim().toLowerCase();
  if (!key) return false;
  const { data, error } = await service
    .from("client_form_submissions")
    .select("client_id, responses")
    .eq("form_type", "landing_page")
    .in("status", ["draft", "submitted", "applied"])
    .filter("responses->fields->>slug", "eq", key)
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []).some(row => {
    const responses = row.responses as Record<string, unknown> | null;
    if (productFromResponses(responses) !== product) return false;
    return !rowsMatchSite(
      { client_id: row.client_id as string | null, responses },
      owner.clientId,
      owner.siteId,
    );
  });
}

/** Drop the open draft for this page so a later load reads the publish, not stale form values. */
export async function dismissLandingDraftsForSite(
  service: SupabaseClient,
  clientId: string,
  siteId: string,
): Promise<void> {
  const drafts = rowsForSite(await listLandingRows(service, clientId), clientId, siteId).filter(
    row => row.status === "draft",
  );
  for (const row of drafts) {
    const { error } = await service
      .from("client_form_submissions")
      .update({ status: "dismissed" })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
  }
}

export async function saveLandingDraft(
  service: SupabaseClient,
  clientId: string,
  draft: LandingDraft,
  submittedBy: string | null,
  site: { siteId: string; product: LandingProduct },
): Promise<FormSubmissionRow> {
  const responses = toLandingResponses(draft, emptyPublish(), site);
  const existing = rowsForSite(await listLandingRows(service, clientId), clientId, site.siteId).find(
    row => row.status === "draft",
  );
  if (existing) {
    const { data, error } = await service
      .from("client_form_submissions")
      .update({
        responses,
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select(FORM_SUBMISSION_FIELDS)
      .single();
    if (error) throw new Error(error.message);
    return data as FormSubmissionRow;
  }
  return insertFormSubmission(service, {
    client_id: clientId,
    form_type: "landing_page",
    status: "draft",
    submitted_by: submittedBy,
    responses,
  });
}

export async function insertLandingPublish(
  service: SupabaseClient,
  clientId: string,
  draft: LandingDraft,
  publish: LandingPublishMeta,
  submittedBy: string | null,
  site: { siteId: string; product: LandingProduct },
): Promise<FormSubmissionRow> {
  const row = await insertFormSubmission(service, {
    client_id: clientId,
    form_type: "landing_page",
    status: "submitted",
    submitted_by: submittedBy,
    responses: toLandingResponses(draft, publish, site),
  });
  // Publish inserts a new row; the draft would otherwise win on reload with older fields.
  await dismissLandingDraftsForSite(service, clientId, site.siteId);
  return row;
}

export type SettleResult = "applied" | "waiting" | "dismissed" | "missing";

export async function settleMergedLanding(
  service: SupabaseClient,
  row: FormSubmissionRow,
  attempts = 1,
): Promise<SettleResult> {
  const fields = fieldsFromResponses(row.responses);
  const publish = publishMetaFromResponses(row.responses);
  const product = productFromResponses(row.responses);
  const siteId = siteIdFromResponses(row.responses);
  if (!fields?.slug || !row.client_id) return "missing";
  const live = await productionPageIsLive(product, fields.slug, attempts);
  const nextPublish: LandingPublishMeta = {
    ...publish,
    merged: true,
    error: live ? null : "Production page is not live yet",
  };
  const responses = toLandingResponses(fields, nextPublish, {
    siteId: siteId === LEGACY_SITE_ID ? null : siteId,
    product,
  });
  if (!live) {
    const { error } = await service
      .from("client_form_submissions")
      .update({ responses })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return "waiting";
  }
  const landing = landingPageUrl(product, fields.slug);
  const thankYou = thankYouPageUrl(product, fields.slug);
  const { error: rowError } = await service
    .from("client_form_submissions")
    .update({
      status: "applied",
      responses,
      applied_patch: { landing_page_url: landing, thank_you_page_url: thankYou },
    })
    .eq("id", row.id);
  if (rowError) throw new Error(rowError.message);
  const { data: client, error: readError } = await service
    .from("clients")
    .select("landing_page_url")
    .eq("id", row.client_id)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (shouldWritePrimaryUrl(client?.landing_page_url as string | null | undefined, landing)) {
    const { error: clientError } = await service
      .from("clients")
      .update({ landing_page_url: landing, thank_you_page_url: thankYou })
      .eq("id", row.client_id);
    if (clientError) throw new Error(clientError.message);
  }
  return "applied";
}

export async function dismissLandingSubmission(
  service: SupabaseClient,
  row: FormSubmissionRow,
): Promise<void> {
  const { error } = await service
    .from("client_form_submissions")
    .update({ status: "dismissed" })
    .eq("id", row.id);
  if (error) throw new Error(error.message);
}
