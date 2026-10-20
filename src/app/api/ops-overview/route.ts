import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { canAccessTeamCommandApi } from '@/lib/team-dashboards/access';
import { fetchEnrichedBookingsInRange, summarizeOutcomesByAgent } from '@/lib/agent-appointment-stats';
import { fetchAgentEventsInRange } from '@/lib/agent-event-fetch';
import { buildRosterMatcher } from '@/lib/agent-roster';
import {
  FRESH_LAUNCH_DAYS,
  TIER_LABEL,
  type ConstraintLayer,
  type HealthTier,
} from '@/lib/client-health';
import { getDateRange, ymdLocal } from '@/lib/date-presets';
import { kickoffFiledClientIds } from '@/lib/form-submissions';
import { isKickoffIncomplete } from '@/lib/kickoff';
import { defaultHealthGradingRange, loadClientHealthBundle } from '@/lib/load-client-health';
import { listUpcomingCsAppointments } from '@/lib/cs-appointments';
import { createTtlCache } from '@/lib/ttl-cache';
import {
  CALL_CENTER_TIMEZONE,
  todayYmdInCallCenterTz,
  ymdInTimeZone,
} from '@/lib/time';

const opsOverviewCache = createTtlCache<unknown>(45_000);

const ONBOARDING_STATUSES = new Set(['new_account', 'onboarding']);

/** Route the ticket without inventing craft tasks — lane map owners. */
function constraintOwnerHint(constraint: ConstraintLayer): string {
  switch (constraint) {
    case 'lead_quality':
    case 'lead_cost':
      return 'Christian (Ads)';
    case 'call_center':
      return 'Pedro (Call Center)';
    case 'show_rate':
      return 'Pedro / LO prep';
    case 'data_issue':
      return 'Ops';
    case 'healthy':
    case 'insufficient_data':
    default:
      return '—';
  }
}

