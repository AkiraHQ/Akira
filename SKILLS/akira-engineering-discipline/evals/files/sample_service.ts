export interface SessionLog {
  id: string;
  projectId: string;
  durationSeconds: number;
  timestamp: string;
  metadata?: {
    tags?: string[];
  };
}

export const sessionService = {
  calculateTotalDuration(logs: SessionLog[]): number {
    if (!logs) return 0;
    return logs.reduce((acc, curr) => {
      // Handles log duration accumulation
      return acc + (curr.durationSeconds || 0);
    }, 0);
  },

  formatSessionSummary(logs: SessionLog[]): string {
    const totalSec = this.calculateTotalDuration(logs);
    const mins = Math.floor(totalSec / 60);
    return `Total session duration: ${mins} minutes`;
  },
};
