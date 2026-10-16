import YAML from "yaml";
import { HS_FIT_AGE, HS_STOCK_HERO, RM_STOCK_HERO, type LandingProduct } from "./products";
import type { LandingDraft } from "./types";

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Factory yaml stores digits with a leading 1, no plus. */
export function phoneE164Digits(phone: string): string {
  const d = phoneDigits(phone);
  if (d.length === 10) return `1${d}`;
  if (d.length === 11 && d.startsWith("1")) return d;
  return d;
}

export function formatPhoneDisplay(phone: string): string {
  const d = phoneDigits(phone);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d.length === 10 ? d : "";
  if (!ten) return phone.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

function smsBlock(draft: LandingDraft, programName: string) {
  return {
    status: draft.smsStatus,
    programName,
    programDescription: "",
    frequency: "Message frequency varies.",
    consentLanguage: "",
  };
}

function contactBlock(draft: LandingDraft) {
  return {
    phone: formatPhoneDisplay(draft.phone),
    phoneE164: phoneE164Digits(draft.phone),
    email: draft.email.trim(),
    address: {
      streetAddress: draft.street.trim(),
      addressLocality: draft.city.trim(),
      addressRegion: draft.region.trim(),
      postalCode: draft.postalCode.trim(),
      addressCountry: "US",
    },
  };
}

function equityYaml(draft: LandingDraft, product: "RM" | "HS"): string {
  const first = draft.firstName.trim() || draft.name.trim().split(/\s+/)[0] || "";
  const hero = product === "HS" ? HS_STOCK_HERO : RM_STOCK_HERO;
  const identity: Record<string, string> = {
    name: draft.name.trim(),
    firstName: draft.brandType === "company" ? "" : first,
    title: draft.title.trim(),
    company: draft.company.trim(),
    tagline: draft.tagline.trim(),
  };
  if (draft.legalName.trim()) identity.legalName = draft.legalName.trim();
  const doc: Record<string, unknown> = {
    slug: draft.slug,
    theme: "theme-1",
    colorway: draft.colorway,
    brandType: draft.brandType,
    draft: false,
    identity,
    contacts: contactBlock(draft),
    compliance: {
      nmlsIndividual: draft.nmlsIndividual.trim(),
      nmlsCompany: draft.nmlsCompany.trim(),
      licenseSecondary: "",
      equalHousing: true,
      fdicMember: false,
      stateNotices: draft.stateNotices,
      sms: smsBlock(draft, draft.name.trim()),
    },
    applyUrl: draft.applyUrl.trim(),
    copy: {
      heroHeadline: draft.heroHeadline.trim() || hero,
    },
    assets: {
      logo: "",
      headshot: "",
      vcf: "",
      ogImage: "",
    },
  };
  if (product === "HS") {
    const fit: Record<string, number> = {
      age: Number(draft.fitAge.trim() || HS_FIT_AGE),
    };
    if (/^\d{3}$/.test(draft.fitCredit.trim())) fit.creditScore = Number(draft.fitCredit.trim());
    doc.fit = fit;
  }
  if (draft.colorway === "custom") {
    const brandColors: Record<string, string> = {
      ink: draft.ink.trim(),
      action: draft.action.trim(),
    };
    if (draft.mark.trim()) brandColors.mark = draft.mark.trim();
    if (draft.cream.trim()) brandColors.cream = draft.cream.trim();
    doc.brandColors = brandColors;
  }
  return YAML.stringify(doc);
}

export function draftToYaml(draft: LandingDraft, product: LandingProduct = "DSCR"): string {
  if (product === "RM" || product === "HS") return equityYaml(draft, product);
  const first = draft.firstName.trim() || draft.name.trim().split(/\s+/)[0] || "";
  const doc: Record<string, unknown> = {
    slug: draft.slug,
    theme: draft.theme,
    draft: false,
    preview: draft.preview,
  };
  if (draft.theme !== "theme-1" && draft.accent.trim()) {
    doc.brand = { accent: draft.accent.trim() };
  }
  doc.identity = {
    name: draft.name.trim(),
    firstName: first,
    title: draft.title.trim(),
    company: draft.company.trim(),
    tagline: draft.tagline.trim(),
    bio: draft.bio.trim(),
  };
  doc.contacts = contactBlock(draft);
  doc.compliance = {
    nmlsIndividual: draft.nmlsIndividual.trim(),
    nmlsCompany: draft.nmlsCompany.trim(),
    licenseSecondary: "",
    equalHousing: true,
    stateNotices: draft.stateNotices,
    sms: smsBlock(draft, `${draft.name.trim()} / ${draft.company.trim()}`),
  };
  doc.products = {
    dscrRefinance: true,
    shortTermRental: false,
    primaryResidence: false,
  };
  doc.applyUrl = draft.applyUrl.trim();
  doc.bookingUrl = draft.bookingUrl.trim();
  doc.assets = {
    logo: "",
    headshot: "",
    vcf: "",
    ogImage: "",
  };
  return YAML.stringify(doc);
}
