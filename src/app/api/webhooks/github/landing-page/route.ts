import { NextResponse } from "next/server";
import { verifyGithubSignature } from "@/lib/landing-page/signature";
import {
  dismissLandingSubmission,
  getSubmittedByPrNumber,
  settleMergedLanding,
} from "@/lib/landing-page/storage";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const secret = process.env.LANDING_GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret is not set" }, { status: 500 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGithubSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true });

  let body: {
    action?: string;
    repository?: { full_name?: string };
    pull_request?: { number?: number; merged?: boolean };
  };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event !== "pull_request" || body.action !== "closed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const prNumber = body.pull_request?.number;
  const repo = body.repository?.full_name?.trim();
  if (typeof prNumber !== "number" || !repo) {
    return NextResponse.json({ error: "Missing pull request number or repository" }, { status: 400 });
  }

  const service = createServiceClient();
  const row = await getSubmittedByPrNumber(service, prNumber, repo);
  if (!row) return NextResponse.json({ ok: true, matched: false });

  if (body.pull_request?.merged) {
    const result = await settleMergedLanding(service, row, 3);
    return NextResponse.json({ ok: true, result });
  }

  await dismissLandingSubmission(service, row);
  return NextResponse.json({ ok: true, result: "dismissed" });
}
