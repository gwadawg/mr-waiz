-- Let a not-yet-started stock or custom version be edited again.
-- A save whose start is already in force still closes that row and opens the next one.
-- Closed rows stay closed. Run this if add_kpi_criteria_versions.sql was applied earlier.

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
    WHERE profile_id = p_profile_id
      AND effective_end IS NULL
      AND effective_start = p_effective_start
      AND effective_start > today
  ) THEN
    DELETE FROM kpi_stock_versions
    WHERE profile_id = p_profile_id
      AND effective_end IS NULL
      AND effective_start = p_effective_start;
    INSERT INTO kpi_stock_versions (
      profile_id, effective_start, effective_end, ruler, bands, placeholders, note, created_by
    ) VALUES (
      p_profile_id, p_effective_start, NULL, 'current', p_bands, p_placeholders, p_note, p_created_by
    ) RETURNING id INTO new_id;
    RETURN new_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_stock_versions
    WHERE profile_id = p_profile_id AND effective_start = p_effective_start
  ) THEN
    RAISE EXCEPTION 'That start date is already a version';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_stock_versions
    WHERE profile_id = p_profile_id AND effective_end IS NULL AND effective_start >= p_effective_start
  ) THEN
    RAISE EXCEPTION 'Effective start must be after the open version start';
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
    WHERE client_id = p_client_id
      AND effective_end IS NULL
      AND effective_start = p_effective_start
      AND effective_start > today
  ) THEN
    DELETE FROM kpi_client_goal_versions
    WHERE client_id = p_client_id
      AND effective_end IS NULL
      AND effective_start = p_effective_start;
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
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_client_goal_versions
    WHERE client_id = p_client_id AND effective_start = p_effective_start
  ) THEN
    RAISE EXCEPTION 'That start date is already a version';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kpi_client_goal_versions
    WHERE client_id = p_client_id AND effective_end IS NULL AND effective_start >= p_effective_start
  ) THEN
    RAISE EXCEPTION 'Effective start must be after the open version start';
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

REVOKE ALL ON FUNCTION save_kpi_stock_version(text, date, jsonb, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_kpi_client_goal_version(uuid, date, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_kpi_stock_version(text, date, jsonb, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION save_kpi_client_goal_version(uuid, date, jsonb, text, uuid) TO service_role;
