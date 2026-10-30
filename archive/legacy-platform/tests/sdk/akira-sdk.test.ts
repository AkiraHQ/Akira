import { describe, test, expect } from "vitest";
import { AkiraSDK } from "../../src/sdk/core/akira-sdk";
import { SDKContext } from "../../src/sdk/core/sdk-context";
import { PermissionRequiredError, SDKVersionMismatchError } from "../../src/sdk/core/sdk-errors";

// Simple mock services
class MockPermissionManager {
  required: string[] = [];
  require(permission: string) {
    this.required.push(permission);
  }
}

class MockService {
  called: any[] = [];
  async read(...args: any[]) {
    this.called.push({ method: "read", args });
    if (args[0] === "mkey") return "mem-mkey";
    return "read-result";
  }
  async write(...args: any[]) {
    this.called.push({ method: "write", args });
    return "write-result";
  }
  async get(key: string) {
    this.called.push({ method: "get", key });
    return `value-of-${key}`;
  }
  async set(key: string, value: any) {
    this.called.push({ method: "set", key, value });
  }
  async delete(key: string) {
    this.called.push({ method: "delete", key });
  }
  async append(event: any) {
    this.called.push({ method: "append", event });
  }
  async query(...args: any[]) {
    this.called.push({ method: "query", args });
    if (args[0] === "term") return "search-result";
    return "query-result";
  }
  async track(name: string, payload?: any) {
    this.called.push({ method: "track", name, payload });
  }
  async readMemory(key: string) {
    this.called.push({ method: "readMemory", key });
    return `mem-${key}`;
  }
  async writeMemory(key: string, value: any) {
    this.called.push({ method: "writeMemory", key, value });
  }
  async search(...args: any[]) {
    this.called.push({ method: "search", args });
    return "search-result";
  }
  async send(...args: any[]) {
    this.called.push({ method: "send", args });
    return "send-result";
  }
  async publish(eventName: string, payload?: any) {
    this.called.push({ method: "publish", eventName, payload });
  }
  async subscribe(eventName: string, handler: any) {
    this.called.push({ method: "subscribe", eventName });
    return { unsubscribe: () => {} };
  }
}

function createMockContext(version = "1.0.0"): SDKContext {
  const mock = new MockService();
  return {
    runtimeVersion: version,
    workspace: mock,
    storage: mock,
    timeline: mock,
    analytics: mock,
    memory: mock,
    search: mock,
    notifications: mock,
    events: mock,
    permissions: new MockPermissionManager() as any,
  } as SDKContext;
}

describe("AkiraSDK", () => {
  test("initializes with matching version", () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    expect(sdk).toBeDefined();
    expect(sdk.workspace).toBeDefined();
  });

  test("throws on version mismatch", () => {
    const ctx = createMockContext("0.9.0");
    expect(() => new AkiraSDK(ctx)).toThrow(SDKVersionMismatchError);
  });

  test("workspace wrapper enforces permission and delegates", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    const result = await sdk.workspace.read("file.txt");
    expect(result).toBe("read-result");
    expect((ctx.permissions as any).required).toContain("workspace.read");
  });

  test("storage get enforces permission and returns value", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    const val = await sdk.storage.get("key1");
    expect(val).toBe("value-of-key1");
    expect((ctx.permissions as any).required).toContain("storage.read");
  });

  test("timeline append permission check", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    await sdk.timeline.append({ type: "event" });
    expect((ctx.permissions as any).required).toContain("timeline.append");
  });

  test("analytics track permission check", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    await sdk.analytics.track("click", { id: 1 });
    expect((ctx.permissions as any).required).toContain("analytics.track");
  });

  test("memory read/write permission checks", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    const read = await sdk.memory.read("mkey");
    expect(read).toBe("mem-mkey");
    await sdk.memory.write("mkey", "val");
    expect((ctx.permissions as any).required).toContain("memory.read");
    expect((ctx.permissions as any).required).toContain("memory.write");
  });

  test("search query permission check", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    const res = await sdk.search.query("term");
    expect(res).toBe("search-result");
    expect((ctx.permissions as any).required).toContain("search.query");
  });

  test("notification send permission check", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    const res = await sdk.notifications.send("msg");
    expect(res).toBe("send-result");
    expect((ctx.permissions as any).required).toContain("notifications.send");
  });

  test("event publish/subscribe permission checks", async () => {
    const ctx = createMockContext();
    const sdk = new AkiraSDK(ctx);
    await sdk.events.publish("test", {});
    const sub = await sdk.events.subscribe("test", () => {});
    expect((ctx.permissions as any).required).toContain("events.publish");
    expect((ctx.permissions as any).required).toContain("events.subscribe");
    expect(sub).toBeDefined();
  });
});
