"use client";

import { useCallback, useMemo, useState } from "react";
import OnboardingChoiceCard from "@/components/onboarding/OnboardingChoiceCard";
import OnboardingThankYou from "@/components/onboarding/OnboardingThankYou";
import PersonPlusEditor, { type PlusDraft } from "@/components/person/PersonPlusEditor";
import {
  BTN_PRIMARY_BG,
  FONT_BODY,
  FONT_DISPLAY,
  PROGRESS_BG,
  WAIZ,
  WaizWordmark,
} from "@/components/onboarding/brand";
import { ADDITIONAL_CONTACT_TYPE_OPTIONS } from "@/lib/client-contacts";
import { draftToSubmitBody } from "@/lib/onboarding-form";
import { prepareOnboardingHeadshot } from "@/lib/onboarding-headshot";
import {
  ACCOUNT_MANAGEMENT_OPTIONS,
  CRM_CHOICE_OPTIONS,
  EMPTY_MEMBER_DRAFT,
  EMPTY_ONBOARDING_DRAFT,
  OB_ROLE_OPTIONS,
  PERFORMANCE_UNIT_OPTIONS,
  emphasizesAddMembers,
  getActiveStepSequence,
  getMemberStepSequence,
  stepQuestion,
  validateStep,
  type MemberDraft,
  type MemberStepId,
  type OnboardingDraft,
  type OnboardingFormVariant,
  type PerformanceUnit,
  type StepId,
} from "@/lib/onboarding-steps";
import { type PlusItemKey } from "@/lib/person-profile";
import { US_STATES } from "@/lib/us-states";
import { US_CLIENT_TIMEZONES } from "@/lib/us-timezones";

const INPUT = "ob-input w-full px-4 py-3 text-sm outline-none";

type Props = {
  variant?: OnboardingFormVariant;
};

