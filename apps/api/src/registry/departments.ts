import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, tx } from "../db/pool.ts";
import { requireAuth } from "../auth/auth.ts";
import { HttpError, conflict, forbidden, notFound } from "../util/errors.ts";

const DepartmentInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9-]{1,60}$/, "Use lowercase letters, digits and dashes"),
  name: z.string().min(1).max(80),
  teamIds: z.array(z.string().uuid()).default([]),
  userIds: z.array(z.string().uuid()).default([]),
});

async function requireAdmin(userId: string) {
  const { rows } = await pool.query("select is_admin from commons.users where id = $1", [userId]);
  if (!rows[0]?.is_admin) throw forbidden("Only admins can manage departments");
}

/** Departments the person is in, directly or through a team. */
export async function departmentsOf(userId: string) {
  const { rows } = await pool.query(
    `select d.id, d.slug, d.name from commons.departments d where commons.in_department(d.id, $1) order by d.name`,
    [userId],
  );
  return rows;
}

async function listDepartments(userId: string) {
  const { rows } = await pool.query(
    `select d.id, d.slug, d.name, commons.in_department(d.id, $1) as mine,
       coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name)
                 from commons.department_teams dt join commons.teams t on t.id = dt.team_id where dt.department_id = d.id), '[]') as teams,
       coalesce((select json_agg(json_build_object('id', u.id, 'name', u.name) order by u.name)
                 from commons.department_members dm join commons.users u on u.id = dm.user_id where dm.department_id = d.id), '[]') as members,
       (select count(distinct u) from (
          select user_id as u from commons.department_members where department_id = d.id
          union select m.user_id from commons.department_teams dt join commons.team_members m on m.team_id = dt.team_id where dt.department_id = d.id
        ) x)::int as people,
       (select count(*) from commons.datasets where department_id = d.id)::int as datasets,
       (select count(*) from commons.pages where department_id = d.id)::int as pages
     from commons.departments d order by d.name`,
    [userId],
  );
  return rows;
}

async function saveMembership(db: any, id: string, teamIds: string[], userIds: string[]) {
  await db.query("delete from commons.department_teams where department_id = $1", [id]);
  await db.query("delete from commons.department_members where department_id = $1", [id]);
  for (const t of teamIds) await db.query("insert into commons.department_teams values ($1, $2)", [id, t]);
  for (const u of userIds) await db.query("insert into commons.department_members values ($1, $2)", [id, u]);
}

export function registerDepartmentRoutes(app: FastifyInstance) {
  app.get("/api/departments", async (req) => listDepartments(requireAuth(req).userId));

  app.post("/api/departments", async (req, reply) => {
    const a = requireAuth(req);
    await requireAdmin(a.userId);
    const input = DepartmentInput.parse(req.body);
    await tx(async (db) => {
      const { rows } = await db.query("insert into commons.departments (slug, name) values ($1, $2) on conflict (slug) do nothing returning id", [input.slug, input.name]);
      if (!rows[0]) throw conflict(`A department called "${input.slug}" already exists`);
      await saveMembership(db, rows[0].id, input.teamIds, input.userIds);
      await db.query("insert into commons.audit_log (user_id, action, detail) values ($1, 'department.create', $2)", [a.userId, { slug: input.slug }]);
    });
    reply.status(201);
    return (await listDepartments(a.userId)).find((d: any) => d.slug === input.slug);
  });

  /** Rename, and/or replace its teams and people. */
  app.patch("/api/departments/:id", async (req) => {
    const a = requireAuth(req);
    await requireAdmin(a.userId);
    const { id } = req.params as { id: string };
    // No defaults here: a field left out of the request must stay as it is
    const patch = z.object({
      name: z.string().min(1).max(80).optional(),
      teamIds: z.array(z.string().uuid()).optional(),
      userIds: z.array(z.string().uuid()).optional(),
    }).parse(req.body);
    await tx(async (db) => {
      const { rowCount } = await db.query("update commons.departments set name = coalesce($2, name) where id = $1", [id, patch.name ?? null]);
      if (!rowCount) throw notFound("No such department");
      if (patch.teamIds || patch.userIds) {
        const current = (await db.query(
          `select coalesce(array_agg(team_id) filter (where team_id is not null), '{}') as teams from commons.department_teams where department_id = $1`, [id])).rows[0].teams;
        const people = (await db.query(
          `select coalesce(array_agg(user_id), '{}') as users from commons.department_members where department_id = $1`, [id])).rows[0].users;
        await saveMembership(db, id, patch.teamIds ?? current, patch.userIds ?? people);
      }
      await db.query("insert into commons.audit_log (user_id, action, detail) values ($1, 'department.update', $2)", [a.userId, { id, ...patch }]);
    });
    return (await listDepartments(a.userId)).find((d: any) => d.id === id);
  });

  app.delete("/api/departments/:id", async (req) => {
    const a = requireAuth(req);
    await requireAdmin(a.userId);
    const { id } = req.params as { id: string };
    try {
      await pool.query("delete from commons.departments where id = $1", [id]);
    } catch (e: any) {
      if (e.code === "23503") throw new HttpError(409, "Datasets or pages are still open to this department. Change their visibility first.");
      throw e;
    }
    return { ok: true };
  });
}
