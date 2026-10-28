import { makeSchema } from "postgraphile";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { makePgService } from "postgraphile/adaptors/pg";
import { grafserv } from "postgraphile/grafserv/fastify/v5";
import { defaultMaskError } from "postgraphile/grafserv";
import {
  GraphQLError,
  isListType, isNonNullType, isObjectType, printSchema,
  type GraphQLField, type GraphQLObjectType, type GraphQLSchema, type GraphQLType,
} from "postgraphile/graphql";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.ts";

const pgService = makePgService({ connectionString: config.databaseUrl, schemas: ["data"] });

/** Database errors people can act on, rewritten in plain words. Everything else stays masked. */
const FRIENDLY_PG_ERRORS: Record<string, (e: any) => string> = {
  "23503": (e) =>
    (e.detail ?? "").includes("still referenced") || /^(update or )?delete/.test(e.message)
      ? "This row is still referenced by another dataset, so it can't be removed."
      : "That reference points to a row that doesn't exist.",
  "23505": (e) => `That value already exists. ${e.detail ?? ""}`.trim(),
  "23502": (e) => `A required value is missing (${e.column ?? "field"}).`,
  "42501": () => "You don't have permission to change this dataset.",
  "22P02": () => "A value has the wrong format.",
};

function maskError(error: GraphQLError) {
  const original: any = error.originalError;
  const friendly = original?.code && FRIENDLY_PG_ERRORS[original.code];
  if (friendly) {
    return new GraphQLError(friendly(original), {
      nodes: error.nodes, source: error.source, positions: error.positions, path: error.path,
      extensions: { code: original.code },
    });
  }
  return defaultMaskError(error);
}

/** Keeps a dataset's `id` column named `id` (PostGraphile renames it to `rowId` to leave room for Relay ids). */
const KeepIdPlugin: GraphileConfig.Plugin = {
  name: "CommonsKeepIdPlugin",
  version: "1.0.0",
  inflection: {
    replace: {
      _attributeName(previous, _options, details) {
        return previous!.call(this, { ...details, skipRowId: true });
      },
    },
  },
};

const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  plugins: [KeepIdPlugin],
  // Without the Node interface, a dataset's `id` column stays `id` in GraphQL instead of becoming `rowId`
  disablePlugins: ["NodePlugin"],
  pgServices: [pgService],
  grafserv: { graphqlPath: "/graphql", graphiql: true, graphiqlPath: "/graphiql", watch: false, maskError },
  grafast: {
    explain: false,
    context(requestContext) {
      const req = requestContext.fastifyv5?.request as FastifyRequest | undefined;
      const userId = req?.auth?.userId;
      return {
        pgSettings: {
          role: "commons_user",
          // An empty user id means "nobody": row-level security then only allows company-wide datasets
          "commons.user_id": userId ?? "",
        },
      };
    },
  },
};

let current: GraphQLSchema;
let serv: ReturnType<typeof grafserv> | undefined;
let rebuilding: Promise<void> = Promise.resolve();

export async function buildSchema(): Promise<GraphQLSchema> {
  const result = await makeSchema(preset);
  current = result.schema;
  return current;
}

export async function mountGraphql(app: FastifyInstance) {
  const schema = await buildSchema();
  serv = grafserv({ preset, schema });
  await serv.addTo(app);
}

/** Re-introspects the database after a dataset's table changes. Calls are serialised. */
export function rebuildSchema(): Promise<void> {
  rebuilding = rebuilding.then(async () => {
    const schema = await buildSchema();
    serv?.setSchema(schema);
  });
  return rebuilding;
}

export function getSchema(): GraphQLSchema {
  if (!current) throw new Error("GraphQL schema not built yet");
  return current;
}

export const schemaSDL = () => printSchema(getSchema());

export async function releaseGraphql() {
  await serv?.release();
  await pgService.release?.();
}

// ---- Mapping between datasets and the generated GraphQL names ----

const unwrap = (t: GraphQLType): GraphQLType => (isNonNullType(t) || isListType(t) ? unwrap((t as any).ofType) : t);

export interface GraphqlNames {
  type: string;
  listField: string | null;
  /** Enum for sorting the list, e.g. StoreOrderBy */
  orderBy: string | null;
  byIdField: string | null;
  fields: Record<string, string>;
  /** Back-relations: other datasets' rows pointing here */
  related: { field: string; type: string }[];
  /** Input field names for create/update, keyed by dataset field (references use the id column, e.g. cityId) */
  inputs: Record<string, string>;
  mutations: { create: string | null; update: string | null; delete: string | null; inputField: string | null; patchField: string | null };
}

/** Finds what PostGraphile called things for a dataset, so the UI and agents don't have to guess. */
export function graphqlNames(typeName: string, columns: { name: string; column: string; reference: boolean }[]): GraphqlNames | null {
  const schema = getSchema();
  const type = schema.getType(typeName) as GraphQLObjectType | undefined;
  if (!type || !isObjectType(type)) return null;
  const query = schema.getQueryType()!.getFields();
  const typeFields = type.getFields();

  let listField: string | null = null;
  let byIdField: string | null = null;
  for (const [name, f] of Object.entries(query) as [string, GraphQLField<any, any>][]) {
    const t = unwrap(f.type);
    if (isObjectType(t) && t.name.endsWith("Connection")) {
      const nodes = t.getFields().nodes;
      if (nodes && unwrap(nodes.type) === type && name.startsWith("all")) listField = name;
    }
    if (t === type && f.args.length === 1 && f.args[0].name === "id") byIdField = name;
  }

  const fields: Record<string, string> = {};
  const lower = (s: string) => s.replace(/_/g, "").toLowerCase();
  for (const c of columns) {
    const want = c.reference ? c.name : c.column;
    const match = Object.keys(typeFields).find((k) => lower(k) === lower(want));
    if (match) fields[c.name] = match;
  }

  const related: GraphqlNames["related"] = [];
  for (const [name, f] of Object.entries(typeFields)) {
    const t = unwrap(f.type);
    if (isObjectType(t) && t.name.endsWith("Connection")) {
      const node = unwrap(t.getFields().nodes?.type);
      if (node && isObjectType(node)) related.push({ field: name, type: node.name });
    }
  }
  const mutationFields = schema.getMutationType()?.getFields() ?? {};
  const find = (name: string) => (mutationFields[name] ? name : null);
  const create = find(`create${typeName}`);
  const update = find(`update${typeName}ById`);
  const del = find(`delete${typeName}ById`);
  const inputObj = (m: string | null) => {
    const arg = m ? mutationFields[m].args.find((a) => a.name === "input") : undefined;
    const t = arg ? unwrap(arg.type) : undefined;
    return t && "getFields" in t ? Object.keys((t as any).getFields()) : [];
  };
  const inputField = inputObj(create).find((k) => k !== "clientMutationId") ?? null;
  const patchField = inputObj(update).find((k) => k.endsWith("Patch")) ?? null;
  const inputs: Record<string, string> = {};
  for (const c of columns) {
    const match = Object.keys(typeFields).find((k) => lower(k) === lower(c.column));
    if (match) inputs[c.name] = match;
  }
  const orderArg = listField ? query[listField].args.find((a) => a.name === "orderBy") : undefined;
  const orderBy = orderArg ? (unwrap(orderArg.type) as any).name : null;
  return { type: typeName, listField, orderBy, byIdField, fields, related, inputs, mutations: { create, update, delete: del, inputField, patchField } };
}
