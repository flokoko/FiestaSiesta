-- ── Ceviche de camarón (nach Madelines Short „My dad's weekly ceviche routine") ──
-- Klassisch an der Küste Sinaloas: gekochte Garnelen, viel Limette, Tomate, Gurke,
-- rote Zwiebel, Koriander, Avocado, dazu Ketchup und eine scharfe Sauce.
-- Gekochte Garnelen statt roher: auf der Insel ist die Kühlkette im Supermarkt
-- nicht verlässlich genug für rohe Meerestiere.

insert into public.recipes (list_id, title, note, servings, minutes, ingredients, steps, created_by)
select l.id,
  'Ceviche de camarón',
  'Garnelen-Ceviche, wie es an der Küste Sinaloas zum Wochenende auf den Tisch kommt. Vorlage: Madelines Short „My dad''s weekly ceviche routine".',
  3, 25,
  '[{"name":"Gambas, gekocht und geschält","qty":"500","unit":"g","category":"Fleisch & Fisch"},
    {"name":"Limetten","qty":"6","unit":"","category":"Obst"},
    {"name":"Rote Zwiebel","qty":"1","unit":"","category":"Gemüse & Kräuter"},
    {"name":"Tomaten","qty":"3","unit":"","category":"Gemüse & Kräuter"},
    {"name":"Gurke","qty":"1","unit":"","category":"Gemüse & Kräuter"},
    {"name":"Koriander","qty":"1","unit":"bund","category":"Gemüse & Kräuter"},
    {"name":"Chili (Serrano oder Jalapeño)","qty":"1","unit":"","category":"Gemüse & Kräuter"},
    {"name":"Avocado","qty":"1","unit":"","category":"Gemüse & Kräuter"},
    {"name":"Ketchup","qty":"4","unit":"el","category":"Sonstiges"},
    {"name":"Scharfe Sauce (Valentina)","qty":"2","unit":"el","category":"Sonstiges"},
    {"name":"Tostadas oder Tortillachips","qty":"1","unit":"packung","category":"Brot & Backwaren"},
    {"name":"Salz und Pfeffer","qty":"","unit":"","category":"Sonstiges"}]'::jsonb,
  'Garnelen kalt abspülen, trocken tupfen und in 1 cm große Stücke schneiden.
Saft von 5 Limetten auspressen, über die Garnelen geben und 10 Min im Kühlschrank ziehen lassen — die Säure gart sie nach, ohne sie zäh zu machen.
Zwiebel, Tomaten und Gurke fein würfeln, Koriander hacken, Chili sehr fein schneiden.
Alles mit Ketchup und scharfer Sauce unter die Garnelen heben, mit Salz und Pfeffer abschmecken.
Avocado erst kurz vor dem Servieren in Scheiben darauf legen, sonst wird sie braun.
Mit Tostadas essen — oder pur, dann ist es eine Vorspeise. Die sechste Limette zum Nachdrücken dazustellen.',
  'Flo'
from public.lists l
where l.join_code in ('SIESTA26', 'TESTUI26')
  and not exists (select 1 from public.recipes r where r.list_id = l.id and r.title = 'Ceviche de camarón');
