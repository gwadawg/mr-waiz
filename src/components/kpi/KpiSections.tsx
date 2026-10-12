"use client";

import { useCallback, useMemo, useState } from "react";
import type { MetricsResult } from "@/lib/metrics";
import {
  formatKpiValue,
  getHeadlineCards,
  getKpiSections,
  type KpiCardDefinition,
  type ReportingType,
} from "@/lib/kpi-layouts";
import { hintForDialPool, type DialPool } from "@/lib/dial-pool";
import KpiCard, { type KpiDelta } from "./KpiCard";
import KpiHeadlineStrip, { type HeadlineMetric } from "./KpiHeadlineStrip";
import KpiSection from "./KpiSection";

const COLLAPSED_STORAGE_KEY = "mw.kpi.collapsedSections";

/** Section open/closed survives reloads, so your preferred depth is remembered. */
function readCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(parsed) ? parsed.filter(x => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export type SparkMap = Partial<Record<keyof MetricsResult, (number | null)[]>>;

type Props = {
  metrics: MetricsResult;
  reportingType: ReportingType;
  previous?: MetricsResult | null;
  spark?: SparkMap | null;
  /** Single-client dial pool. All-leads rewrites the two rate hints. */
  dialPool?: DialPool | null;
};

function computeDelta(
  card: KpiCardDefinition,
  current: number | null,
  previous: number | null,
): KpiDelta | undefined {
  const cur = current ?? 0;
  const prev = previous ?? 0;
  // Skip noisy/meaningless comparisons (e.g. both zero).
  if (cur === prev) return { text: "0%", good: null };

  let text: string;
  if (card.format === "pct") {
    const diff = cur - prev;
    text = `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pts`;
  } else if (prev === 0) {
    text = "new";
  } else {
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    text = `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }

  const increased = cur > prev;
  const good = card.lowerIsBetter ? !increased : increased;
  return { text, good };
}

function formatCardValue(card: KpiCardDefinition, metrics: MetricsResult): string {
  const primary = formatKpiValue(metrics[card.metric], card.format);
  if (!card.secondaryMetric) return primary;
  const secondary = formatKpiValue(metrics[card.secondaryMetric], card.format);
  return `${primary} / ${secondary}`;
}

function formatRefLine(card: KpiCardDefinition, metrics: MetricsResult): string | undefined {
  if (!card.refMetric) return undefined;
  return `${card.refMetric.label} ${formatKpiValue(metrics[card.refMetric.metric], card.refMetric.format)}`;
}

export default function KpiSections({ metrics, reportingType, previous, spark, dialPool = null }: Props) {
  const sections = getKpiSections(reportingType);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);

  const toggleSection = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Non-persistent storage just means the sections reopen next session.
      }
      return next;
    });
  }, []);

  const describeCard = useCallback(
    (card: KpiCardDefinition): HeadlineMetric => ({
      label: card.label,
      value: formatCardValue(card, metrics),
      caption: card.valueCaption,
      accent: card.accent,
      hint: hintForDialPool(card.metric, card.hint, dialPool),
      refLine: formatRefLine(card, metrics),
      delta: previous
        ? computeDelta(card, metrics[card.metric], previous[card.metric])
        : undefined,
      spark:
        spark?.[card.metric] ??
        (card.secondaryMetric ? spark?.[card.secondaryMetric] : undefined),
    }),
    [metrics, previous, spark, dialPool],
  );

  const headlineMetrics = useMemo(
    () =>
      getHeadlineCards(reportingType)
        .filter(card => !card.visible || card.visible(metrics))
        .map(describeCard),
    [reportingType, metrics, describeCard],
  );

  return (
    <div className="space-y-6">
      <KpiHeadlineStrip metrics={headlineMetrics} />

      {sections.map(section => {
        // Headline cards are lifted into the strip above, not repeated here.
        const visibleCards = section.cards.filter(
          card => !card.headline && (!card.visible || card.visible(metrics)),
        );
        if (visibleCards.length === 0) return null;

        const isCollapsed = collapsed.has(section.title);

        return (
          <KpiSection
            key={section.title}
            title={section.title}
            footnote={section.footnote}
            open={!isCollapsed}
            onToggle={() => toggleSection(section.title)}
            meta={
              isCollapsed
                ? `${visibleCards.length} metric${visibleCards.length === 1 ? "" : "s"} hidden`
                : undefined
            }
          >
            <div className={section.gridClassName}>
              {visibleCards.map(card => (
                <KpiCard key={`${section.title}-${card.label}`} {...describeCard(card)} />
              ))}
            </div>
          </KpiSection>
        );
      })}
    </div>
  );
}
