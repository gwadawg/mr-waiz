import type { LandingTheme } from "./products";

export type SmsStatus = "ready" | "pending";
export type StateNotice = "texas" | "illinois";
export type BrandType = "individual" | "company";
export type Colorway = "stock" | "custom";

export type LandingDraft = {
  slug: string;
  theme: LandingTheme;
  accent: string;
  preview: boolean;
  name: string;
  firstName: string;
  title: string;
  company: string;
  tagline: string;
  bio: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  nmlsIndividual: string;
  nmlsCompany: string;
  smsStatus: SmsStatus;
  stateNotices: StateNotice[];
  applyUrl: string;
  bookingUrl: string;
  brandType: BrandType;
  colorway: Colorway;
  ink: string;
  action: string;
  mark: string;
  cream: string;
  legalName: string;
  heroHeadline: string;
};

export type LandingPublishMeta = {
  pr_url: string | null;
  pr_number: number | null;
  head_sha: string | null;
  merged: boolean;
  error: string | null;
};

export type LandingClient = {
  id: string;
  name: string | null;
  reporting_type: string | null;
  primary_contact_name: string | null;
  email: string | null;
  phone: string | null;
  nmls: string | null;
  brokerage_name: string | null;
  legal_business_name: string | null;
  biography: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  states_licensed: string[] | null;
  headshot_url: string | null;
  logo_url: string | null;
  landing_page_url: string | null;
  thank_you_page_url: string | null;
};

export const LANDING_CLIENT_FIELDS =
  "id, name, reporting_type, primary_contact_name, email, phone, nmls, brokerage_name, legal_business_name, biography, street_address, city, state, zip_code, states_licensed, headshot_url, logo_url, landing_page_url, thank_you_page_url";
