-- Versioned Client Success criteria. Closed rows cannot be rewritten.
-- Cutover is the UTC date this migration runs. Ranges before that stay on the legacy ruler.

CREATE TABLE IF NOT EXISTS kpi_stock_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id text NOT NULL CHECK (profile_id IN ('RM', 'DSCR', 'CALL_CENTER')),
  effective_start date NOT NULL,
  effective_end date,
  ruler text NOT NULL CHECK (ruler IN ('legacy', 'current')),
  bands jsonb NOT NULL DEFAULT '{}'::jsonb,
  placeholders jsonb,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, effective_start),
  CHECK (effective_end IS NULL OR effective_end > effective_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS kpi_stock_versions_one_open
  ON kpi_stock_versions (profile_id)
  WHERE effective_end IS NULL;

CREATE TABLE IF NOT EXISTS kpi_client_goal_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  effective_start date NOT NULL,
  effective_end date,
  ruler text NOT NULL CHECK (ruler IN ('legacy', 'current')),
  bands jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, effective_start),
  CHECK (effective_end IS NULL OR effective_end > effective_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS kpi_client_goal_versions_one_open
  ON kpi_client_goal_versions (client_id)
  WHERE effective_end IS NULL;

CREATE INDEX IF NOT EXISTS kpi_client_goal_versions_client_idx
  ON kpi_client_goal_versions (client_id, effective_start);

ALTER TABLE kpi_stock_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_client_goal_versions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION kpi_version_close_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.effective_end IS NOT NULL THEN
    RAISE EXCEPTION 'Closed criteria versions cannot be updated';
  END IF;
  IF NEW.effective_end IS NULL OR NEW.effective_end IS NOT DISTINCT FROM OLD.effective_end THEN
    RAISE EXCEPTION 'Open criteria versions can only be closed';
  END IF;
  IF NEW.bands IS DISTINCT FROM OLD.bands
     OR NEW.effective_start IS DISTINCT FROM OLD.effective_start
     OR NEW.ruler IS DISTINCT FROM OLD.ruler
     OR to_jsonb(NEW) - 'effective_end' - 'bands' - 'effective_start' - 'ruler'
        IS DISTINCT FROM to_jsonb(OLD) - 'effective_end' - 'bands' - 'effective_start' - 'ruler' THEN
    RAISE EXCEPTION 'Open criteria versions can only be closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kpi_stock_versions_close_only ON kpi_stock_versions;
CREATE TRIGGER kpi_stock_versions_close_only
  BEFORE UPDATE ON kpi_stock_versions
  FOR EACH ROW EXECUTE FUNCTION kpi_version_close_only();

DROP TRIGGER IF EXISTS kpi_client_goal_versions_close_only ON kpi_client_goal_versions;
CREATE TRIGGER kpi_client_goal_versions_close_only
  BEFORE UPDATE ON kpi_client_goal_versions
  FOR EACH ROW EXECUTE FUNCTION kpi_version_close_only();

-- Bands match DEFAULT_KPI_BANDS in src/lib/client-health.ts (seed, not a second editor).
DO $$
DECLARE
  cutover date := (now() AT TIME ZONE 'utc')::date;
  rm jsonb := $rm${"lead_to_qualified":{"bands":{"critical":40,"below":50,"at":65},"higherIsBetter":true,"unit":"pct","minDenominator":5},"pickup_rate":{"bands":{"critical":20,"below":30,"at":45},"higherIsBetter":true,"unit":"pct","minDenominator":20},"booking_rate":{"bands":{"critical":20,"below":25,"at":30},"higherIsBetter":true,"unit":"pct","minDenominator":5},"hand_raise_rate":{"bands":{"critical":20,"below":25,"at":30},"higherIsBetter":true,"unit":"pct","minDenominator":5},"lead_booking_rate":{"bands":{"critical":3,"below":5,"at":8},"higherIsBetter":true,"unit":"pct","minDenominator":5},"show_rate":{"bands":{"critical":55,"below":63,"at":70},"higherIsBetter":true,"unit":"pct","minDenominator":5},"close_rate":{"bands":{"critical":10,"below":20,"at":35},"higherIsBetter":true,"unit":"pct","minDenominator":10},"cpl":{"bands":{"critical":25,"below":20,"at":15},"higherIsBetter":false,"unit":"money","minDenominator":5},"cpql":{"bands":{"critical":62.5,"below":40,"at":23.08},"higherIsBetter":false,"unit":"money","minDenominator":3},"cps":{"bands":{"critical":312.5,"below":160,"at":76.92},"higherIsBetter":false,"unit":"money","minDenominator":5}}$rm$::jsonb;
  dscr_open jsonb := $dscr${"lead_to_qualified":{"bands":{"critical":40,"below":50,"at":65},"higherIsBetter":true,"unit":"pct","minDenominator":5},"hand_raise_rate":{"bands":{"critical":20,"below":25,"at":30},"higherIsBetter":true,"unit":"pct","minDenominator":5},"show_rate":{"bands":{"critical":55,"below":63,"at":70},"higherIsBetter":true,"unit":"pct","minDenominator":5},"close_rate":{"bands":{"critical":10,"below":20,"at":35},"higherIsBetter":true,"unit":"pct","minDenominator":10},"lead_booking_rate":{"bands":{"critical":3,"below":5,"at":8},"higherIsBetter":true,"unit":"pct","minDenominator":5}}$dscr$::jsonb;
  cc jsonb := $cc${"hand_raise_rate":{"bands":{"critical":3,"below":5,"at":8},"higherIsBetter":true,"unit":"pct","minDenominator":5},"show_rate":{"bands":{"critical":55,"below":63,"at":70},"higherIsBetter":true,"unit":"pct","minDenominator":5},"lead_booking_rate":{"bands":{"critical":3,"below":5,"at":8},"higherIsBetter":true,"unit":"pct","minDenominator":5}}$cc$::jsonb;
  dscr_placeholder jsonb := '{"cpl":{"worst":70,"demo":55,"best":45,"approved":false},"rates":{"source":"shared_rm"}}'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM kpi_stock_versions) THEN
    RETURN;
  END IF;

  INSERT INTO kpi_stock_versions (profile_id, effective_start, effective_end, ruler, bands, placeholders, note)
  VALUES
    ('RM', DATE '2000-01-01', cutover, 'legacy', rm, NULL, 'Legacy ruler. One paid-ads line. Custom CPL only.'),
    ('RM', cutover, NULL, 'current', rm, NULL, 'Open RM stock.'),
    ('DSCR', DATE '2000-01-01', cutover, 'legacy', rm, NULL, 'Legacy ruler. DSCR was graded on the RM line, including cost.'),
    ('DSCR', cutover, NULL, 'current', dscr_open, dscr_placeholder, 'DSCR rate lines are a frozen copy of RM. Cost tiers are unset.'),
    ('CALL_CENTER', DATE '2000-01-01', cutover, 'legacy', cc, NULL, 'Legacy call center. Hand-raise on 3 / 5 / 8.'),
    ('CALL_CENTER', cutover, NULL, 'current', cc, NULL, 'Open call center stock.');

  INSERT INTO kpi_client_goal_versions (client_id, effective_start, effective_end, ruler, bands, note, created_by, created_at)
  SELECT c.id, DATE '2000-01-01', cutover, 'legacy',
    jsonb_build_object('cpl', c.kpi_benchmarks->'cpl'),
    'Legacy custom CPL. Other stored keys were ignored by the grader.',
    c.kpi_benchmarks_updated_by,
    COALESCE(c.kpi_benchmarks_updated_at, now())
  FROM clients c
  WHERE c.kpi_benchmarks ? 'cpl'
    AND jsonb_typeof(c.kpi_benchmarks->'cpl') = 'object';

  INSERT INTO kpi_client_goal_versions (client_id, effective_start, effective_end, ruler, bands, note, created_by)
  SELECT c.id, cutover, NULL, 'current',
    jsonb_build_object('cpl', c.kpi_benchmarks->'cpl'),
    'Open custom CPL carried forward. Ignored keys stay on the client until a forward save.',
    c.kpi_benchmarks_updated_by
  FROM clients c
  WHERE c.kpi_benchmarks ? 'cpl'
    AND jsonb_typeof(c.kpi_benchmarks->'cpl') = 'object';
