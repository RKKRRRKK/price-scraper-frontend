// ── Canonical notes taxonomy ──
// Edit this file to add or rename categories / subcategories.
// The editor + modal selects are strict: only the values listed here are accepted
// when creating or editing a note. Pre-existing notes with non-canonical values
// are surfaced via the "Needs review" filter in the UI.
//
// Shape: { [context]: { [category]: [subcategory, ...] } }

export const NOTES_TAXONOMY = Object.freeze({
  personal: {
    Projects:  ['Software', 'Hardware', 'Physical', 'Art', 'Analysis', 'Other/Mix'],
    Meta:      ['Productivity', 'Sensors', 'Scraper', 'Other/New'],
    Ideas:     ['Politics/Law', 'Psychology', 'Entertainment', 'Business/Money', 'Analysis'],
    Health:    ['Workouts', 'Supplements/Protocols', 'Doctors', 'Analysis', 'Other'],
    Misc:      ['Favorites', 'Food', 'Random', 'Knowledge/Facts'],
    Relations: ['Important Dates', 'Favorites/Interests/Facts', 'Memories', 'Feels'],
  },
  work: {
    David:             ['Dashboards', 'Ad-hoc', 'Projects', 'Ideation', 'Experiments', 'Knowledge', 'Notes / Todos', 'Tools'],
    Rozerin:           ['Dashboards', 'Ad-hoc', 'Projects', 'Ideation', 'Experiments', 'Knowledge', 'Notes / Todos', 'Tools'],
    'Others/Projects': ['Ad-hoc', 'Long-term'],
  },
})

export const TAXONOMY_CONTEXTS = Object.freeze(Object.keys(NOTES_TAXONOMY))

export function categoriesFor(context) {
  return Object.keys(NOTES_TAXONOMY[context] || {})
}

export function subcategoriesFor(context, category) {
  return NOTES_TAXONOMY[context]?.[category] || []
}

// True iff the (context, category, subcategory) triple matches the taxonomy
// exactly. Used to drive the "Needs review" badge + filter.
export function isCanonical(context, category, subcategory) {
  const cats = NOTES_TAXONOMY[context]
  if (!cats) return false
  const subs = cats[category]
  if (!subs) return false
  return subs.includes(subcategory)
}
