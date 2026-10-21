-- Migration: Add is_favorite column to notes table + toggle RPC
-- Run this in the Supabase SQL editor

-- 1. Add is_favorite column
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

-- 2. Create toggle_note_favorite RPC function (SECURITY DEFINER)
--    Toggles is_favorite for a given note_id and returns the new value.
CREATE OR REPLACE FUNCTION toggle_note_favorite(note_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_value BOOLEAN;
BEGIN
  UPDATE notes
  SET is_favorite = NOT is_favorite
  WHERE id = note_id
  RETURNING is_favorite INTO new_value;

  IF new_value IS NULL THEN
    RAISE EXCEPTION 'Note with id % not found', note_id;
  END IF;

  RETURN new_value;
END;
$$;

-- 3. Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION toggle_note_favorite(UUID) TO authenticated;