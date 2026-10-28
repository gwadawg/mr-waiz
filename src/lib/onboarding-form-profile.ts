import { normalizeReportingType, type ReportingType } from '@/lib/reporting-types';
import {
  normalizeServiceProgram,
  resolveKickoffServiceProgram,
  serviceProgramApplies,
  type ServiceProgram,
} from '@/lib/service-program';

export type OnboardingFormProfile = 'marketing_core' | 'marketing_lead_gen' | 'call_center';

export type OnboardingFormProfileMeta = {
  label: string;
  shortLabel: string;
  description: string;
};

export const ONBOARDING_PROFILE_META: Record<OnboardingFormProfile, OnboardingFormProfileMeta> = {
  marketing_core: {
    label: 'Call Center',
    shortLabel: 'CC',
    description: 'Ads, creative, dial, book, and qualify (Waiz call center)',
  },
  marketing_lead_gen: {
    label: 'Leads Only',
    shortLabel: 'Leads',
    description: 'We generate leads; client handles dial and booking',
  },
  call_center: {
    label: 'Call Center Lead (product)',
    shortLabel: 'CC Lead',
    description: "Dialing the LO's existing leads — no ad-gen motion",
  },
};

export function getOnboardingFormProfile(
  vertical: unknown,
  serviceProgram: unknown,
): OnboardingFormProfile {
  if (normalizeReportingType(vertical) === 'CALL_CENTER') return 'call_center';
  if (normalizeServiceProgram(serviceProgram) === 'lead_gen') return 'marketing_lead_gen';
  return 'marketing_core';
}

export type VerticalConfirmationInput = {
  reporting_type?: string | null;
  offer?: string | null;
  service_program?: string | null;
  vertical_confirmed?: boolean;
};

/** True when kickoff can skip the vertical picker gate. */
export function isClientVerticalConfirmed(input: VerticalConfirmationInput): boolean {
  if (input.vertical_confirmed === true) return true;

  const vertical = normalizeReportingType(input.reporting_type);
  if (vertical === 'DSCR' || vertical === 'CALL_CENTER') return true;

  if (normalizeServiceProgram(input.service_program)) return true;

  const offer = String(input.offer ?? '').trim();
  if (offer) {
    const offerNorm = normalizeReportingType(offer);
    if (offerNorm === vertical) return true;
  }

  return false;
}

export function validateKickoffClassification(
  vertical: unknown,
  serviceProgram: unknown,
  saveMode: 'progress' | 'complete',
): string | null {
  const v = normalizeReportingType(vertical);
  if (!v) return 'Client vertical is required';

  if (saveMode === 'complete') {
    if (v === 'CALL_CENTER') {
      return 'Select RM or DSCR before completing kick-off';
    }
    if (!resolveKickoffServiceProgram(serviceProgram)) {
      return 'Select System Type (Leads or Call Center) before completing kick-off';
    }
  }

  return null;
}

export function resolveServiceProgramForSave(
  vertical: ReportingType,
  serviceProgram: unknown,
): ServiceProgram | null {
  if (!serviceProgramApplies(vertical)) return null;
  return normalizeServiceProgram(serviceProgram);
}