function daysBetween(fromYmd: string | null | undefined, toYmd: string): number | null {
  if (!fromYmd) return null;
  const a = Date.parse(`${fromYmd.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${toYmd}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function nextGateLabel(opts: {
  lifecycle_status: string | null;
  kickoff_incomplete: boolean;
}): string {
  if (opts.kickoff_incomplete) return 'Finish kickoff';
  if (opts.lifecycle_status === 'new_account') return 'Advance to onboarding';
  if (opts.lifecycle_status === 'onboarding') return 'Launch checklist';
  return '—';
}

function freshLeadingLabel(opts: {
  worst_tier: HealthTier | null;
  reporting_type: string;
}): string {
  if (!opts.worst_tier || opts.worst_tier === 'insufficient') return 'Too early / low volume';
  const label = TIER_LABEL[opts.worst_tier];
  const focus = opts.reporting_type === 'RM' || opts.reporting_type === 'DSCR' ? 'CPL / booking' : 'Booking';
  return `${label} · ${focus}`;
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data: linked } = await ctx.service
    .from('agents')
    .select('pay_type')
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (
    !canAccessTeamCommandApi({
      isOwner: ctx.isOwner,
      isAdmin: ctx.isAdmin,
      allowedPermissions: ctx.allowedPermissions,
      payType: linked?.pay_type,
    })
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const today = todayYmdInCallCenterTz();
  const todayLocal = ymdLocal(new Date());
  const healthRange = defaultHealthGradingRange();
  const weekRange = getDateRange('last_7');

  const cacheKey = [todayLocal, healthRange.start, healthRange.end, weekRange.start, weekRange.end].join('|');
  const cached = opsOverviewCache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  }

  try {
    const [
      { data: clients, error: clientsError },
      { data: onboardingCalls, error: callsError },
      { data: roster, error: rosterError },
      health,
      agentEvents,
      enrichedBookings,
      csUpcoming,
    ] = await Promise.all([
      ctx.service
        .from('clients')
        .select(
          'id, name, lifecycle_status, launch_date, date_signed, last_status_changed_at, created_at, ghl_location_id, primary_contact_name, reporting_type, is_live',
        )
        .order('name'),
      ctx.service
        .from('client_calls')
        .select('client_id, recording_url, call_type, called_at')
        .eq('call_type', 'onboarding')
        .order('called_at', { ascending: false }),
      ctx.service.from('agents').select('name, phone, pay_type').order('name'),
      loadClientHealthBundle(ctx.service, {
        start_date: healthRange.start,
        end_date: healthRange.end,
        live_only: false,
      }),
      fetchAgentEventsInRange(ctx.service, weekRange.start, weekRange.end),
      fetchEnrichedBookingsInRange(ctx.service, weekRange.start, weekRange.end),
      listUpcomingCsAppointments(ctx.service, { days: 14 }),
    ]);

    if (clientsError) {
      return NextResponse.json({ error: clientsError.message }, { status: 500 });
    }
    if (callsError) {
      return NextResponse.json({ error: callsError.message }, { status: 500 });
    }
    if (rosterError) {
      return NextResponse.json({ error: rosterError.message }, { status: 500 });
    }

    const latestOnboardingCall = new Map<string, { recording_url?: string | null }>();
    for (const call of onboardingCalls ?? []) {
      if (!latestOnboardingCall.has(call.client_id)) {
        latestOnboardingCall.set(call.client_id, { recording_url: call.recording_url });
      }
    }

    const allClients = clients ?? [];
    const activeClients = allClients.filter(c => c.lifecycle_status === 'active');
    const onboardingClients = allClients.filter(c =>
      ONBOARDING_STATUSES.has(c.lifecycle_status ?? ''),
    );
    const offboardingClients = allClients.filter(
      c => c.lifecycle_status === 'off_boarding' || c.lifecycle_status === 'paused',
    );

    const kickoffFiled = await kickoffFiledClientIds(
      ctx.service,
      onboardingClients.map(c => c.id),
    );
    const onboarding = onboardingClients.map(c => {
      const kickoff_incomplete = isKickoffIncomplete(
        {
          lifecycle_status: c.lifecycle_status,
          ghl_location_id: c.ghl_location_id,
          name: c.name,
          primary_contact_name: c.primary_contact_name,
        },
        latestOnboardingCall.get(c.id),
        kickoffFiled.has(c.id),
      );
      const anchor =
        (c.last_status_changed_at as string | null)?.slice(0, 10) ||
        (c.date_signed as string | null)?.slice(0, 10) ||
        (c.created_at as string | null)?.slice(0, 10) ||
        null;
      return {
        client_id: c.id,
        client_name: c.name,
        lifecycle_status: c.lifecycle_status,
        days_in_onboarding: daysBetween(anchor, today),
        kickoff_incomplete,
        next_gate: nextGateLabel({
          lifecycle_status: c.lifecycle_status,
          kickoff_incomplete,
        }),
      };
    });
    onboarding.sort(
      (a, b) =>
        (b.days_in_onboarding ?? 0) - (a.days_in_onboarding ?? 0) ||
        a.client_name.localeCompare(b.client_name),
    );

    const healthById = new Map(health.clients.map(r => [r.client_id, r]));

    const fresh_launched = health.clients
      .filter(r => r.is_fresh_launch)
      .map(r => ({
        client_id: r.client_id,
        client_name: r.client_name,
        launch_date: r.launch_date,
        days_since_launch: r.fresh?.days_since_launch ?? daysBetween(r.launch_date, today) ?? 0,
        reporting_type: r.reporting_type,
        leading_label: freshLeadingLabel({
          worst_tier: r.fresh?.worst_tier ?? null,
          reporting_type: r.reporting_type,
        }),
        worst_tier: r.fresh?.worst_tier ?? null,
      }))
      .sort(
        (a, b) =>
          a.days_since_launch - b.days_since_launch || a.client_name.localeCompare(b.client_name),
      );

    // Also catch active clients with launch_date in window even if health missed them
    // (e.g. no events yet) — merge by id.
    const freshIds = new Set(fresh_launched.map(f => f.client_id));
    for (const c of activeClients) {
      if (freshIds.has(c.id)) continue;
      const launch = (c.launch_date as string | null) ?? null;
      if (!launch) continue;
      const days = daysBetween(launch, today);
      if (days == null || days < 0 || days >= FRESH_LAUNCH_DAYS) continue;
      fresh_launched.push({
        client_id: c.id,
        client_name: c.name,
        launch_date: launch,
        days_since_launch: days,
        reporting_type: c.reporting_type ?? 'RM',
        leading_label: 'Too early / low volume',
        worst_tier: null,
      });
      freshIds.add(c.id);
    }
    fresh_launched.sort(
      (a, b) =>
        a.days_since_launch - b.days_since_launch || a.client_name.localeCompare(b.client_name),
    );

    const underperforming = health.clients
      .filter(
        r =>
          r.focus.focus === 'act_now' &&
          r.has_activity &&
          !r.is_fresh_launch &&
          r.is_live !== false,
      )
      .map(r => {
        const launch = r.launch_date;
        return {
          client_id: r.client_id,
          client_name: r.client_name,
          focus: r.focus.focus,
          focus_label: r.focus.label,
          north_star_tier: r.current.worst_tier,
          north_star_label: TIER_LABEL[r.current.worst_tier],
          constraint: r.current.constraint,
          constraint_label: r.current.constraint_label,
          owner_hint: constraintOwnerHint(r.current.constraint),
          days_live: daysBetween(launch, today),
          reporting_type: r.reporting_type,
        };
      })
      .sort((a, b) => {
        const sa = healthById.get(a.client_id)?.current.attention_score ?? 0;
        const sb = healthById.get(b.client_id)?.current.attention_score ?? 0;
        return sb - sa || a.client_name.localeCompare(b.client_name);
      });

    // ── Call-rep leaderboard (exclude b2b_setter / non floor roles) ──────────
    const callRepNames = new Set(
      (roster ?? [])
        .filter(a => !a.pay_type || a.pay_type === 'call_rep')
        .map(a => a.name),
    );
    const callRepRoster = (roster ?? []).filter(
      a => !a.pay_type || a.pay_type === 'call_rep',
    );
    const resolveAgent = buildRosterMatcher(callRepRoster);
    const outcomeByAgent = summarizeOutcomesByAgent(enrichedBookings, resolveAgent);

    type Acc = {
      agent_name: string;
      dials: number;
      appointments: number;
      today_dials: number;
      today_appointments: number;
    };
    const agentMap = new Map<string, Acc>();
    for (const name of callRepNames) {
      agentMap.set(name, {
        agent_name: name,
        dials: 0,
        appointments: 0,
        today_dials: 0,
        today_appointments: 0,
      });
    }

    for (const row of agentEvents) {
      const name = resolveAgent(row.agent_name);
      if (!name || !callRepNames.has(name)) continue;
      const a = agentMap.get(name)!;
      const isToday =
        !!row.occurred_at &&
        ymdInTimeZone(new Date(row.occurred_at), CALL_CENTER_TIMEZONE) === today;
      if (row.event_type === 'dial') {
        a.dials++;
        if (isToday) a.today_dials++;
      } else if (row.event_type === 'appointment_booked') {
        // Week appointments come from outcome-enriched counts below; today still from events.
        if (isToday) a.today_appointments++;
      }
    }

    const leaderboardRows = Array.from(agentMap.values())
      .map(a => {
        const outcomes = outcomeByAgent.get(a.agent_name);
        return {
          agent_name: a.agent_name,
          today_dials: a.today_dials,
          today_bookings: a.today_appointments,
          week_dials: a.dials,
          week_bookings: outcomes?.appointments ?? 0,
        };
      })
      .filter(
        a =>
          a.today_dials > 0 ||
          a.today_bookings > 0 ||
          a.week_dials > 0 ||
          a.week_bookings > 0,
      )
      .sort(
        (a, b) =>
          b.today_bookings - a.today_bookings ||
          b.today_dials - a.today_dials ||
          b.week_bookings - a.week_bookings ||
          a.agent_name.localeCompare(b.agent_name),
      );

    const topLeaderboard = leaderboardRows.slice(0, 10);
    const team_today = {
      dials: leaderboardRows.reduce((s, a) => s + a.today_dials, 0),
      bookings: leaderboardRows.reduce((s, a) => s + a.today_bookings, 0),
    };
    const team_week = {
      dials: leaderboardRows.reduce((s, a) => s + a.week_dials, 0),
      bookings: leaderboardRows.reduce((s, a) => s + a.week_bookings, 0),
    };

    const cs_upcoming = csUpcoming.map(a => ({
      id: a.id,
      clickup_task_id: a.clickup_task_id,
      client_id: a.client_id,
      client_name: a.client_name,
      call_type: a.call_type,
      scheduled_at: a.scheduled_at,
      calendar_name: a.calendar_name,
    }));
    const cs_unmapped_count = cs_upcoming.filter(a => !a.client_id).length;

    const payload = {
      generated_at: new Date().toISOString(),
      today: todayLocal,
      health_period: health.period,
      week_period: weekRange,
      counts: {
        active: activeClients.length,
        onboarding: onboarding.length,
        fresh_launched: fresh_launched.length,
        act_now: health.summary.act_now,
        monitor: health.summary.monitor,
        on_track: health.summary.on_track,
        recovering: health.summary.recovering,
        offboarding_or_paused: offboardingClients.length,
        cs_upcoming: cs_upcoming.length,
        cs_unmapped: cs_unmapped_count,
      },
      onboarding,
      fresh_launched,
      underperforming,
      cs_upcoming,
      floor: {
        team_today,
        team_week,
        leaderboard: topLeaderboard,
      },
      definitions: {
        onboarding: 'lifecycle_status in new_account, onboarding',
        fresh_launched: `Active + launch_date within last ${FRESH_LAUNCH_DAYS} days`,
        underperforming: 'Health focus = act_now (excludes fresh launches)',
        active: 'lifecycle_status = active',
        leaderboard: 'Call reps only (pay_type = call_rep); dials + credited bookings',
        cs_upcoming:
          'Scheduled CS onboarding / launch / check-in appointments in the next 14 days (GHL CS calendars)',
      },
    };
    opsOverviewCache.set(cacheKey, payload);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=20' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