export default function OnboardingWizard({ variant = "core" }: Props) {
  const isDscr = variant === "dscr_performance";
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_ONBOARDING_DRAFT);
  const [memberDraft, setMemberDraft] = useState<MemberDraft>(EMPTY_MEMBER_DRAFT);
  const [step, setStep] = useState<StepId>("welcome");
  const [inMemberFlow, setInMemberFlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [thankYou, setThankYou] = useState<{ message: string; matched: boolean } | null>(null);

  const ctx = useMemo(
    () => ({ draft, memberDraft, inMemberFlow, variant }),
    [draft, memberDraft, inMemberFlow, variant],
  );

  const sequence = useMemo(() => getActiveStepSequence(ctx), [ctx]);
  const stepIndex = sequence.indexOf(step);
  const progress = sequence.length > 0 ? ((stepIndex + 1) / sequence.length) * 100 : 0;

  const patchDraft = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
  }, []);

  const patchMember = useCallback((patch: Partial<MemberDraft>) => {
    setMemberDraft(m => ({ ...m, ...patch }));
  }, []);

  const goToStep = useCallback((next: StepId) => {
    setError(null);
    setStep(next);
  }, []);

  const goNext = useCallback(() => {
    const err = validateStep(step, ctx);
    if (err) {
      setError(err);
      return;
    }
    setError(null);

    if (inMemberFlow) {
      const memberSteps = getMemberStepSequence(memberDraft);
      const idx = memberSteps.indexOf(step as MemberStepId);
      if (idx < memberSteps.length - 1) {
        goToStep(memberSteps[idx + 1]);
        return;
      }
      setDraft(d => ({
        ...d,
        additional_members: [...d.additional_members, { ...memberDraft }],
      }));
      setMemberDraft(EMPTY_MEMBER_DRAFT);
      setInMemberFlow(false);
      goToStep("add_members");
      return;
    }

    const mainSteps = sequence as StepId[];
    const idx = mainSteps.indexOf(step);
    if (idx < mainSteps.length - 1) {
      goToStep(mainSteps[idx + 1]);
    }
  }, [ctx, goToStep, inMemberFlow, memberDraft, sequence, step]);

  const goBack = useCallback(() => {
    setError(null);
    if (inMemberFlow) {
      const memberSteps = getMemberStepSequence(memberDraft);
      const idx = memberSteps.indexOf(step as MemberStepId);
      if (idx <= 0) {
        setInMemberFlow(false);
        setMemberDraft(EMPTY_MEMBER_DRAFT);
        goToStep("add_members");
        return;
      }
      goToStep(memberSteps[idx - 1]);
      return;
    }

    const idx = sequence.indexOf(step);
    if (idx > 0) goToStep(sequence[idx - 1]);
  }, [goToStep, inMemberFlow, memberDraft, sequence, step]);

  const selectAndAdvance = useCallback(
    (patch: Partial<OnboardingDraft>, next?: StepId) => {
      const nextDraft = { ...draft, ...patch };
      // Switching unit away from leads clears CRM so sequence stays valid.
      if ("performance_unit" in patch && patch.performance_unit !== "leads") {
        nextDraft.crm_choice = "";
      }
      setDraft(nextDraft);
      setError(null);
      const err = validateStep(step, { draft: nextDraft, memberDraft, inMemberFlow, variant });
      if (err) {
        setError(err);
        return;
      }
      if (next) {
        goToStep(next);
        return;
      }
      const mainSteps = getActiveStepSequence({ draft: nextDraft, memberDraft, inMemberFlow, variant });
      const idx = mainSteps.indexOf(step);
      if (idx < mainSteps.length - 1) goToStep(mainSteps[idx + 1]);
    },
    [draft, goToStep, inMemberFlow, memberDraft, step, variant],
  );

  const selectMemberAndAdvance = useCallback(
    (patch: Partial<MemberDraft>) => {
      const nextMember = { ...memberDraft, ...patch };
      setMemberDraft(nextMember);
      setError(null);
      const memberSteps = getMemberStepSequence(nextMember);
      const idx = memberSteps.indexOf(step as MemberStepId);
      if (idx < memberSteps.length - 1) {
        goToStep(memberSteps[idx + 1]);
      }
    },
    [goToStep, memberDraft, step],
  );

  async function handleSubmit() {
    const mainSteps = getActiveStepSequence({ draft, memberDraft: EMPTY_MEMBER_DRAFT, inMemberFlow: false, variant });
    for (const s of mainSteps) {
      if (s === "add_members") continue;
      const err = validateStep(s, { draft, memberDraft: EMPTY_MEMBER_DRAFT, inMemberFlow: false, variant });
      if (err) {
        setError(err);
        goToStep(s);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const body = draftToSubmitBody(draft, variant);
      const form = new FormData();
      for (const [key, value] of Object.entries(body)) {
        form.set(key, value);
      }
      if (draft.headshot) {
        const headshot = await prepareOnboardingHeadshot(draft.headshot);
        form.set("headshot", headshot);
      }
      for (let i = 0; i < draft.person_files.length; i++) {
        form.set(`primary_file_${i}`, draft.person_files[i]);
      }
      draft.additional_members.forEach((member, index) => {
        if (member.headshot) form.set(`member_headshot_${index}`, member.headshot);
        member.files.forEach((file, fileIndex) => {
          form.set(`member_file_${index}_${fileIndex}`, file);
        });
      });

      const res = await fetch("/api/onboard/submit", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      setSubmitting(false);
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setThankYou({
        message: data.message ?? "Thank you — we received your information.",
        matched: !!data.matched,
      });
    } catch (e) {
      setSubmitting(false);
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    }
  }

  if (thankYou) {
    return (
      <OnboardingThankYou
        message={thankYou.message}
        matched={thankYou.matched}
        firstName={draft.first_name}
        variant={variant}
      />
    );
  }

  const showBack = step !== "welcome";
  const question = stepQuestion(step);
  const emphasizeMembers = emphasizesAddMembers(draft.account_management);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: WAIZ.soft, color: WAIZ.ink }}>
      <BrandStyles />

      <header className="px-6 sm:px-8 py-5 flex items-center justify-between">
        <span style={{ color: WAIZ.navy }}>
          <WaizWordmark height={24} />
        </span>
        {step !== "welcome" && (
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: ".8rem",
              fontWeight: 500,
              color: WAIZ.muted,
              letterSpacing: ".02em",
            }}
          >
            {stepIndex + 1} <span style={{ opacity: 0.5 }}>/ {sequence.length}</span>
          </span>
        )}
      </header>

      {step !== "welcome" && (
        <div className="px-6 sm:px-8 mb-8">
          <div
            className="overflow-hidden"
            style={{ height: 5, borderRadius: 999, background: "rgba(11,18,32,.08)" }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                borderRadius: 999,
                background: PROGRESS_BG,
                boxShadow: "0 0 14px rgba(79,163,255,.55)",
                transition: "width .45s cubic-bezier(.22,.61,.36,1)",
              }}
            />
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 pb-16">
        <div className="w-full max-w-2xl">
          {step === "welcome" && (
            <div className="text-center pt-6 sm:pt-14">
              <span
                className="inline-flex items-center gap-2 mb-7"
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: ".78rem",
                  fontWeight: 500,
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                  color: WAIZ.accent700,
                }}
              >
                <span style={{ width: 18, height: 1, background: "currentColor", opacity: 0.45 }} />
                {isDscr ? "Welcome · DSCR performance" : "Glad you're here"}
              </span>
              <h1
                className="mb-5 mx-auto"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: "clamp(2rem, 1.5rem + 2.6vw, 3.1rem)",
                  fontWeight: 600,
                  lineHeight: 1.08,
                  letterSpacing: "-0.03em",
                  color: WAIZ.ink,
                  maxWidth: isDscr ? "18ch" : "14ch",
                }}
              >
                {isDscr ? (
                  <>
                    You&apos;re in — let&apos;s get your{" "}
                    <span
                      style={{
                        background: `linear-gradient(105deg, ${WAIZ.royal}, ${WAIZ.accent700})`,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                      }}
                    >
                      DSCR
                    </span>{" "}
                    pipeline ready
                  </>
                ) : (
                  <>
                    The 6-Minute{" "}
                    <span
                      style={{
                        background: `linear-gradient(105deg, ${WAIZ.royal}, ${WAIZ.accent700})`,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        color: "transparent",
                      }}
                    >
                      Fast-Track
                    </span>{" "}
                    Onboarding
                  </>
                )}
              </h1>
              <p
                className="mb-10 mx-auto"
                style={{
                  fontFamily: FONT_BODY,
                  color: WAIZ.muted,
                  fontSize: "1.02rem",
                  lineHeight: 1.65,
                  maxWidth: isDscr ? "46ch" : "42ch",
                }}
              >
                {isDscr
                  ? "This short form is how we kick off your DSCR performance offer. We'll use your answers to set up leads or conversations, choose the CRM path, build your landing page, and get ads live — so your onboarding call is ready to go."
                  : "A few quick questions so we can build your ads, landing page, and booking system — before your first appointment lands."}
              </p>
              <ContinueButton
                onClick={() => {
                  const next = sequence.find(s => s !== "welcome");
                  goToStep(next ?? "management");
                }}
                label={isDscr ? "Let's get started" : "Get started"}
              />
            </div>
          )}

          {step !== "welcome" && (
            <>
              {question ? (
                <h2
                  className="text-center mb-8 sm:mb-9 mx-auto px-2"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: "clamp(1.35rem, 1.1rem + 1.1vw, 1.8rem)",
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: WAIZ.ink,
                    lineHeight: 1.2,
                    maxWidth: "24ch",
                  }}
                >
                  {question}
                </h2>
              ) : null}

              <div key={step} className="ob-step">
          {step === "contact_name" && (
            <div className="space-y-3 max-w-md mx-auto">
              <input
                className={INPUT}
                placeholder="First name"
                value={draft.first_name}
                onChange={e => patchDraft({ first_name: e.target.value })}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const el = document.getElementById("ob-last-name") as HTMLInputElement | null;
                    el?.focus();
                  }
                }}
                autoFocus
                autoComplete="given-name"
                name="first_name"
                id="ob-first-name"
              />
              <input
                className={INPUT}
                id="ob-last-name"
                placeholder="Last name"
                value={draft.last_name}
                onChange={e => patchDraft({ last_name: e.target.value })}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    goNext();
                  }
                }}
                autoComplete="family-name"
                name="last_name"
              />
              <ContinueButton onClick={goNext} />
            </div>
          )}

          {step === "performance_unit" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
              {PERFORMANCE_UNIT_OPTIONS.map(opt => (
                <OnboardingChoiceCard
                  key={opt.value}
                  label={opt.label}
                  description={opt.description}
                  icon={opt.value === "leads" ? <LeadsIcon /> : <ConvIcon />}
                  selected={draft.performance_unit === opt.value}
                  onClick={() => selectAndAdvance({ performance_unit: opt.value as PerformanceUnit })}
                />
              ))}
            </div>
          )}

          {step === "crm_choice" && (
            <div className="space-y-5 max-w-xl mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {CRM_CHOICE_OPTIONS.map(opt => (
                  <OnboardingChoiceCard
                    key={opt.value}
                    label={opt.label}
                    description={opt.description}
                    icon={opt.value === "waiz" ? <CrmOursIcon /> : <CrmTheirsIcon />}
                    selected={draft.crm_choice === opt.value}
                    onClick={() => selectAndAdvance({ crm_choice: opt.value })}
                  />
                ))}
              </div>
              <p
                className="text-center px-3 mx-auto"
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: ".78rem",
                  color: WAIZ.muted,
                  lineHeight: 1.55,
                  maxWidth: "42ch",
                }}
              >
                <span style={{ color: WAIZ.ink, fontWeight: 500 }}>Using ours?</span>{" "}
                {CRM_CHOICE_OPTIONS.find(o => o.value === "waiz")?.finePrint}
              </p>
            </div>
          )}

          {step === "management" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ACCOUNT_MANAGEMENT_OPTIONS.map(opt => (
                <OnboardingChoiceCard
                  key={opt.value}
                  label={opt.label}
                  icon={managementIcon(opt.icon)}
                  selected={draft.account_management === opt.value}
                  onClick={() => selectAndAdvance({ account_management: opt.value })}
                />
              ))}
            </div>
          )}

          {step === "role" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
              {OB_ROLE_OPTIONS.map(opt => (
                <OnboardingChoiceCard
                  key={opt.value}
                  label={opt.label}
                  icon={roleIcon(opt.icon)}
                  selected={draft.ob_role === opt.value}
                  onClick={() => selectAndAdvance({ ob_role: opt.value })}
                />
              ))}
            </div>
          )}

          {step === "mlo_company_name" && (
            <FieldStep
              value={draft.brokerage_name}
              onChange={v => patchDraft({ brokerage_name: v })}
              placeholder="Company name"
              onContinue={goNext}
            />
          )}

          {step === "owner_company_name" && (
            <FieldStep
              value={draft.company_name}
              onChange={v => patchDraft({ company_name: v })}
              placeholder="Company name"
              onContinue={goNext}
            />
          )}

          {step === "owner_website" && (
            <FieldStep
              value={draft.website}
              onChange={v => patchDraft({ website: v })}
              placeholder="https://yourcompany.com"
              type="url"
              onContinue={goNext}
            />
          )}

          {step === "owner_company_nmls" && (
            <FieldStep
              value={draft.company_nmls}
              onChange={v => patchDraft({ company_nmls: v })}
              placeholder="Company NMLS #"
              onContinue={goNext}
            />
          )}

          {step === "owner_company_address" && (
            <div className="space-y-3 max-w-md mx-auto">
              <input
                className={INPUT}
                placeholder="Street address"
                value={draft.company_address.street}
                onChange={e =>
                  patchDraft({
                    company_address: { ...draft.company_address, street: e.target.value },
                  })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={INPUT}
                  placeholder="City"
                  value={draft.company_address.city}
                  onChange={e =>
                    patchDraft({
                      company_address: { ...draft.company_address, city: e.target.value },
                    })
                  }
                />
                <select
                  className={INPUT}
                  value={draft.company_address.state}
                  onChange={e =>
                    patchDraft({
                      company_address: { ...draft.company_address, state: e.target.value },
                    })
                  }
                >
                  <option value="">State</option>
                  {US_STATES.map(s => (
                    <option key={s.code} value={s.code}>{s.code}</option>
                  ))}
                </select>
              </div>
              <input
                className={INPUT}
                placeholder="ZIP code"
                value={draft.company_address.zip}
                onChange={e =>
                  patchDraft({
                    company_address: { ...draft.company_address, zip: e.target.value },
                  })
                }
              />
              <ContinueButton onClick={goNext} />
            </div>
          )}

          {step === "owner_company_states" && (
            <StatesGrid
              value={draft.company_states_licensed}
              onChange={codes => patchDraft({ company_states_licensed: codes })}
              onContinue={goNext}
            />
          )}

          {step === "person_nmls" && (
            <FieldStep
              value={draft.nmls}
              onChange={v => patchDraft({ nmls: v })}
              placeholder="Your NMLS #"
              onContinue={goNext}
            />
          )}

          {step === "person_phone" && (
            <FieldStep
              value={draft.phone}
              onChange={v => patchDraft({ phone: v })}
              placeholder="(555) 123-4567"
              type="tel"
              onContinue={goNext}
            />
          )}

          {step === "person_email" && (
            <FieldStep
              value={draft.email}
              onChange={v => patchDraft({ email: v })}
              placeholder="you@company.com"
              type="email"
              onContinue={goNext}
            />
          )}

          {step === "person_states" && (
            <StatesGrid
              value={draft.states_licensed}
              onChange={codes => patchDraft({ states_licensed: codes })}
              onContinue={goNext}
            />
          )}

          {step === "person_location" && (
            <div className="space-y-3 max-w-md mx-auto">
              <input
                className={INPUT}
                placeholder="Street address (optional)"
                value={draft.street_address}
                onChange={e => patchDraft({ street_address: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  className={INPUT}
                  placeholder="City"
                  value={draft.city}
                  onChange={e => patchDraft({ city: e.target.value })}
                />
                <select
                  className={INPUT}
                  value={draft.state}
                  onChange={e => patchDraft({ state: e.target.value })}
                >
                  <option value="">State</option>
                  {US_STATES.map(s => (
                    <option key={s.code} value={s.code}>{s.code}</option>
                  ))}
                </select>
              </div>
              <input
                className={INPUT}
                placeholder="ZIP code (optional)"
                value={draft.zip_code}
                onChange={e => patchDraft({ zip_code: e.target.value })}
              />
              <ContinueButton onClick={goNext} />
            </div>
          )}

          {step === "person_timezone" && (
            <div className="max-w-md mx-auto space-y-4">
              <select
                className={INPUT}
                value={draft.timezone}
                onChange={e => patchDraft({ timezone: e.target.value })}
              >
                <option value="">Select your timezone</option>
                {US_CLIENT_TIMEZONES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <ContinueButton onClick={goNext} />
            </div>
          )}

          {step === "review_url" && (
            <div className="max-w-md mx-auto space-y-3">
              <FieldStep
                value={draft.review_url}
                onChange={v => patchDraft({ review_url: v })}
                placeholder="https://… (optional — skip if none)"
                type="url"
                onContinue={goNext}
                hideButton
              />
              <ContinueButton onClick={goNext} label="Continue" />
              <SkipLink
                label="Skip — I don't have reviews yet"
                onClick={() => {
                  patchDraft({ review_url: "" });
                  goNext();
                }}
              />
            </div>
          )}

          {step === "bio" && (
            <div className="max-w-md mx-auto space-y-4">
              <textarea
                className={`${INPUT} min-h-[150px] resize-y`}
                placeholder="Short biography (doesn't need to be perfect — we'll refine it for your page)"
                value={draft.biography}
                onChange={e => patchDraft({ biography: e.target.value })}
              />
              <ContinueButton onClick={goNext} />
            </div>
          )}

          {step === "headshot" && (
            <div className="max-w-md mx-auto space-y-4">
              <label
                className="ob-drop flex flex-col items-center justify-center gap-3 p-8 cursor-pointer text-center"
                style={{
                  borderRadius: 18,
                  border: `1.5px dashed ${WAIZ.line}`,
                  background: "#fff",
                }}
              >
                <span style={{ color: WAIZ.accent700 }}>
                  <UploadIcon />
                </span>
                <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 500, color: WAIZ.ink, fontSize: ".95rem" }}>
                  {draft.headshot ? draft.headshot.name : "Headshot / professional photo"}
                </span>
                <span style={{ fontFamily: FONT_BODY, color: WAIZ.muted, fontSize: ".8rem" }}>
                  JPG, PNG, WEBP, or GIF — large photos are compressed automatically
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={async e => {
                    const file = e.target.files?.[0] ?? null;
                    if (!file) {
                      patchDraft({ headshot: null });
                      return;
                    }
                    try {
                      setError(null);
                      const prepared = await prepareOnboardingHeadshot(file);
                      patchDraft({ headshot: prepared });
                    } catch (err) {
                      patchDraft({ headshot: null });
                      setError(err instanceof Error ? err.message : "Could not use that photo.");
                    }
                  }}
                />
              </label>
              <ContinueButton onClick={goNext} label={draft.headshot ? "Continue" : "Skip for now"} />
            </div>
          )}

          {step === "person_plus" && !inMemberFlow && (
            <div className="max-w-md mx-auto space-y-4">
              <p style={{ fontFamily: FONT_BODY, color: WAIZ.muted, fontSize: ".92rem" }}>
                {draft.ob_role === "owner" ? "Owner" : draft.ob_role === "mlo" ? "Loan officer" : "You"} — add a headshot, bio, note, file, or anything else. Nothing else is on this page until you press plus.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={draft.first_name}
                  onChange={e => patchDraft({ first_name: e.target.value })}
                  placeholder="First name"
                  className={INPUT}
                />
                <input
                  value={draft.last_name}
                  onChange={e => patchDraft({ last_name: e.target.value })}
                  placeholder="Last name"
                  className={INPUT}
                />
              </div>
              <PersonPlusEditor
                tone="light"
                role="primary_lo"
                draft={primaryPlusDraft(draft)}
                disabled={submitting}
                onAttach={(key, value) => {
                  setDraft(current => ({ ...current, ...applyPrimaryPlus(current, key, value) }));
                }}
              />
              <ContinueButton onClick={goNext} label="Continue" />
            </div>
          )}

          {step === "add_members" && !inMemberFlow && (
            <div className="max-w-md mx-auto space-y-4">
              {draft.additional_members.length > 0 && (
                <ul
                  className="p-4 space-y-2.5 mb-2"
                  style={{ borderRadius: 16, background: "#fff", border: `1px solid ${WAIZ.line}` }}
                >
                  {draft.additional_members.map((m, i) => (
                    <li
                      key={i}
                      className="flex justify-between gap-2 items-center"
                      style={{ fontFamily: FONT_BODY }}
                    >
                      <span style={{ fontWeight: 500, color: WAIZ.ink, fontSize: ".92rem" }}>{m.name}</span>
                      <span
                        style={{
                          fontSize: ".72rem",
                          fontWeight: 500,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: WAIZ.accent700,
                        }}
                      >
                        {ADDITIONAL_CONTACT_TYPE_OPTIONS.find(o => o.value === m.contact_type)?.label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <OnboardingChoiceCard
                label={emphasizeMembers ? "Yes — add a team member" : "Add someone else (optional)"}
                icon={<PlusIcon />}
                onClick={() => {
                  setInMemberFlow(true);
                  setMemberDraft(EMPTY_MEMBER_DRAFT);
                  goToStep("member_type");
                }}
              />
              <ContinueButton
                onClick={handleSubmit}
                label={submitting ? "Submitting…" : "I'm done — submit"}
                disabled={submitting}
              />
            </div>
          )}

          {inMemberFlow && step === "member_type" && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto">
              {ADDITIONAL_CONTACT_TYPE_OPTIONS.map(opt => (
                <OnboardingChoiceCard
                  key={opt.value}
                  label={opt.label}
                  icon={<PersonIcon />}
                  selected={memberDraft.contact_type === opt.value}
                  onClick={() => {
                    patchMember({ contact_type: opt.value });
                    selectMemberAndAdvance({ contact_type: opt.value });
                  }}
                />
              ))}
            </div>
          )}

          {inMemberFlow && step === "member_name" && (
            <FieldStep
              value={memberDraft.name}
              onChange={v => patchMember({ name: v })}
              placeholder="Full name"
              onContinue={goNext}
            />
          )}

          {inMemberFlow && step === "member_plus" && (
            <div className="max-w-md mx-auto space-y-4">
              <p style={{ fontFamily: FONT_BODY, color: WAIZ.muted, fontSize: ".92rem" }}>
                {memberDraft.name || "This person"} starts with a name and role. Plus adds a headshot, bio, note, file, or anything else — only for them.
              </p>
              <PersonPlusEditor
                tone="light"
                role={memberDraft.contact_type}
                draft={memberPlusDraft(memberDraft)}
                onAttach={(key, value) => {
                  setMemberDraft(current => ({ ...current, ...applyMemberPlus(current, key, value) }));
                }}
              />
              <ContinueButton onClick={goNext} label="Add this person" />
            </div>
          )}

          {inMemberFlow && step === "member_email" && (
            <FieldStep
              value={memberDraft.email}
              onChange={v => patchMember({ email: v })}
              placeholder="Email"
              type="email"
              onContinue={goNext}
            />
          )}

          {inMemberFlow && step === "member_phone" && (
            <FieldStep
              value={memberDraft.phone}
              onChange={v => patchMember({ phone: v })}
              placeholder="Phone"
              type="tel"
              onContinue={goNext}
            />
          )}

          {inMemberFlow && step === "member_nmls" && (
            <div className="max-w-md mx-auto space-y-3">
              <FieldStep
                value={memberDraft.nmls}
                onChange={v => patchMember({ nmls: v })}
                placeholder="NMLS # (optional)"
                onContinue={goNext}
                hideButton
              />
              <ContinueButton onClick={goNext} label="Continue" />
              <SkipLink
                label="Skip"
                onClick={() => {
                  patchMember({ nmls: "" });
                  goNext();
                }}
              />
            </div>
          )}

          {inMemberFlow && step === "member_states" && (
            <StatesGrid
              value={memberDraft.states_licensed}
              onChange={codes => patchMember({ states_licensed: codes })}
              onContinue={goNext}
            />
          )}
              </div>

              {error && (
                <p
                  className="mt-6 mx-auto max-w-md text-center"
                  role="alert"
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: ".88rem",
                    color: "#b42318",
                    background: "#fef3f2",
                    border: "1px solid #fecdca",
                    borderRadius: 12,
                    padding: ".75rem 1rem",
                  }}
                >
                  {error}
                </p>
              )}

              {showBack && (
                <button
                  type="button"
                  onClick={goBack}
                  className="mt-8 mx-auto block"
                  style={{
                    fontFamily: FONT_BODY,
                    fontSize: ".88rem",
                    fontWeight: 500,
                    color: WAIZ.muted,
                  }}
                >
                  ← Back
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function FieldStep({
  value,
  onChange,
  placeholder,
  type = "text",
  onContinue,
  hideButton,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  onContinue: () => void;
  hideButton?: boolean;
}) {
  return (
    <div className="max-w-md mx-auto space-y-4">
      <input
        className={INPUT}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            onContinue();
          }
        }}
        autoFocus
      />
      {!hideButton && <ContinueButton onClick={onContinue} />}
    </div>
  );
}

function StatesGrid({
  value,
  onChange,
  onContinue,
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  onContinue: () => void;
}) {
  const selected = new Set(value);

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next].sort());
  }

  return (
    <div className="max-w-md mx-auto">
      <div
        className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-64 overflow-y-auto p-3 mb-4"
        style={{ borderRadius: 16, background: "#fff", border: `1px solid ${WAIZ.line}` }}
      >
        {US_STATES.map(({ code }) => {
          const on = selected.has(code);
          return (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: ".78rem",
                fontWeight: 600,
                padding: ".5rem 0",
                borderRadius: 10,
                background: on ? BTN_PRIMARY_BG : WAIZ.soft,
                color: on ? "#fff" : WAIZ.muted,
                border: `1px solid ${on ? "transparent" : WAIZ.line}`,
                boxShadow: on ? "0 8px 18px -10px rgba(46,123,224,.7)" : "none",
                transition: "background .15s, color .15s",
              }}
            >
              {code}
            </button>
          );
        })}
      </div>
      <p
        className="text-center mb-4"
        style={{ fontFamily: FONT_BODY, fontSize: ".82rem", color: WAIZ.muted }}
      >
        {value.length ? `${value.length} selected` : "Select at least one state"}
      </p>
      <ContinueButton onClick={onContinue} />
    </div>
  );
}