END $$;

CREATE OR REPLACE FUNCTION save_kpi_stock_version(
  p_profile_id text,
  p_effective_start date,
  p_bands jsonb,
  p_placeholders jsonb,
  p_note text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_effective_start < today THEN
    RAISE EXCEPTION 'Effective start cannot be before today';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_stock_versions
    WHERE profile_id = p_profile_id AND effective_start = p_effective_start
  ) THEN
    RAISE EXCEPTION 'That start date is already a version';
  END IF;
  UPDATE kpi_stock_versions
  SET effective_end = p_effective_start
  WHERE profile_id = p_profile_id AND effective_end IS NULL;
  INSERT INTO kpi_stock_versions (
    profile_id, effective_start, effective_end, ruler, bands, placeholders, note, created_by
  ) VALUES (
    p_profile_id, p_effective_start, NULL, 'current', p_bands, p_placeholders, p_note, p_created_by
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION save_kpi_client_goal_version(
  p_client_id uuid,
  p_effective_start date,
  p_bands jsonb,
  p_note text,
  p_created_by uuid
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_id uuid;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_effective_start < today THEN
    RAISE EXCEPTION 'Effective start cannot be before today';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_client_goal_versions
    WHERE client_id = p_client_id AND effective_start = p_effective_start
  ) THEN
    RAISE EXCEPTION 'That start date is already a version';
  END IF;
  UPDATE kpi_client_goal_versions
  SET effective_end = p_effective_start
  WHERE client_id = p_client_id AND effective_end IS NULL;
  INSERT INTO kpi_client_goal_versions (
    client_id, effective_start, effective_end, ruler, bands, note, created_by
  ) VALUES (
    p_client_id, p_effective_start, NULL, 'current', COALESCE(p_bands, '{}'::jsonb), p_note, p_created_by
  ) RETURNING id INTO new_id;

  UPDATE clients
  SET kpi_benchmarks = CASE WHEN p_bands IS NULL OR p_bands = '{}'::jsonb THEN NULL ELSE p_bands END,
      kpi_benchmarks_note = p_note,
      kpi_benchmarks_updated_at = now(),
      kpi_benchmarks_updated_by = p_created_by
  WHERE id = p_client_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION kpi_version_close_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION save_kpi_stock_version(text, date, jsonb, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_kpi_client_goal_version(uuid, date, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_kpi_stock_version(text, date, jsonb, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION save_kpi_client_goal_version(uuid, date, jsonb, text, uuid) TO service_role;
