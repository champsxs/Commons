import { C, Code, H2, H3, HelpLink, List, Note, P, Table } from "../content.tsx";

export function Uploading() {
  return (
    <>
      <P>
        Upload CSV, JSON (an array of objects) or JSON Lines files from a dataset's <strong>Upload</strong> tab, or with{" "}
        <HelpLink to="cli">the CLI</HelpLink>. Columns are matched to fields by name or label. Reference fields also accept
        the matched value's name, so a <C>city_code</C> column fills the <C>city</C> reference.
      </P>

      <H2>Choosing a mode</H2>
      <P>The mode decides how the file treats rows that are already there.</P>
      <Table
        head={["Mode", "Rows already in Commons", "New rows in the file", "Use it for"]}
        rows={[
          [<strong>Add rows</strong>, "Kept. A row whose key already exists makes the whole upload fail.", "Added", "Data that only grows: new months, new events"],
          [<strong>Add or update</strong>, "Updated when the key matches. Rows not in the file are left alone.", "Added", "Reference data that changes: stores, suppliers, prices"],
          [<strong>Replace all rows</strong>, "Deleted first", "Added", "Full snapshots that nothing links to"],
        ]}
      />
      <P><strong>Add or update</strong> needs a key field. It never deletes rows.</P>

      <H3>What add or update changes</H3>
      <List>
        <li>Only columns that are in the file. Leave a column out to keep its current values.</li>
        <li>An <strong>empty cell clears</strong> the value for that row. To keep a value, leave the whole column out of the file.</li>
        <li><C>updated_at</C> is set on every row it touches.</li>
      </List>

      <H3>Replace and links</H3>
      <P>
        If other datasets point at rows in this dataset, <strong>Replace all rows</strong> is refused, because deleting
        those rows would break their links. Use add or update instead.
      </P>

      <H2>Bad values and unknown references</H2>
      <P>Every value is checked against its field type before anything is written. You choose what happens with problems:</P>
      <List>
        <li><strong>Rows with bad values:</strong> reject the upload (default) or skip those rows.</li>
        <li><strong>Unknown references</strong> (a code matching no row): reject, skip the row, or leave the field empty. Each reference field has its own default, and you can override it per upload.</li>
      </List>
      <P>
        The report lists problems by row number and field, and names unknown codes, e.g. "no cities with city_code XYZ".
      </P>

      <H2>Safe by default</H2>
      <List>
        <li><strong>All or nothing:</strong> if anything fails while writing, the whole upload is undone. You never get half a file.</li>
        <li><strong>Check first:</strong> "Check file" (or <C>--dry-run</C> in the CLI) runs every check without writing anything.</li>
        <li><strong>History:</strong> each dataset's Upload tab lists who uploaded what, when, in which mode, and how many rows.</li>
      </List>

      <H2>From a script</H2>
      <Code label="Nightly update of a dataset">{`commons datasets upload suppliers suppliers.csv --mode upsert --dry-run && \\
commons datasets upload suppliers suppliers.csv --mode upsert`}</Code>
      <P>The CLI exits with an error code when rows have problems, so scheduled jobs can tell something went wrong.</P>

      <Note tone="warning">
        Commons records that an upload happened, but not what each row looked like before it. Keep your own copy of
        files if you may need to go back.
      </Note>
    </>
  );
}
