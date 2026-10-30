import { Capability } from "./capability";

export interface CapabilityBinding {
  capability: Capability;
  instance: any;
  resolvedAt: Date;
}
