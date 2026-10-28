import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Card, Dialog, ErrorState, RecordForm, RecordView, runGraphql, useCommons, useDataset } from "@commons/ui";

export function RecordPage() {
  const { slug, id } = useParams() as { slug: string; id: string };
  const { dataset: ds } = useDataset(slug);
  const config = useCommons();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  async function remove() {
    if (!ds?.graphql?.mutations.delete || !confirm("Delete this row?")) return;
    try {
      await runGraphql(config, `mutation($id: UUID!) { ${ds.graphql.mutations.delete}(input: { id: $id }) { clientMutationId } }`, { id });
      navigate(`/datasets/${slug}`);
    } catch (e) {
      setError(e as Error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <Link to={`/datasets/${slug}`} className="text-sm text-muted-foreground hover:text-foreground">← {ds?.name ?? slug}</Link>
      <Card className="mt-4">
        <RecordView key={version} dataset={slug} id={id}
          actions={ds?.canEdit && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={remove}>Delete</Button>
            </div>
          )} />
      </Card>
      {error && <div className="mt-4"><ErrorState error={error} /></div>}
      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit" wide>
        <RecordForm dataset={slug} id={id} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setVersion((v) => v + 1); }} />
      </Dialog>
    </div>
  );
}
