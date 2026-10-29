-- Admin-Passwort-Verifikation mit bcrypt + backward-compat für Klartext
CREATE OR REPLACE FUNCTION verify_admin_password(
  p_list_id UUID,
  p_password TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = extensions, public
AS $$
DECLARE
  v_admin_password TEXT;
BEGIN
  SELECT admin_password INTO v_admin_password
  FROM lists WHERE id = p_list_id;

  IF v_admin_password IS NULL THEN
    RETURN false;
  END IF;

  -- Prüfe ob es ein bcrypt-Hash ist oder alter Klartext
  IF v_admin_password LIKE '$2a$%' OR v_admin_password LIKE '$2b$%' THEN
    -- bcrypt Hash — normaler Vergleich
    RETURN v_admin_password = crypt(p_password, v_admin_password);
  ELSE
    -- Alter Klartext — direkter Vergleich
    -- Bei Erfolg: Upgrade auf bcrypt
    IF v_admin_password = p_password THEN
      UPDATE lists SET admin_password = crypt(p_password, gen_salt('bf', 10))
      WHERE id = p_list_id;
      RETURN true;
    END IF;
    RETURN false;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