function ContinueButton({
  onClick,
  label = "Continue",
  disabled,
}: {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ob-btn w-full max-w-md mx-auto block"
      style={{
        fontFamily: FONT_BODY,
        fontSize: ".98rem",
        fontWeight: 500,
        letterSpacing: "-0.01em",
        color: "#fff",
        padding: ".95rem 1.35rem",
        borderRadius: 999,
        background: disabled ? "#9bb4d6" : BTN_PRIMARY_BG,
        boxShadow: disabled ? "none" : "0 12px 28px -10px rgba(46,123,224,.65)",
        transition: "transform .2s, box-shadow .2s",
      }}
    >
      {label}
    </button>
  );
}

function SkipLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2"
      style={{ fontFamily: FONT_BODY, fontSize: ".85rem", fontWeight: 500, color: WAIZ.muted }}
    >
      {label}
    </button>
  );
}

function BrandStyles() {
  return (
    <style>{`
      .ob-input {
        font-family: ${FONT_BODY};
        color: ${WAIZ.ink};
        background: #fff;
        border: 1.5px solid ${WAIZ.line};
        border-radius: 12px;
        transition: border-color .18s, box-shadow .18s;
      }
      .ob-input::placeholder { color: #9aa4b5; }
      .ob-input:focus {
        border-color: ${WAIZ.accent};
        box-shadow: 0 0 0 4px rgba(79,163,255,.16);
      }
      .ob-btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 18px 36px -12px rgba(46,123,224,.75);
      }
      .ob-card:hover { transform: translateY(-2px); box-shadow: 0 18px 40px -22px rgba(6,26,74,.4); }
      .ob-drop:hover { border-color: ${WAIZ.accent} !important; background: ${WAIZ.tint} !important; }
      .ob-step {
        animation: obStepIn .28s cubic-bezier(.22,.61,.36,1);
      }
      @keyframes obStepIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ob-input, .ob-btn, .ob-card, .ob-step { transition: none; animation: none; }
        .ob-btn:hover:not(:disabled), .ob-card:hover { transform: none; }
      }
    `}</style>
  );
}

