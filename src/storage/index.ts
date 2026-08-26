export {
  assertRevision,
  AtomicFileStore,
  CanonicalPathLocks,
  RevisionConflictError,
  sha256File,
  type CommitFileRequest,
  type CommitFileResult,
  type CommitBatchFileRequest,
  type CommitBatchFileResult,
  type CommitFileBatchRequest,
  type CommitFileBatchResult,
  type MutationDocumentRef,
} from "./revisions.js";
export { ScratchManager } from "./scratch.js";
export {
  createNativeInputBundle,
  type NativeInputBundle,
  type NativeInputBundleOptions,
} from "./native-input.js";
export {
  SnapshotStore,
  type Snapshot,
  type SnapshotRestore,
} from "./snapshots.js";
export {
  ArtifactStore,
  type Artifact,
  type ArtifactBatch,
  type ArtifactMetadata,
  type ArtifactPublishRequest,
} from "./artifacts.js";
