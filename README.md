bugs/todo

11. Fix link on scatterplot 
12. Fix double entires into list (based on marketplace filter)



----------MVP--------------------

1. Smart Filter Rejection Sections
15. Manual run trigger for specific card.
12. Sorting for cards
12. Option to reset lowest price
13. Free form vague term exploration llm powered  -> "I want a lens for portrait for my d750" -> generates array of suitable lenses -> scrapes available used offerings for each -> compares the lowest price for each lens to their value -> chooses the best option and an alternative -> gives an assessment (should you wait, re-run again? based on available market data assumption, adjusted by data from DB (LLM previously thought item is X price, but reality is X - 20%, apply said factor).
14. 13. Telegram account setup to settings area
15. Custom mim amounts to settings area
2. change copy to be card specific
3. Add a note section for each card 

4. 8. Make cards moveable (and add hover and active styling)

16. "SmartFilter → https://www.kleinanzeigen.de/s-anzeige/nikon-d850-30-tsd-ausloesungen-top-241481-/2001774800-245-4304 Fit=false, Reason="Includes usage and condition details.""

 


_done_
11. Scatterplot for specific item prices
14. Custom instructions for smart filter
- Tools → Breadboard tool: illustrative breadboard designer (full/half/mini), components +
  Pi/ESP32/custom boards, jumper wires, computed electrical nets, multi-sheet persistence
  (Supabase `breadboard_sheets` — run `supabase/breadboard_schema.sql`), Copy-as-MD with an
  embedded build spec, and an "AI build" paste-to-construct round-trip. Docs:
  `src/components/breadboard/README.md`.
- Tools → Canvy tool: Miro-style whiteboard (stickies, text, shapes, arrows, comments) with
  folders + Main/Branch copies, persistence (Supabase `canvy_boards`/`canvy_folders` — run
  `supabase/canvy_schema.sql`), Miro/Copy-for-AI clipboard interop, and AI editing two ways:
  manual copy/paste, or **Run with AI** — a direct screenshot round-trip through OpenRouter
  (`google/gemini-3.5-flash`) via the `canvy-ai` Supabase Edge Function, where Gemini edits the
  board then reviews a screenshot of its own result and corrects it. Docs:
  `src/components/canvy/README.md`.