const ICON = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function managementIcon(kind: string) {
  if (kind === "solo") {
    return (
      <svg {...ICON}>
        <circle cx="12" cy="8" r="4" />
        <path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      </svg>
    );
  }
  if (kind === "team") {
    return (
      <svg {...ICON}>
        <circle cx="9" cy="8" r="3.2" />
        <circle cx="17" cy="9.5" r="2.6" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 14c2.8 0 5 2.2 5 5" />
      </svg>
    );
  }
  if (kind === "assistant") {
    return (
      <svg {...ICON}>
        <circle cx="10" cy="8" r="3.4" />
        <path d="M4 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M18 7.5v5M15.5 10h5" />
      </svg>
    );
  }
  return (
    <svg {...ICON}>
      <circle cx="8.5" cy="8.5" r="3" />
      <circle cx="15.5" cy="8.5" r="3" />
      <path d="M3.5 19c0-2.8 2.2-5 5-5M20.5 19c0-2.8-2.2-5-5-5" />
    </svg>
  );
}

function roleIcon(kind: string) {
  if (kind === "mlo") {
    return (
      <svg {...ICON}>
        <path d="M4 21V7l8-4 8 4v14" />
        <path d="M9 21v-5h6v5" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </svg>
    );
  }
  return (
    <svg {...ICON}>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5.5 21c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
      <path d="M9.5 3.5 12 1.8l2.5 1.7" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...ICON} width={22} height={22}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...ICON} width={24} height={24}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg {...ICON} width={28} height={28}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function LeadsIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 19h16" />
      <path d="M7 16V9" />
      <path d="M12 16V5" />
      <path d="M17 16v-4" />
    </svg>
  );
}

