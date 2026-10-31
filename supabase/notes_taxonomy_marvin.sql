-- Notes taxonomy: move 'Personal Assistant / AI' notes into the new Marvin → Todo.
-- The taxonomy itself lives in src/lib/taxonomy.js; category/subcategory are
-- plain text columns, so only the existing rows need moving. Run by hand.

-- Preview what will move:
-- select id, category, subcategory, left(content, 80)
--   from notes
--  where context = 'personal' and subcategory = 'Personal Assistant / AI';

begin;

update notes
   set category = 'Marvin',
       subcategory = 'Todo'
 where context = 'personal'
   and subcategory = 'Personal Assistant / AI';

commit;
