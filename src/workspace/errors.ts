export class WorkspacePathError extends Error {
  public constructor(
    public readonly code:
      | "PATH_INVALID"
      | "PATH_OUTSIDE_WORKSPACE"
      | "PATH_NOT_FOUND"
      | "WORKSPACE_UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "WorkspacePathError";
  }
}
