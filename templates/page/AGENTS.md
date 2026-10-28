# Commons page

This folder is one Commons page: a React component that shows company data from the Commons GraphQL API.
The page is built and served by Commons, not locally. You write the source; `commons pages push` uploads it,
and the server checks, builds and hosts it.

## Workflow

1. Look at the data first:
   - `commons datasets` lists datasets; `commons datasets show <slug>` shows fields and their GraphQL names.
   - `.commons/schema.graphql` is the full GraphQL schema (refresh with `commons schema`).
   - `commons query '<graphql>'` runs a query as the signed-in user and prints the result. Check the real
     data's shape, empty values and ranges before building on it.
2. Edit `Page.tsx` (default export = the page component). Split into more `.tsx` files if it gets long.
3. Run `npx tsc --noEmit` if dependencies are installed (`npm install`), to catch type errors early.
4. Run `commons pages push -m "what changed"`. It prints build errors with file and line; fix and push again.
   Add `--publish` once it's right; until then pushes are previews, shown at the printed URL.

## Rules the build enforces

- Import only from `react`, `@commons/ui` and this folder's own files. No npm packages.
- Get data only with `useCommonsQuery` / `useCommonsMutation` from `@commons/ui`.
  `fetch`, `XMLHttpRequest`, `WebSocket`, `localStorage`, `eval` and dynamic `import()` are rejected.
- Write queries as `gql` template literals with no `${...}` inside, so they can be checked against the schema.
  Pass values as GraphQL variables instead.
- TypeScript must typecheck in strict mode.
- Pages are read-only unless the page owner turns on "Allow this page to change data". Mutations fail otherwise.

## @commons/ui

Types are in `.commons/types/`. The main pieces:

- Layout: `Page`, `Section`, `Grid` (cols 1-6), `Stat` (label, value, format, delta, hint), `Card`, `Tabs`, `Badge`.
- Data: `DataTable` (rows, columns as paths like `"city.name"` or `{ key, label, format, render }`, searchable),
  `DatasetTable` (a whole dataset, paged on the server), `Chart` (Apache ECharts: kind bar | line | area | pie |
  donut | scatter, `x`, `y`, optional `seriesBy`, `stacked`, `horizontal`, `format`, and `option` for raw ECharts options).
- Records: `RecordView`, `RecordForm`, `RefPicker`, `RecordLink`, `FilterBar`.
- Hooks: `useCommonsQuery(query, variables)` returns `{ data, loading, error, refetch }`; `useCommonsMutation`; `useFilters`.
- Helpers: `formatValue(v, format)`, `groupBy(rows, key, value, "sum" | "count" | "avg")`, `get(obj, "a.b")`.
- Formats: number, integer, currency, percent, compact, date, month, datetime, boolean, text.

Style with Tailwind classes using the design tokens (`bg-surface`, `text-muted-foreground`, `border-border`,
`text-primary`...) so pages match Commons in light and dark mode. Prefer the components over custom markup.

## GraphQL conventions

- Lists: `allStores(first, offset, orderBy: [STORE_CODE_ASC], condition: { isFlagship: true }) { totalCount nodes { ... } }`
- One row: `storeById(id:)`, or by a unique key: `storeByStoreCode(storeCode: "S001")`.
- References are objects: `store { city { name country { name } } }`. Back-references are lists: `city { stores { nodes { name } } }`.
- Field names are camelCase versions of dataset fields (`floor_area_m2` -> `floorAreaM2`).
- Dates come back as `YYYY-MM-DD` strings; numbers as numbers.
