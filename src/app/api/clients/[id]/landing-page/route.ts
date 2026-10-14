import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext, isAuthError, requireAnyPermission } from "@/lib/api-auth";
import { uploadBrandAsset, downloadBrandAsset, type BrandAssetKind } from "@/lib/landing-page/assets";
import { yamlExistsOnMain, openLandingPull } from "@/lib/landing-page/github";
import { headshotRepoFile, logoRepoFile } from "@/lib/landing-page/headshot";
import {
  draftForPublish,
  parseLandingDraft,
  prefillLandingDraft,
  validateForPublish,
} from "@/lib/landing-page/intake";
import {
  landingPageUrl,
  landingProductFor,
  SLUG_PATTERN,
  thankYouPageUrl,
  yamlPath,
  type LandingProduct,
} from "@/lib/landing-page/products";
import { fieldsFromResponses, publishMetaFromResponses } from "@/lib/landing-page/responses";
import {
  getLatestAppliedLanding,
  getLatestLandingDraft,
  getOpenLandingSubmission,
  insertLandingPublish,
  saveLandingDraft,
  settleMergedLanding,
  slugTakenByOtherClient,
} from "@/lib/landing-page/storage";
import { LANDING_CLIENT_FIELDS, type LandingClient, type LandingDraft } from "@/lib/landing-page/types";
import { draftToYaml } from "@/lib/landing-page/yaml";

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

function payload(
  product: LandingProduct,
  draft: LandingDraft,
  extras: {
    locked: boolean;
    hasApplied: boolean;
    publish: ReturnType<typeof publishMetaFromResponses>;
    landingPageUrl: string | null;
    thankYouPageUrl: string | null;
    submissionId: string | null;
  },
) {
  return { product, draft, ...extras };
}

function landingDenied() {
  return NextResponse.json(
    { error: "Landing pages are for DSCR and reverse mortgage clients" },
    { status: 400 },
  );
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const denied = requireAnyPermission(ctx, PERMISSION_KEYS);
  if (denied) return denied;

  const { id: clientId } = await params;
  const client = await loadClient(ctx.service, clientId);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const product = landingProductFor(client.reporting_type);
  if (!product) return landingDenied();

  const [draftRow, appliedRow, submittedRow, firstName] = await Promise.all([
    getLatestLandingDraft(ctx.service, clientId),
    getLatestAppliedLanding(ctx.service, clientId),
    getOpenLandingSubmission(ctx.service, clientId),
    loadOnboardingFirstName(ctx.service, clientId),
  ]);

  const locked = !!submittedRow;
  const source = submittedRow ?? draftRow ?? appliedRow;
  const saved = fieldsFromResponses(source?.responses ?? null);
  const draft = prefillLandingDraft(client, saved, firstName);
  const publish = publishMetaFromResponses((submittedRow ?? appliedRow)?.responses ?? null);

  return NextResponse.json({
    ...payload(product, draft, {
      locked,
      hasApplied: !!appliedRow,
      publish,
      landingPageUrl: client.landing_page_url,
      thankYouPageUrl: client.thank_you_page_url,
      submissionId: source?.id ?? null,
    }),
    headshotUrl: client.headshot_url,
    logoUrl: client.logo_url,
  });
}

async function uploadLandingAsset(
  service: SupabaseClient,
  clientId: string,
  req: Request,
) {
  const open = await getOpenLandingSubmission(service, clientId);
  if (open) {
    return NextResponse.json(
      { error: "A publish is already open. Wait until it merges or is closed." },
      { status: 409 },
    );
  }
  const form = await req.formData();
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
    return NextResponse.json(
      kind === "logo" ? { logoUrl: url } : { headshotUrl: url },
    );
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
  const product = landingProductFor(client.reporting_type);
  if (!product) return landingDenied();

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return uploadLandingAsset(ctx.service, clientId, req);
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    draft?: unknown;
  } | null;
  const action = body?.action;

  if (action === "check") {
    const submitted = await getOpenLandingSubmission(ctx.service, clientId);
    if (!submitted) {
      return NextResponse.json({ error: "No open publish to check" }, { status: 404 });
    }
    const meta = publishMetaFromResponses(submitted.responses);
    if (!meta.merged) {
      return NextResponse.json(
        { error: "The pull request is not merged yet", publish: meta },
        { status: 409 },
      );
    }
    const result = await settleMergedLanding(ctx.service, submitted, 1);
    const fresh = await loadClient(ctx.service, clientId);
    return NextResponse.json({
      result,
      landingPageUrl: fresh?.landing_page_url ?? null,
      thankYouPageUrl: fresh?.thank_you_page_url ?? null,
    });
  }

  if (action !== "save" && action !== "publish") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const open = await getOpenLandingSubmission(ctx.service, clientId);
  if (open) {
    return NextResponse.json(
      { error: "A publish is already open. Wait until it merges or is closed.", pr_url: publishMetaFromResponses(open.responses).pr_url },
      { status: 409 },
    );
  }

  const parsed = parseLandingDraft(body?.draft);

  if (action === "save") {
    const row = await saveLandingDraft(ctx.service, clientId, parsed, ctx.userId, product);
    return NextResponse.json({
      draft: fieldsFromResponses(row.responses),
      submissionId: row.id,
    });
  }

  const applied = await getLatestAppliedLanding(ctx.service, clientId);
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
      slugTakenByOtherClient(ctx.service, ready.slug, clientId, product),
      yamlExistsOnMain(product, ready.slug),
    ]);
    const ownedSlug = fieldsFromResponses(applied?.responses ?? null)?.slug === ready.slug;
    const errors = validateForPublish(ready, {
      slugTaken,
      repoYamlExists,
      clientOwnsSlug: ownedSlug,
    }, product);
    if (errors.length) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }

    const files: { path: string; bytes: Buffer }[] = [
      { path: yamlPath(ready.slug), bytes: Buffer.from(draftToYaml(ready, product), "utf8") },
    ];
    await attachBrandFile(files, ready.slug, client.headshot_url, "headshot");
    await attachBrandFile(files, ready.slug, client.logo_url, "logo");

    const bodyLines = [
      "Published from Mr. Waiz.",
      "",
      `Live URL after merge: ${landingPageUrl(product, ready.slug)}`,
      `Thank-you: ${thankYouPageUrl(product, ready.slug)}`,
    ];
    if (product === "DSCR") {
      bodyLines.push(`Search indexing: ${ready.preview ? "hidden (preview)" : "on"}`);
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
    const row = await insertLandingPublish(ctx.service, clientId, ready, publish, ctx.userId, product);
    return NextResponse.json({
      draft: ready,
      submissionId: row.id,
      locked: true,
      publish,
      pr_url: opened.prUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
