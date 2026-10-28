---
title: GraphQL basics
summary: Query lists and single rows, follow references, and try it in GraphiQL.
group: Reference
order: 80
keywords: query api graphiql filter sort mutation
---

Every dataset you can see is available through one GraphQL API at `{{apiUrl}}/graphql`. Try queries in [GraphiQL]({{apiUrl}}/graphiql), and find each dataset's exact names on its **API** tab or with `commons datasets show <dataset>`.

## Names

| Dataset field | In GraphQL |
|---|---|
| `floor_area_m2` | `floorAreaM2` |
| dataset `stores` | type `Store`, list `allStores`, one row `storeById` |
| key field `store_code` | `storeByStoreCode(storeCode: "S001")` |

## Lists

```graphql
{
  allStores(first: 20, offset: 0, orderBy: [NAME_ASC], condition: { isFlagship: true }) {
    totalCount
    nodes { storeCode name openedOn }
  }
}
```

- `first` / `offset` page through results.
- `orderBy` takes `FIELD_ASC` or `FIELD_DESC`.
- `condition` filters on exact values.

## Following references

```graphql
{
  storeByStoreCode(storeCode: "S001") {
    name
    city { name country { name currency } }   # forwards
  }
  cityByCityCode(cityCode: "STO") {
    stores { nodes { name } }                 # backwards: rows pointing here
  }
}
```

## Good to know

- Queries run with your permissions. Data you can't see comes back empty, not as an error.
- Dates are `YYYY-MM-DD` strings.
- Very deeply nested queries are refused.
- From scripts, send a token: `Authorization: Bearer cmn_…`.
