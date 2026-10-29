---
title: Datasets and references
summary: Create datasets, choose a key field, and link to other teams' data instead of copying it.
group: Data
order: 20
keywords: fields key reference link deprecate delete rename
---

A dataset is a table with fields you define. Create one from [New dataset](/datasets/new), either from a CSV or JSON file (Commons guesses the fields) or by listing the fields yourself.

## Field types

| Type | For |
|---|---|
| Text | Names, codes, descriptions |
| Whole number | Counts, quantities |
| Number | Amounts, rates, measurements |
| Yes / no | Flags such as is_flagship |
| Date | YYYY-MM-DD |
| Date & time | Timestamps |
| JSON | Structured extra data |
| Reference | A row in another dataset (see below) |

Field names use lowercase letters, digits and underscores, e.g. `floor_area_m2`. Every dataset also gets `id`, `created_at` and `updated_at` automatically.

## The key field

The key field identifies each row with a value people recognise, such as `store_code` or a country code. It must be unique and filled in. It matters for two things:

- Other datasets link to yours by it.
- Uploads can update existing rows by it ([add or update](/help/uploading)).

## References: link, don't copy

A reference field points at a row in another dataset. For example, Stores has a `city` field pointing at Cities. Instead of copying city names into Stores, each store links to the city row, so a correction in Cities shows up everywhere.

- **Points to:** the dataset you link to.
- **Matched by:** the value in your files, usually the other dataset's key (e.g. `city_code`). It must be unique there.
- **Unknown values:** what an upload does with a code that matches no row: reject the upload, skip that row, or leave the field empty.

You can only reference datasets you can see, and owners can turn off "Other datasets may reference this one". In GraphQL, references work both ways: `store { city { name } }` and `city { stores { … } }`.

## What's protected when things change

Because other teams build on your data, some changes are blocked or need confirming:

| Change | What happens |
|---|---|
| Delete a row others point to | Blocked. Nothing is ever deleted from another team's data as a side effect. |
| Remove a field others match on | Blocked. Deprecate it instead. |
| Remove a field a published page uses | Asks you to confirm; the page may break. |
| Delete a dataset others reference | Blocked until those references are removed. |
| Add a field | Always fine, in the Fields tab or with `commons datasets add-field`. New fields start empty; required fields can only be added to empty datasets. |

### Renaming a field

Fields can't be renamed in place, because that would break everything using the old name. Add the new field, copy the data over with an upload, and mark the old one **deprecated** (Fields tab). Deprecated fields keep working but are hidden from tables and new forms.

The **Used by** tab of a dataset lists every dataset and page that depends on it.

> [!NOTE]
> Coming later: fields holding a *list* of references (for example, a product in several categories).
