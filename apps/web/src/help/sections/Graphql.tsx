import { usePublicConfig } from "../../config.ts";
import { C, Code, H2, List, P, Table } from "../content.tsx";

export function Graphql() {
  const { apiUrl } = usePublicConfig();
  return (
    <>
      <P>
        Every dataset you can see is available through one GraphQL API at <C>{`${apiUrl}/graphql`}</C>. Try queries in{" "}
        <a className="text-primary hover:underline" href="/graphiql" target="_blank" rel="noreferrer">GraphiQL</a>, and find
        each dataset's exact names on its <strong>API</strong> tab or with <C>commons datasets show &lt;dataset&gt;</C>.
      </P>

      <H2>Names</H2>
      <Table
        head={["Dataset field", "In GraphQL"]}
        rows={[
          [<C>floor_area_m2</C>, <C>floorAreaM2</C>],
          [<>dataset <C>stores</C></>, <>type <C>Store</C>, list <C>allStores</C>, one row <C>storeById</C></>],
          [<>key field <C>store_code</C></>, <C>storeByStoreCode(storeCode: "S001")</C>],
        ]}
      />

      <H2>Lists</H2>
      <Code>{`{
  allStores(first: 20, offset: 0, orderBy: [NAME_ASC], condition: { isFlagship: true }) {
    totalCount
    nodes { storeCode name openedOn }
  }
}`}</Code>
      <List>
        <li><C>first</C> / <C>offset</C> page through results.</li>
        <li><C>orderBy</C> takes <C>FIELD_ASC</C> or <C>FIELD_DESC</C>.</li>
        <li><C>condition</C> filters on exact values.</li>
      </List>

      <H2>Following references</H2>
      <Code>{`{
  storeByStoreCode(storeCode: "S001") {
    name
    city { name country { name currency } }   # forwards
  }
  cityByCityCode(cityCode: "STO") {
    stores { nodes { name } }                 # backwards: rows pointing here
  }
}`}</Code>

      <H2>Good to know</H2>
      <List>
        <li>Queries run with your permissions. Data you can't see comes back empty, not as an error.</li>
        <li>Dates are <C>YYYY-MM-DD</C> strings.</li>
        <li>Very deeply nested queries are refused.</li>
        <li>From scripts, send a token: <C>Authorization: Bearer cmn_…</C>.</li>
      </List>
    </>
  );
}
