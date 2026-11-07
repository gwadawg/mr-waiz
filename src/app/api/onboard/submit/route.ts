import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { applyOnboardingSubmission, uploadClientHeadshot } from '@/lib/apply-onboarding';
import { parseOnboardingFormFields } from '@/lib/onboarding-form';
import { uploadLoosePersonFile } from '@/lib/person-store';

const RATE_LIMIT_MS = 30_000;
const recentSubmits = new Map<string, number>();

function rateLimitKey(req: Request, email: string): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `${forwarded ?? 'local'}:${email.toLowerCase()}`;
}

async function parseMultipart(req: Request): Promise<{
  body: Record<string, unknown>;
  headshotFile: File | null;
  memberFiles: { index: number; kind: 'headshot' | 'other'; file: File }[];
  primaryFiles: File[];
}> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    const cause = e instanceof Error && 'cause' in e ? String((e as Error & { cause?: unknown }).cause) : '';
    const detail = cause || (e instanceof Error ? e.message : String(e));
    if (/FormData|boundary|CRLF/i.test(detail)) {
      throw new Error(
        'Headshot file is too large to upload. Please use a photo under 20MB (or skip the photo and submit).',
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  }

  const body: Record<string, unknown> = {};
  let headshotFile: File | null = null;
  const memberFiles: { index: number; kind: 'headshot' | 'other'; file: File }[] = [];
  const primaryFiles: File[] = [];

  for (const [key, value] of form.entries()) {
    if (value instanceof File && value.size > 0) {
      if (key === 'headshot') {
        headshotFile = value;
        continue;
      }
      const memberHeadshot = /^member_headshot_(\d+)$/.exec(key);
      const memberFile = /^member_file_(\d+)_\d+$/.exec(key);
      if (memberHeadshot) {
        memberFiles.push({ index: Number(memberHeadshot[1]), kind: 'headshot', file: value });
        continue;
      }
      if (memberFile) {
        memberFiles.push({ index: Number(memberFile[1]), kind: 'other', file: value });
        continue;
      }
      if (/^primary_file_\d+$/.test(key)) {
        primaryFiles.push(value);
        continue;
      }
    }
    if (
      key === 'states_licensed' ||
      key === 'company_states_licensed' ||
      key === 'additional_members' ||
      key === 'person_notes'
    ) {
      try {
        body[key] = JSON.parse(String(value));
      } catch {
        if (key === 'additional_members') {
          body[key] = [];
        } else {
          body[key] = String(value).split(',').map(s => s.trim()).filter(Boolean);
        }
      }
      continue;
    }
    body[key] = typeof value === 'string' ? value : String(value);
  }

  return { body, headshotFile, memberFiles, primaryFiles };
}

// POST /api/onboard/submit — public client onboarding form (multipart or JSON).
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    let body: Record<string, unknown> = {};
    let headshotFile: File | null = null;
    let memberFiles: { index: number; kind: 'headshot' | 'other'; file: File }[] = [];
    let primaryFiles: File[] = [];

    if (contentType.includes('multipart/form-data')) {
      ({ body, headshotFile, memberFiles, primaryFiles } = await parseMultipart(req));
    } else {
      body = await req.json();
    }

    const input = parseOnboardingFormFields(body);
    const key = rateLimitKey(req, input.email);
    const last = recentSubmits.get(key);
    if (last && Date.now() - last < RATE_LIMIT_MS) {
      return NextResponse.json({ error: 'Please wait before submitting again' }, { status: 429 });
    }
    recentSubmits.set(key, Date.now());

    const service = createServiceClient();

    if (headshotFile) {
      input.headshot_url = await uploadClientHeadshot(service, headshotFile);
      body.headshot_url = input.headshot_url;
    }

    input.primary_attachments = [];
    for (const file of primaryFiles) {
      input.primary_attachments.push(await uploadLoosePersonFile(service, 'other', file));
    }

    for (const item of memberFiles) {
      const member = input.additional_members[item.index];
      if (!member) continue;
      const stored = await uploadLoosePersonFile(service, item.kind, item.file);
      member.attachments = [...(member.attachments ?? []), stored];
      if (Array.isArray(body.additional_members) && body.additional_members[item.index]) {
        const rawMember = body.additional_members[item.index] as Record<string, unknown>;
        const existing = Array.isArray(rawMember.attachments) ? rawMember.attachments : [];
        rawMember.attachments = [...existing, stored];
      }
    }

    const result = await applyOnboardingSubmission(service, input, body);

    return NextResponse.json({
      success: true,
      matched: result.matched,
      message: result.matched
        ? 'Thank you — we received your information and will be in touch about your onboarding call.'
        : 'Thank you — we received your information. Our team will match it to your account shortly.',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status =
      message.includes('required') || message.includes('too large') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
