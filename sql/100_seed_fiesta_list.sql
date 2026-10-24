-- Fiesta Siesta: Seed der eigenen DB (aqmisgetzatbrvchbrkf)
-- Liste + Startkategorien in Spanien-Palette (Rot #AA151B / Gelb #F1BF00)

insert into public.lists (name, join_code)
select 'Fiesta Siesta', 'SIESTA26'
where not exists (select 1 from public.lists where upper(join_code) = 'SIESTA26');

-- Startkategorien Einkauf (shopping)
insert into public.categories (list_id, list_type, sort_order, name, icon, color, bg)
select l.id, 'shopping', v.sort_order, v.name, v.icon, v.color, v.bg
from public.lists l
cross join (values
  (0, 'Alkohol',           '🍷', '#ffffff', '#AA151B'),
  (1, 'Brot & Backwaren',  '🥖', '#ffffff', '#AA151B'),
  (2, 'Fleisch & Fisch',   '🐟', '#ffffff', '#AA151B'),
  (3, 'Gemüse & Kräuter',  '🥗', '#ffffff', '#AA151B'),
  (4, 'Milchprodukte',     '🧀', '#ffffff', '#AA151B'),
  (5, 'Obst',              '🍊', '#ffffff', '#AA151B'),
  (6, 'Sonstiges',         '📦', '#ffffff', '#AA151B')
) as v(sort_order, name, icon, color, bg)
where upper(l.join_code) = 'SIESTA26'
  and not exists (select 1 from public.categories c where c.list_id = l.id and c.list_type = 'shopping');

-- Startkategorien Mitbringen (bring)
insert into public.categories (list_id, list_type, sort_order, name, icon, color, bg)
select l.id, 'bring', v.sort_order, v.name, v.icon, v.color, v.bg
from public.lists l
cross join (values
  (0, 'Strand',           '🏖️', '#ffffff', '#AA151B'),
  (1, 'Spiele',           '🎲', '#ffffff', '#AA151B'),
  (2, 'Pool',             '🏊', '#ffffff', '#AA151B'),
  (3, 'Grundversorgung',  '🛒', '#ffffff', '#AA151B')
) as v(sort_order, name, icon, color, bg)
where upper(l.join_code) = 'SIESTA26'
  and not exists (select 1 from public.categories c where c.list_id = l.id and c.list_type = 'bring');

-- Startkategorien Ausgaben (expense)
insert into public.categories (list_id, list_type, sort_order, name, icon, color, bg)
select l.id, 'expense', v.sort_order, v.name, v.icon, v.color, v.bg
from public.lists l
cross join (values
  (1, 'Supermarkt',   '🛒', '#AA151B', '#fbe4e5'),
  (2, 'Restaurant',   '🥘', '#F1BF00', '#fdf3cf'),
  (3, 'Benzin',       '⛽', '#4a90d9', '#e0ecf7'),
  (4, 'Aktivitäten',  '🎯', '#e07a1f', '#fdf2d6'),
  (5, 'Alkohol',      '🍷', '#9b6dd9', '#e8dcf7'),
  (6, 'Maut',         '🛣️', '#6b7280', '#eef0f2'),
  (7, 'Allgemeines',  '📦', '#ffffff', '#F1BF00'),
  (8, 'Sonstiges',    '📦', '#ffffff', '#AA151B')
) as v(sort_order, name, icon, color, bg)
where upper(l.join_code) = 'SIESTA26'
  and not exists (select 1 from public.categories c where c.list_id = l.id and c.list_type = 'expense');

select l.id, l.name, l.join_code,
       (select count(*) from public.categories c where c.list_id = l.id) as categories
from public.lists l;
