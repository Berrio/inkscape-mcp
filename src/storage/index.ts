export {
  assertRevision,
  AtomicFileStore,
  CanonicalPathLocks,
  RevisionConflictError,
  sha256File,
  type CommitFileRequest,
  type CommitFileResult,
  type MutationDocumentRef,
} from "./revisions.js";
export { ScratchManager } from "./scratch.js";
export {
  createNativeInputBundle,
  type NativeInputBundle,
} from "./native-input.js";
export { SnapshotStore, type Snapshot } from "./snapshots.js";
export { ArtifactStore, type Artifact } from "./artifacts.js";
