import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext, isAuthError, requireAnyPermission } from "@/lib/api-auth";
import { uploadBrandAsset, downloadBrandAsset, type BrandAssetKind } from "@/lib/landing-page/assets";
import { applyRedirectFiles, yamlExistsOnMain, openLandingPull } from "@/lib/landing-page/github";
import { headshotRepoFile, logoRepoFile } from "@/lib/landing-page/headshot";
import {
  draftForPublish,
  draftFromClient,
  nextNumberedSlug,
  parseLandingDraft,
  prefillLandingDraft,
  suggestSlug,
  validateForPublish,
} from "@/lib/landing-page/intake";
import {
  LANDING_PRODUCTS,
  landingPageUrl,
  SLUG_PATTERN,
  thankYouPageUrl,
  yamlPath,
  type LandingProduct,
} from "@/lib/landing-page/products";
import { fieldsFromResponses, productFromResponses, publishMetaFromResponses } from "@/lib/landing-page/responses";
import { groupLandingSites, isSiteId, LEGACY_SITE_ID } from "@/lib/landing-page/sites";
import {
  claimLegacySite,
  insertLandingPublish,
  landingEditSource,
  listLandingRows,
  rowsForSite,
  saveLandingDraft,
  settleMergedLanding,
  slugTakenByOtherSite,
  takenSlugsForProduct,
} from "@/lib/landing-page/storage";
import { LANDING_CLIENT_FIELDS, type LandingClient, type LandingDraft } from "@/lib/landing-page/types";
import { draftToYaml } from "@/lib/landing-page/yaml";
import type { FormSubmissionRow } from "@/lib/form-submissions";

const PERMISSION_KEYS = ["admin_clients", "admin_billing"];

async function loadClient(service: SupabaseClient, clientId: string) {
  const { data, error } = await service
    .from("clients")
    .select(LANDING_CLIENT_FIELDS)
    .eq("id", clientId)
    .single();
  if (error || !data) return null;
  return data as unknown as LandingClient;
}

async function loadOnboardingFirstName(
  service: SupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data } = await service
    .from("client_form_submissions")
    .select("responses")
    .eq("client_id", clientId)
    .eq("form_type", "onboarding")
    .in("status", ["applied", "submitted"])
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const responses = data?.responses as Record<string, unknown> | null;
  const first = responses?.first_name;
  return typeof first === "string" ? first.trim() : null;
}

function isLandingProduct(value: unknown): value is LandingProduct {
  return typeof value === "string" && (LANDING_PRODUCTS as readonly string[]).includes(value);
}

function statusRow(rows: FormSubmissionRow[], status: FormSubmissionRow["status"]) {
  return rows.find(row => row.status === status) ?? null;
}

async function attachBrandFile(
  files: { path: string; bytes: Buffer }[],
  slug: string,
  url: string | null,
  kind: BrandAssetKind,
) {
  if (!url) return;
  const asset = await downloadBrandAsset(url, kind);
  const file =
    kind === "logo"
      ? logoRepoFile(slug, { contentType: asset.contentType, filename: asset.filename })
      : headshotRepoFile(slug, { contentType: asset.contentType, filename: asset.filename });
  files.push({ path: file.path, bytes: asset.bytes });
}

function formPayload(
  client: LandingClient,
  siteId: string,
  product: LandingProduct,
  siteRows: FormSubmissionRow[],
  firstName: string | null,
) {
  const draftRow = statusRow(siteRows, "draft");
  const appliedRow = statusRow(siteRows, "applied");
  const submittedRow = statusRow(siteRows, "submitted");
  const source = landingEditSource(submittedRow, draftRow, appliedRow);
  const saved = fieldsFromResponses(source?.responses ?? null);
  const draft = prefillLandingDraft(client, saved, firstName, product);
  const appliedSlug = fieldsFromResponses(appliedRow?.responses ?? null)?.slug ?? "";
  if (appliedSlug) draft.slug = appliedSlug;
  const liveSlug = appliedSlug;
  return {
    siteId,
    product,
    draft,
    locked: !!submittedRow,
    hasApplied: !!appliedRow,
    slugLocked: !!appliedSlug,
    publish: publishMetaFromResponses((submittedRow ?? appliedRow)?.responses ?? null),
    landingPageUrl: liveSlug ? landingPageUrl(product, liveSlug) : null,
    thankYouPageUrl: liveSlug ? thankYouPageUrl(product, liveSlug) : null,
    headshotUrl: client.headshot_url,
    logoUrl: client.logo_url,
  };
}

