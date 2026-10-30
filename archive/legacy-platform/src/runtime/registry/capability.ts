export interface Capability {
  id: string;
  name: string;
  description: string;
  version: string;
  providerModule: string;
  priority: number;
  tags: string[];
  status: "active" | "inactive";
}
