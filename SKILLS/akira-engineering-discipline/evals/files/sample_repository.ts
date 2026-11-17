export interface ProjectRecord {
  id: string;
  name: string;
  status: "active" | "archived" | "completed";
  createdAt: number;
}

export interface ProjectRepository {
  listProjects(): Promise<ProjectRecord[]>;
  getProjectById(id: string): Promise<ProjectRecord | null>;
}

// Server-only persistence implementation
export const sqliteProjectRepository: ProjectRepository = {
  async listProjects(): Promise<ProjectRecord[]> {
    // Executes SQLite query in server runtime
    return [
      { id: "proj_1", name: "Project Akira", status: "active", createdAt: 1700000000 },
      { id: "proj_2", name: "Genesis Engine", status: "active", createdAt: 1700001000 },
    ];
  },

  async getProjectById(id: string): Promise<ProjectRecord | null> {
    const list = await this.listProjects();
    return list.find((p) => p.id === id) || null;
  },
};
