-- Optimiertes Batch-Reorder mit unnest (ein UPDATE statt N)
CREATE OR REPLACE FUNCTION batch_reorder_items(item_ids UUID[])
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE items SET sort_order = new.sort_order
  FROM (SELECT unnest(item_ids) AS id, generate_subscripts(item_ids, 1) - 1 AS sort_order) AS new
  WHERE items.id = new.id;
$$;