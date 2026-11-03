import { useState, type FormEvent } from "react";

import type { ProjectDto, UserDto } from "@codelens/shared";

interface ProjectsPanelProps {
  user: UserDto | null;
  projects: ProjectDto[];
  activeProjectId: string | null;
  dirty: boolean;
  onSelect: (project: ProjectDto) => void;
  onCreate: (name: string) => Promise<void>;
  onDelete: (project: ProjectDto) => void;
  onSave: () => void;
}

export function ProjectsPanel({
  user,
  projects,
  activeProjectId,
  dirty,
  onSelect,
  onCreate,
  onDelete,
  onSave,
}: ProjectsPanelProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      await onCreate(trimmed);
      setName("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <div className="sidebar-section">
        <h3>Projects</h3>
        <p className="muted">Sign in to save and reopen projects.</p>
      </div>
    );
  }

  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">
        <h3>Projects</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating((value) => !value)}>
          + New
        </button>
      </div>

      {creating && (
        <form className="project-create" onSubmit={submit}>
          <input
            type="text"
            value={name}
            placeholder="Project name"
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "…" : "Create"}
          </button>
        </form>
      )}

      <ul className="project-list">
        {projects.map((project) => (
          <li
            key={project.id}
            className={`project-item${project.id === activeProjectId ? " is-active" : ""}`}
          >
            <button type="button" className="project-open" onClick={() => onSelect(project)}>
              <span className="project-name">{project.name}</span>
              <span className="project-date">
                {new Date(project.updatedAt).toLocaleDateString()}
              </span>
            </button>
            <button
              type="button"
              className="project-delete"
              title="Delete project"
              onClick={() => onDelete(project)}
            >
              ×
            </button>
          </li>
        ))}
        {projects.length === 0 && <li className="muted project-empty">No projects yet.</li>}
      </ul>

      <button
        type="button"
        className="btn btn-secondary btn-block"
        onClick={onSave}
        disabled={!activeProjectId}
        title={activeProjectId ? undefined : "Select a project first"}
      >
        {dirty ? "Save changes *" : "Save"}
      </button>
    </div>
  );
}
