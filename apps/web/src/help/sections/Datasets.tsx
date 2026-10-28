import { AppLink, C, H2, H3, HelpLink, List, Note, P, Table } from "../content.tsx";

export function Datasets() {
  return (
    <>
      <P>
        A dataset is a table with fields you define. Create one from <AppLink to="/datasets/new">New dataset</AppLink>,
        either from a CSV or JSON file (Commons guesses the fields) or by listing the fields yourself.
      </P>

      <H2>Field types</H2>
      <Table
        head={["Type", "For"]}
        rows={[
          ["Text", "Names, codes, descriptions"],
          ["Whole number", "Counts, quantities"],
          ["Number", "Amounts, rates, measurements"],
          ["Yes / no", "Flags such as is_flagship"],
          ["Date", "YYYY-MM-DD"],
          ["Date & time", "Timestamps"],
          ["JSON", "Structured extra data"],
          ["Reference", "A row in another dataset (see below)"],
        ]}
      />
      <P>
        Field names use lowercase letters, digits and underscores, e.g. <C>floor_area_m2</C>. Every dataset also gets
        <C>id</C>, <C>created_at</C> and <C>updated_at</C> automatically.
      </P>

      <H2>The key field</H2>
      <P>
        The key field identifies each row with a value people recognise, such as <C>store_code</C> or a country code.
        It must be unique and filled in. It matters for two things:
      </P>
      <List>
        <li>Other datasets link to yours by it.</li>
        <li>Uploads can update existing rows by it (<HelpLink to="uploading">add or update</HelpLink>).</li>
      </List>

      <H2>References: link, don't copy</H2>
      <P>
        A reference field points at a row in another dataset. For example, Stores has a <C>city</C> field pointing at
        Cities. Instead of copying city names into Stores, each store links to the city row, so a correction in Cities shows
        up everywhere.
      </P>
      <List>
        <li><strong>Points to:</strong> the dataset you link to.</li>
        <li><strong>Matched by:</strong> the value in your files, usually the other dataset's key (e.g. <C>city_code</C>). It must be unique there.</li>
        <li><strong>Unknown values:</strong> what an upload does with a code that matches no row: reject the upload, skip that row, or leave the field empty.</li>
      </List>
      <P>
        You can only reference datasets you can see, and owners can turn off "Other datasets may reference this one". In
        GraphQL, references work both ways: <C>{"store { city { name } }"}</C> and <C>{"city { stores { … } }"}</C>.
      </P>

      <H2>What's protected when things change</H2>
      <P>Because other teams build on your data, some changes are blocked or need confirming:</P>
      <Table
        head={["Change", "What happens"]}
        rows={[
          ["Delete a row others point to", "Blocked. Nothing is ever deleted from another team's data as a side effect."],
          ["Remove a field others match on", "Blocked. Deprecate it instead."],
          ["Remove a field a published page uses", "Asks you to confirm; the page may break."],
          ["Delete a dataset others reference", "Blocked until those references are removed."],
          ["Add a field", "Always fine. New fields start empty; required fields can only be added to empty datasets."],
        ]}
      />
      <H3>Renaming a field</H3>
      <P>
        Fields can't be renamed in place, because that would break everything using the old name. Add the new field, copy
        the data over with an upload, and mark the old one <strong>deprecated</strong> (Fields tab). Deprecated fields keep
        working but are hidden from tables and new forms.
      </P>
      <P>
        The <strong>Used by</strong> tab of a dataset lists every dataset and page that depends on it.
      </P>

      <Note>
        Coming later: fields holding a <em>list</em> of references (for example, a product in several categories).
      </Note>
    </>
  );
}
