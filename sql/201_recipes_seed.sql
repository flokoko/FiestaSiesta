-- ── Startrezepte für die Ferienküche ─────────────────────────────────
-- Kochen mit dem, was es in Agüimes gibt (Mercadona / HiperDino / Markt).
-- Zutaten-Kategorien entsprechen exakt den Einkaufskategorien der Liste.

insert into public.recipes (list_id, title, note, servings, minutes, ingredients, steps, created_by)
select l.id, r.title, r.note, r.servings, r.minutes, r.ingredients::jsonb, r.steps, 'Flo'
from public.lists l
cross join (values
  ('Papas arrugadas con mojo',
   'Der Kanaren-Klassiker: kleine Kartoffeln in Salzwasser, dazu rote oder grüne Mojo.',
   3, 30,
   '[{"name":"Kartoffeln","qty":"1","unit":"kg","category":"Gemüse & Kräuter"},
     {"name":"Meersalz","qty":"200","unit":"g","category":"Sonstiges"},
     {"name":"Knoblauchzehen","qty":"4","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Paprikapulver","qty":"1","unit":"tl","category":"Sonstiges"},
     {"name":"Kümmel","qty":"1","unit":"tl","category":"Sonstiges"},
     {"name":"Olivenöl","qty":"6","unit":"el","category":"Sonstiges"},
     {"name":"Weißweinessig","qty":"2","unit":"el","category":"Sonstiges"}]',
   'Kartoffeln ungeschält waschen, mit 200 g Salz und Wasser knapp bedeckt 20–25 Min kochen.
Wasser abgießen und die Kartoffeln im Topf bei kleiner Hitze trocken schwenken, bis Salzränder entstehen.
Knoblauch, Paprika, Kümmel, Öl und Essig zu einer Mojo rühren, mit Salz abschmecken.
Heiß servieren — der Ofen bleibt kalt.'),
  ('Tortilla española',
   'Zwiebel-Kartoffel-Omelett, schmeckt kalt genauso gut — ideal für den Strandtag.',
   3, 35,
   '[{"name":"Kartoffeln","qty":"600","unit":"g","category":"Gemüse & Kräuter"},
     {"name":"Zwiebeln","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Eier","qty":"6","unit":"","category":"Milchprodukte"},
     {"name":"Olivenöl","qty":"150","unit":"ml","category":"Sonstiges"},
     {"name":"Salz","qty":"","unit":"","category":"Sonstiges"}]',
   'Kartoffeln in dünne Scheiben, Zwiebel in Ringe schneiden.
Im Olivenöl bei mittlerer Hitze 15 Min weich garen, nicht bräunen; abtropfen lassen.
Eier verquirlen, salzen, Kartoffeln unterheben und 5 Min ziehen lassen.
In einer Pfanne stocken lassen, mit einem Teller wenden und fertig backen.'),
  ('Gambas al ajillo',
   'Fünf Minuten Pfanne, zehn Minuten Brotzeit. Dazu Baguette zum Tunken.',
   3, 15,
   '[{"name":"Gambas","qty":"500","unit":"g","category":"Fleisch & Fisch"},
     {"name":"Knoblauchzehen","qty":"5","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Chili","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Olivenöl","qty":"80","unit":"ml","category":"Sonstiges"},
     {"name":"Petersilie","qty":"1","unit":"bund","category":"Gemüse & Kräuter"},
     {"name":"Baguette","qty":"1","unit":"","category":"Brot & Backwaren"}]',
   'Öl in einer Pfanne erhitzen, Knoblauch in Scheiben und Chili darin goldgelb ziehen lassen.
Gambas zugeben, 2–3 Min pro Seite, salzen.
Petersilie darüber, sofort mit Brot servieren.'),
  ('Pasta aglio e olio',
   'Wenn der Tag lang war: acht Minuten Küche, keine Einkaufstour.',
   3, 20,
   '[{"name":"Spaghetti","qty":"400","unit":"g","category":"Sonstiges"},
     {"name":"Knoblauchzehen","qty":"6","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Olivenöl","qty":"100","unit":"ml","category":"Sonstiges"},
     {"name":"Chili","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Petersilie","qty":"1","unit":"bund","category":"Gemüse & Kräuter"},
     {"name":"Parmesan","qty":"50","unit":"g","category":"Milchprodukte"}]',
   'Nudeln in reichlich Salzwasser al dente kochen, eine Tasse Kochwasser aufheben.
Knoblauch in Scheiben im Öl langsam goldgelb ziehen, Chili dazu.
Nudeln mit etwas Kochwasser in die Pfanne, durchschwenken, Petersilie und Parmesan darüber.'),
  ('Pollo al horno con papas',
   'Ein Blech, eine Stunde, danach nur ein Teller Abwasch.',
   3, 65,
   '[{"name":"Hähnchenschenkel","qty":"6","unit":"","category":"Fleisch & Fisch"},
     {"name":"Kartoffeln","qty":"800","unit":"g","category":"Gemüse & Kräuter"},
     {"name":"Zwiebeln","qty":"2","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Zitronen","qty":"1","unit":"","category":"Obst"},
     {"name":"Knoblauchzehen","qty":"4","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Paprikapulver","qty":"2","unit":"tl","category":"Sonstiges"},
     {"name":"Olivenöl","qty":"4","unit":"el","category":"Sonstiges"},
     {"name":"Rosmarin","qty":"2","unit":"","category":"Gemüse & Kräuter"}]',
   'Ofen auf 200 °C vorheizen. Kartoffeln vierteln, Zwiebeln achteln, alles auf ein Blech geben.
Hähnchen mit Paprika, Salz, Öl und Zitronensaft einreiben, zwischen die Kartoffeln legen.
Knoblauch und Rosmarin dazu, 50–55 Min backen, nach der Hälfte einmal wenden.'),
  ('Ensalada mixta mit Thunfisch',
   'Kein Kochen, nur Schneiden — der Ausgleich zu den frittierten Tagen.',
   3, 10,
   '[{"name":"Kopfsalat","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Tomaten","qty":"3","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Gurke","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Zwiebeln","qty":"1","unit":"","category":"Gemüse & Kräuter"},
     {"name":"Thunfisch","qty":"2","unit":"dose","category":"Fleisch & Fisch"},
     {"name":"Oliven","qty":"100","unit":"g","category":"Gemüse & Kräuter"},
     {"name":"Olivenöl","qty":"4","unit":"el","category":"Sonstiges"},
     {"name":"Weißweinessig","qty":"2","unit":"el","category":"Sonstiges"}]',
   'Alles waschen, klein schneiden, in eine große Schüssel geben.
Thunfisch abtropfen und darauf verteilen.
Mit Öl, Essig und Salz anmachen — erst am Tisch, sonst wird der Salat welk.')
) as r(title, note, servings, minutes, ingredients, steps)
where l.join_code in ('SIESTA26', 'TESTUI26')
  and not exists (select 1 from public.recipes x where x.list_id = l.id and x.title = r.title);
