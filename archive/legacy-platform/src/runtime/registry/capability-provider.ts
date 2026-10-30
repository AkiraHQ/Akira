export interface CapabilityProvider {
  moduleId: string;
  priority: number;
  instance?: any; // Bound service implementation instance
}