function ConvIcon() {
  return (
    <svg {...ICON}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  );
}

function CrmOursIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 14h3" />
    </svg>
  );
}

function primaryPlusDraft(draft: OnboardingDraft): PlusDraft {
  return {
    email: draft.email,
    phone: draft.phone,
    nmls: draft.nmls,
    states_licensed: draft.states_licensed,
    profile: {
      ...(draft.biography ? { biography: draft.biography } : {}),
      ...(draft.review_url ? { review_url: draft.review_url } : {}),
      ...(draft.timezone ? { timezone: draft.timezone } : {}),
      ...(draft.street_address ? { personal_address: draft.street_address } : {}),
    },
    notes: draft.person_notes.map(body => ({ body })),
    files: [
      ...(draft.headshot ? [{ kind: "headshot" as const, file_name: draft.headshot.name }] : []),
      ...draft.person_files.map(file => ({ kind: "other" as const, file_name: file.name })),
    ],
  };
}

function applyPrimaryPlus(
  draft: OnboardingDraft,
  key: PlusItemKey,
  value: string | string[] | File,
): Partial<OnboardingDraft> {
  if (value instanceof File) {
    if (key === "headshot") return { headshot: value };
    if (key === "file") return { person_files: [...draft.person_files, value] };
    return {};
  }
  if (key === "states_licensed" && Array.isArray(value)) return { states_licensed: value };
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (key === "email") return { email: text };
  if (key === "phone") return { phone: text };
  if (key === "nmls") return { nmls: text };
  if (key === "biography") return { biography: text };
  if (key === "review_url") return { review_url: text };
  if (key === "timezone") return { timezone: text };
  if (key === "personal_address") return { street_address: text };
  if (key === "note") return { person_notes: [...draft.person_notes, text] };
  return {};
}

