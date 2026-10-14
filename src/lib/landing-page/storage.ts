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
import type { LandingDraft, LandingPublishMeta } from "./types";
import { productionPageIsLive } from "./live";

export async function getLatestLandingDraft(
  service: SupabaseClient,
  clientId: string,
): Promise<FormSubmissionRow | null> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select(FORM_SUBMISSION_FIELDS)
    .eq("client_id", clientId)
    .eq("form_type", "landing_page")
    .eq("status", "draft")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormSubmissionRow | null) ?? null;
}

export async function getLatestAppliedLanding(
  service: SupabaseClient,
  clientId: string,
): Promise<FormSubmissionRow | null> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select(FORM_SUBMISSION_FIELDS)
    .eq("client_id", clientId)
    .eq("form_type", "landing_page")
    .eq("status", "applied")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormSubmissionRow | null) ?? null;
}

export async function getOpenLandingSubmission(
  service: SupabaseClient,
  clientId: string,
): Promise<FormSubmissionRow | null> {
  const { data, error } = await service
    .from("client_form_submissions")
    .select(FORM_SUBMISSION_FIELDS)
    .eq("client_id", clientId)
    .eq("form_type", "landing_page")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormSubmissionRow | null) ?? null;
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

export async function slugTakenByOtherClient(
  service: SupabaseClient,
  slug: string,
  clientId: string,
  product: LandingProduct,
): Promise<boolean> {
  const key = slug.trim().toLowerCase();
  if (!key) return false;
  const { data, error } = await service
    .from("client_form_submissions")
    .select("client_id")
    .eq("form_type", "landing_page")
    .in("status", ["draft", "submitted", "applied"])
    .filter("responses->>product", "eq", product)
    .filter("responses->fields->>slug", "eq", key)
    .neq("client_id", clientId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function saveLandingDraft(
  service: SupabaseClient,
  clientId: string,
  draft: LandingDraft,
  submittedBy: string | null,
  product: LandingProduct,
): Promise<FormSubmissionRow> {
  const responses = toLandingResponses(draft, emptyPublish(), product);
  const existing = await getLatestLandingDraft(service, clientId);
  if (existing) {
    const { data, error } = await service
      .from("client_form_submissions")
      .update({
        responses,
        submitted_by: submittedBy,
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
  product: LandingProduct,
): Promise<FormSubmissionRow> {
  return insertFormSubmission(service, {
    client_id: clientId,
    form_type: "landing_page",
    status: "submitted",
    submitted_by: submittedBy,
    responses: toLandingResponses(draft, publish, product),
  });
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
  if (!fields?.slug || !row.client_id) return "missing";
  const live = await productionPageIsLive(product, fields.slug, attempts);
  const nextPublish: LandingPublishMeta = {
    ...publish,
    merged: true,
    error: live ? null : "Production page is not live yet",
  };
  const responses = toLandingResponses(fields, nextPublish, product);
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
  const { error: clientError } = await service
    .from("clients")
    .update({ landing_page_url: landing, thank_you_page_url: thankYou })
    .eq("id", row.client_id);
  if (clientError) throw new Error(clientError.message);
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
