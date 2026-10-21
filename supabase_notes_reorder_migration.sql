-- Optimiertes Batch-Reorder für Notes mit unnest
CREATE OR REPLACE FUNCTION batch_reorder_notes(note_ids UUID[])
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE notes SET sort_order = new.sort_order
  FROM (SELECT unnest(note_ids) AS id, generate_subscripts(note_ids, 1) - 1 AS sort_order) AS new
  WHERE notes.id = new.id;
$$;