function memberPlusDraft(member: MemberDraft): PlusDraft {
  return {
    email: member.email,
    phone: member.phone,
    nmls: member.nmls,
    states_licensed: member.states_licensed,
    profile: {
      ...(member.biography ? { biography: member.biography } : {}),
      ...(member.review_url ? { review_url: member.review_url } : {}),
      ...(member.timezone ? { timezone: member.timezone } : {}),
      ...(member.personal_address ? { personal_address: member.personal_address } : {}),
    },
    notes: member.notes.map(body => ({ body })),
    files: [
      ...(member.headshot ? [{ kind: "headshot" as const, file_name: member.headshot.name }] : []),
      ...member.files.map(file => ({ kind: "other" as const, file_name: file.name })),
    ],
  };
}

function applyMemberPlus(
  member: MemberDraft,
  key: PlusItemKey,
  value: string | string[] | File,
): Partial<MemberDraft> {
  if (value instanceof File) {
    if (key === "headshot") return { headshot: value };
    if (key === "file") return { files: [...member.files, value] };
    return {};
  }
  if (key === "states_licensed" && Array.isArray(value)) return { states_licensed: value };
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (key === "email") return { email: text };
  if (key === "phone") return { phone: text };
  if (key === "nmls") return { nmls: text };
  if (key === "biography") return { biography: text };
  if (key === "review_url") return { review_url: text };
  if (key === "timezone") return { timezone: text };
  if (key === "personal_address") return { personal_address: text };
  if (key === "note") return { notes: [...member.notes, text] };
  return {};
}

function CrmTheirsIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 7h10v10H4z" />
      <path d="M14 10h6v7h-6" />
      <path d="M7 11h4" />
    </svg>
  );
}

