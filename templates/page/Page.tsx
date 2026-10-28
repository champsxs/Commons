import { Chart, DataTable, Grid, Page, Section, Stat, gql, useCommonsQuery } from "@commons/ui";

// Every query is checked against the live GraphQL schema when the page is built.
const QUERY = gql`
  query StoresOverview {
    allStores(orderBy: STORE_CODE_ASC) {
      totalCount
      nodes {
        storeCode
        name
        floorAreaM2
        city { name country { name } }
      }
    }
  }
`;

interface Data {
  allStores: {
    totalCount: number;
    nodes: { storeCode: string; name: string; floorAreaM2: number | null; city: { name: string; country: { name: string } } }[];
  };
}

export default function StoresOverview() {
  const { data, loading, error, refetch } = useCommonsQuery<Data>(QUERY);
  const stores = data?.allStores.nodes ?? [];
  const totalArea = stores.reduce((sum, s) => sum + (s.floorAreaM2 ?? 0), 0);
  const cities = new Set(stores.map((s) => s.city.name)).size;

  return (
    <Page title="Stores overview" description="A starter page. Ask your coding agent to turn it into what you need.">
      <Grid cols={3}>
        <Stat label="Stores" value={data?.allStores.totalCount} loading={loading} />
        <Stat label="Cities" value={cities} loading={loading} />
        <Stat label="Floor area" value={totalArea} format="integer" hint="m²" loading={loading} />
      </Grid>
      <Section title="Floor area by store">
        <Chart kind="bar" data={stores} x="name" y="floorAreaM2" labels={{ floorAreaM2: "Floor area (m²)" }} loading={loading} />
      </Section>
      <Section title="All stores">
        <DataTable rows={stores} loading={loading} error={error} onRetry={refetch} searchable
          columns={["storeCode", "name", "city.name", "city.country.name", { key: "floorAreaM2", label: "Floor area (m²)", format: "integer" }]} />
      </Section>
    </Page>
  );
}
