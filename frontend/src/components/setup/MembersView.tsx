"use client";

import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAction, useQuery } from "@/lib/api/hooks";
import type { Member, Role } from "@/lib/api/types";
import { formatDateTime } from "@/lib/status";
import { MANAGER_ONLY, useProject } from "@/components/project/ProjectContext";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { SelectField, TextField } from "@/components/ui/Field";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/States";

const ROLES: { value: Role; label: string }[] = [
  { value: "PM", label: "PM: manages the project and approves publishing" },
  { value: "PL", label: "PL: manages the project and approves publishing" },
  { value: "DEV", label: "DEV: creates tasks and starts runs" },
];

function AddMemberDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const { project } = useProject();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("DEV");
  const add = useAction(async () => {
    await api<Member>("POST", `/projects/${encodeURIComponent(project.id)}/members`, { body: { userId: userId.trim(), role } });
    setUserId("");
    onAdded();
  });
  return (
    <Dialog open={open} onClose={onClose} title="Add a member">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void add.run();
        }}
      >
        <TextField label="User" value={userId} onChange={(event) => setUserId(event.target.value)} required autoFocus hint="The user's id in this platform." />
        <SelectField label="Role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <InlineError>{add.error}</InlineError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={add.pending} disabled={userId.trim() === ""}>
            Add member
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MemberRow({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const { project, canManage } = useProject();
  const url = `/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(member.userId)}`;
  const change = useAction(async (role: Role) => {
    await api<Member>("PATCH", url, { body: { role } });
    onChanged();
  });
  const remove = useAction(async () => {
    await api<void>("DELETE", url);
    onChanged();
  });
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 font-medium break-all">{member.userId}</span>
        <span className="text-sm text-muted">Added {formatDateTime(member.addedAt)}</span>
        {canManage ? (
          <>
            <select
              aria-label={`Role of ${member.userId}`}
              value={member.role}
              disabled={change.pending}
              onChange={(event) => void change.run(event.target.value as Role)}
              className="h-8 rounded-lg border border-border bg-surface px-2 text-sm"
            >
              {ROLES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}
                </option>
              ))}
            </select>
            <Button size="sm" variant="danger" loading={remove.pending} onClick={() => void remove.run()} aria-label={`Remove ${member.userId}`}>
              <Trash2 aria-hidden className="size-3.5" />
              Remove
            </Button>
          </>
        ) : (
          <Badge tone={member.role === "DEV" ? "neutral" : "info"}>{member.role}</Badge>
        )}
      </div>
      <InlineError>{change.error ?? remove.error}</InlineError>
    </li>
  );
}

export function MembersView() {
  const { project, canManage } = useProject();
  const members = useQuery(`members:${project.id}`, (signal) => api<Member[]>("GET", `/projects/${encodeURIComponent(project.id)}/members`, { signal }));
  const [adding, setAdding] = useState(false);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="members-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="members-title" className="text-lg font-semibold">
            Members
          </h2>
          <p className="text-sm text-muted">The role decides who can change the setup, approve publishing and start runs.</p>
        </div>
        <Button variant="primary" disabled={!canManage} title={canManage ? undefined : MANAGER_ONLY} onClick={() => setAdding(true)}>
          <UserPlus aria-hidden className="size-4" />
          Add member
        </Button>
      </div>
      {members.error !== undefined && !members.data ? (
        <ErrorState error={members.error} onRetry={() => void members.refresh()} title="Could not load the members" />
      ) : !members.data ? (
        <Skeleton className="h-32" />
      ) : members.data.length === 0 ? (
        <EmptyState title="No members" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {members.data.map((member) => (
              <MemberRow key={member.userId} member={member} onChanged={() => void members.refresh()} />
            ))}
          </ul>
        </Card>
      )}
      <AddMemberDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void members.refresh();
        }}
      />
    </section>
  );
}