async function resolveSiteId(
  service: SupabaseClient,
  clientId: string,
  siteId: string,
): Promise<string> {
  if (siteId !== LEGACY_SITE_ID) return siteId;
  return claimLegacySite(service, clientId);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const client = await loadClient(ctx.service, clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  let siteId = new URL(req.url).searchParams.get("site");
  let rows = await listLandingRows(ctx.service, clientId);

  if (!siteId) {
    return NextResponse.json({
      sites: groupLandingSites(rows),
      headshotUrl: client.headshot_url,
      logoUrl: client.logo_url,
    });
  }
  if (!isSiteId(siteId)) {
    return NextResponse.json({ error: "Unknown landing page" }, { status: 400 });
  }
  if (siteId === LEGACY_SITE_ID) {
    try {
      siteId = await claimLegacySite(ctx.service, clientId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "That landing page was not found";
      return NextResponse.json({ error: message }, { status: 404 });
    }
    rows = await listLandingRows(ctx.service, clientId);
  }

  const siteRows = rowsForSite(rows, clientId, siteId);
  if (siteRows.length === 0) {
    return NextResponse.json({ error: "That landing page was not found" }, { status: 404 });
  }
  const product = productFromResponses(siteRows[0]?.responses);
  const firstName = await loadOnboardingFirstName(ctx.service, clientId);
  return NextResponse.json(formPayload(client, siteId, product, siteRows, firstName));
}

async function uploadLandingAsset(
  service: SupabaseClient,
  clientId: string,
  req: Request,
) {
  const form = await req.formData();
  const siteId = form.get("siteId");
  const rows = await listLandingRows(service, clientId);
  const openRows =
    typeof siteId === "string" && isSiteId(siteId)
      ? rowsForSite(rows, clientId, siteId)
      : rows;
  if (openRows.some(row => row.status === "submitted")) {
    return NextResponse.json(
      { error: "A publish is already open for this page. Wait until it merges or is closed." },
      { status: 409 },
    );
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if (kind !== "headshot" && kind !== "logo") {
    return NextResponse.json({ error: "Choose a headshot or a logo" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose an image file" }, { status: 400 });
  }
  try {
    const url = await uploadBrandAsset(service, clientId, kind, {
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json(kind === "logo" ? { logoUrl: url } : { headshotUrl: url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    const status = /PNG, JPG, or WEBP|4MB|empty|Choose/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const client = await loadClient(ctx.service, clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return uploadLandingAsset(ctx.service, clientId, req);
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    draft?: unknown;
    siteId?: unknown;
    product?: unknown;
  } | null;
  const action = body?.action;
  const firstName = await loadOnboardingFirstName(ctx.service, clientId);

  if (action === "create") {
    if (!isLandingProduct(body?.product)) {
      return NextResponse.json({ error: "Choose DSCR, Reverse, or HomeSafe" }, { status: 400 });
    }
    const product = body.product;
    const taken = await takenSlugsForProduct(ctx.service, product);
    const base = suggestSlug(client.primary_contact_name || client.name || "") || "page";
    const draft = draftFromClient(client, firstName, product, taken);
    draft.slug = nextNumberedSlug(base, taken, product);
    const siteId = crypto.randomUUID();
    await saveLandingDraft(ctx.service, clientId, draft, ctx.userId, { siteId, product });
    const siteRows = rowsForSite(await listLandingRows(ctx.service, clientId), clientId, siteId);
    return NextResponse.json(formPayload(client, siteId, product, siteRows, firstName));
  }

  const rawSiteId = typeof body?.siteId === "string" ? body.siteId : "";
  if (!isSiteId(rawSiteId)) {
    return NextResponse.json({ error: "Choose a landing page first" }, { status: 400 });
  }

  let siteId = rawSiteId;
  if (siteId === LEGACY_SITE_ID) {
    try {
      siteId = await resolveSiteId(ctx.service, clientId, siteId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "That landing page was not found";
      return NextResponse.json({ error: message }, { status: 404 });
    }
  }

  const siteRows = rowsForSite(await listLandingRows(ctx.service, clientId), clientId, siteId);
  if (siteRows.length === 0) {
    return NextResponse.json({ error: "That landing page was not found" }, { status: 404 });
  }
  const product = productFromResponses(siteRows[0]?.responses);
  const open = statusRow(siteRows, "submitted");

  if (action === "check") {
    if (!open) {
      return NextResponse.json({ error: "No open publish to check" }, { status: 404 });
    }
    const meta = publishMetaFromResponses(open.responses);
    if (!meta.merged) {
      return NextResponse.json({ error: "The pull request is not merged yet", publish: meta }, { status: 409 });
    }
    const result = await settleMergedLanding(ctx.service, open, 1);
    const fresh = await loadClient(ctx.service, clientId);
    const slug = fieldsFromResponses(open.responses)?.slug ?? "";
    const landing = slug ? landingPageUrl(product, slug) : null;
    const thankYou = slug ? thankYouPageUrl(product, slug) : null;
    const previous = formPayload(client, siteId, product, siteRows, firstName);
    const primary =
      !!landing &&
      (fresh?.landing_page_url ?? "").replace(/\/+$/, "") === landing.replace(/\/+$/, "");
    return NextResponse.json({
      result,
      siteId,
      landingPageUrl: result === "applied" ? landing : previous.landingPageUrl,
      thankYouPageUrl: result === "applied" ? thankYou : previous.thankYouPageUrl,
      primary,
    });
  }

  if (action !== "save" && action !== "publish") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (open) {
    return NextResponse.json(
      {
        error: "A publish is already open for this page. Wait until it merges or is closed.",
        pr_url: publishMetaFromResponses(open.responses).pr_url,
      },
      { status: 409 },
    );
  }

  const parsed = parseLandingDraft(body?.draft);
  const applied = statusRow(siteRows, "applied");
  const appliedSlug = fieldsFromResponses(applied?.responses ?? null)?.slug ?? "";
  if (appliedSlug) parsed.slug = appliedSlug;

  if (action === "save") {
    const row = await saveLandingDraft(ctx.service, clientId, parsed, ctx.userId, { siteId, product });
    return NextResponse.json({
      draft: fieldsFromResponses(row.responses),
      submissionId: row.id,
      siteId,
    });
  }

  const ready = draftForPublish(parsed, !!applied, product);
  const fieldErrors = validateForPublish(ready, {
    slugTaken: false,
    repoYamlExists: false,
    clientOwnsSlug: false,
  }, product);
  if (fieldErrors.length || !SLUG_PATTERN.test(ready.slug)) {
    return NextResponse.json({ error: fieldErrors[0] || "Slug is required", errors: fieldErrors }, { status: 400 });
  }

  try {
    const [slugTaken, repoYamlExists] = await Promise.all([
      slugTakenByOtherSite(ctx.service, ready.slug, product, { clientId, siteId }),
      yamlExistsOnMain(product, ready.slug),
    ]);
    const errors = validateForPublish(ready, {
      slugTaken,
      repoYamlExists,
      clientOwnsSlug: appliedSlug === ready.slug,
    }, product);
    if (errors.length) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    const files: { path: string; bytes: Buffer }[] = [
      { path: yamlPath(ready.slug), bytes: Buffer.from(draftToYaml(ready, product), "utf8") },
    ];
    await attachBrandFile(files, ready.slug, client.headshot_url, "headshot");
    await attachBrandFile(files, ready.slug, client.logo_url, "logo");
    // Reverse/HomeSafe still hop through vercel.json (read before build).
    // DSCR serves apply.html built from YAML, so it must not reintroduce
    // stale vercel.json apply routes.
    if (ready.applyUrl && product !== "DSCR") {
      files.push(...(await applyRedirectFiles(product, ready.slug, ready.applyUrl)));
    }

    const bodyLines = [
      "Published from Mr. Waiz.",
      "",
      `Live URL after merge: ${landingPageUrl(product, ready.slug)}`,
      `Thank-you: ${thankYouPageUrl(product, ready.slug)}`,
    ];
    if (product === "DSCR") {
      bodyLines.push(`Search indexing: ${ready.preview ? "hidden (preview)" : "on"}`);
    }
    if (product !== "DSCR") {
      bodyLines.push("Also updates the apply redirects in vercel.json.");
    }
    bodyLines.push("", "Vercel builds the HTML. Do not hand-edit generated pages.");

    const opened = await openLandingPull({
      product,
      slug: ready.slug,
      files,
      title: `Landing page: ${ready.slug}`,
      body: bodyLines.join("\n"),
    });

    const publish = {
      pr_url: opened.prUrl,
      pr_number: opened.prNumber,
      head_sha: opened.headSha,
      merged: false,
      error: null,
    };
    const row = await insertLandingPublish(ctx.service, clientId, ready, publish, ctx.userId, {
      siteId,
      product,
    });
    return NextResponse.json({
      draft: ready,
      submissionId: row.id,
      siteId,
      locked: true,
      publish,
      pr_url: opened.prUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
