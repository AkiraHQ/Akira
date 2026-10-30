export class PermissionDeniedError extends Error {
  constructor(
    public readonly moduleId: string,
    public readonly permissionId: string,
  ) {
    super(`Module "${moduleId}" denied permission "${permissionId}"`);
    this.name = "PermissionDeniedError";
  }
}

export class PermissionNotFoundError extends Error {
  constructor(public readonly permissionId: string) {
    super(`Permission "${permissionId}" not found in catalog`);
    this.name = "PermissionNotFoundError";
  }
}
