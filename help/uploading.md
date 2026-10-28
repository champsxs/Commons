---
title: Uploading and updating data
summary: How add, add-or-update and replace treat existing rows, and what happens to bad values.
group: Data
order: 30
keywords: upload csv json ingest upsert append replace mode blank empty
---

Upload CSV, JSON (an array of objects) or JSON Lines files from a dataset's **Upload** tab, or with [the CLI](/help/cli). Columns are matched to fields by name or label. Reference fields also accept the matched value's name, so a `city_code` column fills the `city` reference.

## Choosing a mode

The mode decides how the file treats rows that are already there.

| Mode | Rows already in Commons | New rows in the file | Use it for |
|---|---|---|---|
| **Add rows** | Kept. A row whose key already exists makes the whole upload fail. | Added | Data that only grows: new months, new events |
| **Add or update** | Updated when the key matches. Rows not in the file are left alone. | Added | Reference data that changes: stores, suppliers, prices |
| **Replace all rows** | Deleted first | Added | Full snapshots that nothing links to |

**Add or update** needs a key field. It never deletes rows.

### What add or update changes

- Only columns that are in the file. Leave a column out to keep its current values.
- An **empty cell clears** the value for that row. To keep a value, leave the whole column out of the file.
- `updated_at` is set on every row it touches.

### Replace and links

If other datasets point at rows in this dataset, **Replace all rows** is refused, because deleting those rows would break their links. Use add or update instead.

## Bad values and unknown references

Every value is checked against its field type before anything is written. You choose what happens with problems:

- **Rows with bad values:** reject the upload (default) or skip those rows.
- **Unknown references** (a code matching no row): reject, skip the row, or leave the field empty. Each reference field has its own default, and you can override it per upload.

The report lists problems by row number and field, and names unknown codes, e.g. "no cities with city_code XYZ".

## Safe by default

- **All or nothing:** if anything fails while writing, the whole upload is undone. You never get half a file.
- **Check first:** "Check file" (or `--dry-run` in the CLI) runs every check without writing anything.
- **History:** each dataset's Upload tab lists who uploaded what, when, in which mode, and how many rows.

## From a script

```bash title="Nightly update of a dataset"
commons datasets upload suppliers suppliers.csv --mode upsert --dry-run && \
commons datasets upload suppliers suppliers.csv --mode upsert
```

The CLI exits with an error code when rows have problems, so scheduled jobs can tell something went wrong.

> [!WARNING]
> Commons records that an upload happened, but not what each row looked like before it. Keep your own copy of files if you may need to go back.
