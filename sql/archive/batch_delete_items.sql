CREATE OR REPLACE FUNCTION batch_delete_items(item_ids UUID[])
RETURNS void
LANGUAGE sql SECURITY DEFINER
AS $$
  DELETE FROM items WHERE id = ANY(item_ids);
$$;