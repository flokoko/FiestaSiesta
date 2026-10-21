-- Admin-Passwort setzen/ändern (hashed mit bcrypt)
CREATE OR REPLACE FUNCTION set_admin_password(
  p_list_id UUID,
  p_password TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
BEGIN
  IF length(p_password) < 3 THEN
    RETURN false;
  END IF;

  UPDATE lists
  SET admin_password = crypt(p_password, gen_salt('bf', 10))
  WHERE id = p_list_id;

  RETURN FOUND;
END;
$$;