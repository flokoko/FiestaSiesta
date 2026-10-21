-- Optimiertes Batch-Reorder für Kategorien mit unnest
CREATE OR REPLACE FUNCTION batch_reorder_categories(category_data JSONB)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE categories SET sort_order = (c.data->>'sort_order')::int
  FROM (SELECT jsonb_array_elements(category_data) AS data) AS c
  WHERE categories.id = (c.data->>'id')::uuid;
END;
$$;