import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { constants, existsSync, statSync } from "node:fs";
import {
  access as fsAccess,
  open as fsOpen,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fileTypeFromBuffer } from "file-type";

import type { OperationBundle, OperationClassification, OperationIO, OperationKind } from "./operation-types.js";
import { OperationRecorder, type OperationScope } from "./operation-recorder.js";

/** The structural part of a Pi AgentTool needed by the live bridge. */
export interface PiToolLike {
  readonly name: string;
  readonly execute: (...args: any[]) => any;
}

/** Filesystem operations accepted by Pi's read tool. */
export interface PiReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

/** Filesystem operations accepted by Pi's edit tool. */
export interface PiEditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

/** Filesystem operations accepted by Pi's write tool. */
export interface PiWriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

/** Filesystem operations accepted by Pi's ls tool. */
export interface PiLsOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }> | { isDirectory: () => boolean };
  readdir: (absolutePath: string) => Promise<string[]> | string[];
}

export interface PiOperationBridgeOptions {
  /** The working directory is useful to callers constructing Pi tools; the bridge itself receives absolute paths from Pi. */
  cwd?: string;
  /** A caller-controlled key makes resource identities deterministic across bridge instances. */
  resource_key?: string | Uint8Array;
  /** Explicitly safe labels keyed by exact tool name or by `file`, `directory`, and `tool`. */
  safe_labels?: Readonly<Record<string, string>>;
}

export interface PiOperationBridge {
  /** Wrap a Pi tool without changing its arguments, receiver, signal, updates, result, or workload error. */
  wrapTool<T extends PiToolLike>(tool: T): T;
  readonly readOperations: PiReadOperations;
  readonly editOperations: PiEditOperations;
  readonly writeOperations: PiWriteOperations;
  readonly lsOperations: PiLsOperations;
  /** Return the recorder snapshot plus any explicitly visible capture limitations. */
  snapshot(): OperationBundle;
}

interface ToolSemantic {
  kind: OperationKind;
  label: string;
  resourceKind: "file" | "directory" | null;
}

interface ToolCaptureContext {
  readonly semantic: ToolSemantic;
  readonly resourceId: string | null;
  readonly resourceLabel: string | null;
  readonly requestedRange: OperationIO["requested_range"];
  readonly beforeByResource: Map<string, Buffer>;
}

const EXACT_BUILTINS: Readonly<Record<string, ToolSemantic>> = {
  read: { kind: "file_read", label: "read", resourceKind: "file" },
  edit: { kind: "file_write", label: "edit", resourceKind: "file" },
  write: { kind: "file_write", label: "write", resourceKind: "file" },
  ls: { kind: "directory_read", label: "ls", resourceKind: "directory" },
};

const DEFAULT_CAPTURE_METHOD = "pi-operation-bridge";
const TOOL_RESULT_METHOD = "pi.tool.result.text-utf8-byte-length";
const READ_BYTES_METHOD = "pi.operations.readFile.buffer-byte-length";
const WRITE_BYTES_METHOD = "pi.operations.writeFile.buffer-byte-length";
const DIRECTORY_ENTRIES_METHOD = "pi.operations.readdir.entry-array-length";
const EDIT_DIFF_METHOD = "common-prefix-suffix-byte-splice";
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const FILE_TYPE_SNIFF_BYTES = 4100;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function pathIdentity(path: string | URL): string {
  if (path instanceof URL) {
    try { return fileURLToPath(path); }
    catch { return path.href; }
  }
  return path;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function quantity(value: number): string {
  return String(value);
}

function classification(evidence: OperationClassification["evidence"], method: string): OperationClassification {
  return { evidence, method };
}

function rangeFromReadArgs(args: unknown): OperationIO["requested_range"] {
  if (args === null || typeof args !== "object") return null;
  const value = args as { offset?: unknown; limit?: unknown };
  const offset = value.offset;
  const limit = value.limit;
  if (offset === undefined && limit === undefined) return null;
  if (offset !== undefined && (!Number.isSafeInteger(offset) || (offset as number) < 1)) return null;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) < 1)) return null;
  const start = offset === undefined ? 1 : offset as number;
  const end = limit === undefined ? null : start + (limit as number) - 1;
  if (end !== null && !Number.isSafeInteger(end)) return null;
  return { start_line: start, end_line: end };
}

function toolPath(args: unknown): string | null {
  if (args === null || typeof args !== "object") return null;
  try {
    const value = args as { path?: unknown };
    return typeof value.path === "string" && value.path.length > 0 ? value.path : null;
  } catch {
    return null;
  }
}

function textOutputBytes(result: unknown): number | null {
  if (result === null || typeof result !== "object") return null;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  let total = 0;
  for (const block of content) {
    if (block === null || typeof block !== "object" || (block as { type?: unknown }).type !== "text") return null;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") return null;
    total += Buffer.byteLength(text, "utf8");
  }
  return total;
}

function byteSplice(before: Buffer, after: Buffer): { inserted: number; deleted: number } {
  let prefix = 0;
  const commonLength = Math.min(before.byteLength, after.byteLength);
  while (prefix < commonLength && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.byteLength - prefix &&
    suffix < after.byteLength - prefix &&
    before[before.byteLength - suffix - 1] === after[after.byteLength - suffix - 1]
  ) suffix += 1;

  return {
    inserted: after.byteLength - prefix - suffix,
    deleted: before.byteLength - prefix - suffix,
  };
}

/** Match Pi 0.67.2's supported-image detector exactly. */
async function imageMimeType(absolutePath: string): Promise<string | null> {
  const handle = await fsOpen(absolutePath, "r");
  try {
    const probe = Buffer.alloc(FILE_TYPE_SNIFF_BYTES);
    const { bytesRead } = await handle.read(probe, 0, probe.byteLength, 0);
    if (bytesRead === 0) return null;
    const fileType = await fileTypeFromBuffer(probe.subarray(0, bytesRead));
    return fileType !== undefined && IMAGE_MIME_TYPES.has(fileType.mime) ? fileType.mime : null;
  } finally {
    await handle.close();
  }
}

class PiOperationBridgeImpl implements PiOperationBridge {
  readonly readOperations: PiReadOperations;
  readonly editOperations: PiEditOperations;
  readonly writeOperations: PiWriteOperations;
  readonly lsOperations: PiLsOperations;

  private readonly recorder: OperationRecorder;
  private readonly resourceKey: Buffer;
  private readonly safeLabels: Readonly<Record<string, string>>;
  private readonly toolStorage = new AsyncLocalStorage<ToolCaptureContext>();
  private readonly captureFailures = new Set<string>();
  private imageDetectionCalls = 0;

  constructor(recorder: OperationRecorder, options: PiOperationBridgeOptions = {}) {
    if (!(recorder instanceof OperationRecorder)) throw new TypeError("recorder must be an OperationRecorder");
    this.recorder = recorder;
    this.resourceKey = options.resource_key === undefined ? randomBytes(32) : Buffer.from(options.resource_key);
    if (this.resourceKey.byteLength === 0) throw new TypeError("resource_key must not be empty");
    const labels = options.safe_labels ?? {};
    for (const [key, label] of Object.entries(labels)) assertNonEmpty(label, `safe_labels.${key}`);
    this.safeLabels = clone(labels);

    this.readOperations = {
      readFile: (absolutePath) => this.captureRead(absolutePath),
      access: (absolutePath) => this.captureProbe("access", absolutePath, "file", () => fsAccess(absolutePath, constants.R_OK)),
      detectImageMimeType: (absolutePath) => {
        this.imageDetectionCalls += 1;
        return imageMimeType(absolutePath);
      },
    };
    this.editOperations = {
      readFile: (absolutePath) => this.captureRead(absolutePath),
      writeFile: (absolutePath, content) => this.captureWrite(absolutePath, content),
      access: (absolutePath) => this.captureProbe("access", absolutePath, "file", () => fsAccess(absolutePath, constants.R_OK | constants.W_OK)),
    };
    this.writeOperations = {
      writeFile: (absolutePath, content) => this.captureWrite(absolutePath, content),
      mkdir: (dir) => this.captureProbe("mkdir", dir, "directory", async () => { await fsMkdir(dir, { recursive: true }); }),
    };
    this.lsOperations = {
      exists: (absolutePath) => this.captureProbe("exists", absolutePath, null, () => existsSync(absolutePath)),
      stat: (absolutePath) => this.captureProbe("stat", absolutePath, null, () => statSync(absolutePath)),
      readdir: (absolutePath) => this.captureDirectoryRead(absolutePath),
    };
  }

  wrapTool<T extends PiToolLike>(tool: T): T {
    if (tool === null || (typeof tool !== "object" && typeof tool !== "function")) {
      throw new TypeError("tool must be an object");
    }
    if (typeof tool.name !== "string" || tool.name.length === 0) throw new TypeError("tool.name must be a non-empty string");
    if (typeof tool.execute !== "function") throw new TypeError("tool.execute must be a function");

    const originalExecute = tool.execute;
    const knownBuiltin = Object.prototype.hasOwnProperty.call(EXACT_BUILTINS, tool.name);
    const semantic: ToolSemantic = knownBuiltin
      ? EXACT_BUILTINS[tool.name]!
      : { kind: "tool", label: "tool", resourceKind: null };
    const bridge = this;
    let wrappedTool!: T;
    const execute = function(this: unknown, ...args: any[]): any {
      const receiver = this === wrappedTool ? tool : this;
      const context = bridge.makeToolContext(semantic, args[1]);
      const spec = {
        kind: semantic.kind,
        label: bridge.toolLabel(tool.name, semantic),
        classification: classification("observed", `${DEFAULT_CAPTURE_METHOD}.${knownBuiltin ? "exact-tool-name" : "tool-name"}`),
      } as const;
      return bridge.recorder.run(spec, async (scope) => {
        bridge.setToolStart(scope, context);
        return bridge.toolStorage.run(context, async () => {
          // The bridge never catches or rewrites a workload failure. The
          // recorder rethrows this exact value after closing the operation.
          const result = await Reflect.apply(originalExecute, receiver, args);
          bridge.setToolResult(scope, result);
          return result;
        });
      });
    };

    wrappedTool = new Proxy(tool, {
      get(target, property, receiver) {
        if (property === "execute") return execute;
        return Reflect.get(target, property, receiver);
      },
    });
    return wrappedTool;
  }

  snapshot(): OperationBundle {
    const bundle = this.recorder.snapshot();
    const bridgeLimitations = [...this.captureFailures];
    if (this.imageDetectionCalls > 0) {
      bridgeLimitations.push("Pi image MIME detection probes are outside captured readFile byte measurements");
    }
    if (bridgeLimitations.length === 0) return bundle;
    const limitations = [...bundle.coverage.limitations, ...bridgeLimitations].filter((value, index, all) => all.indexOf(value) === index);
    return clone({
      ...bundle,
      coverage: {
        ...bundle.coverage,
        complete: false,
        limitations,
      },
    });
  }

  private makeToolContext(semantic: ToolSemantic, args: unknown): ToolCaptureContext {
    let path: string | null = null;
    try { path = semantic.resourceKind === null ? null : toolPath(args); }
    catch { this.noteCaptureFailure("Pi tool resource metadata capture failed"); }
    let resourceId: string | null = null;
    if (path !== null) {
      try { resourceId = this.resourceId(path); }
      catch { this.noteCaptureFailure("Pi tool resource identity capture failed"); }
    }
    let requestedRange: OperationIO["requested_range"] = null;
    try {
      requestedRange = semantic.label === "read" ? rangeFromReadArgs(args) : null;
    } catch {
      this.noteCaptureFailure("Pi tool range metadata capture failed");
    }
    return {
      semantic,
      resourceId,
      resourceLabel: resourceId === null || semantic.resourceKind === null ? null : this.resourceLabel(semantic.resourceKind, resourceId),
      requestedRange,
      beforeByResource: new Map(),
    };
  }

  private setToolStart(scope: OperationScope, context: ToolCaptureContext): void {
    if (context.resourceId === null || context.resourceLabel === null) return;
    try {
      scope.setIO({
        resource_id: context.resourceId,
        resource_label: context.resourceLabel,
        requested_range: context.requestedRange,
      });
    } catch {
      this.noteCaptureFailure("Pi tool metadata capture failed");
    }
  }

  private setToolResult(scope: OperationScope, result: unknown): void {
    let returned: number | null;
    try { returned = textOutputBytes(result); }
    catch {
      this.noteCaptureFailure("Pi tool result metadata capture failed");
      return;
    }
    if (returned === null) return;
    try {
      scope.setIO({
        measurements: { returned_bytes: classification("derived", TOOL_RESULT_METHOD) },
        returned_bytes: quantity(returned),
      });
    } catch {
      this.noteCaptureFailure("Pi tool result metadata capture failed");
    }
  }

  private captureRead(absolutePath: string): Promise<Buffer> {
    let identity: string | null = null;
    try { identity = this.resourceId(absolutePath); }
    catch { this.noteCaptureFailure("Pi file-read resource identity capture failed"); }
    const context = this.toolStorage.getStore();
    const requestedRange = context?.requestedRange ?? null;
    const label = context?.semantic.label === "edit" ? "edit" : context?.semantic.label === "read" ? "read" : "file_read";
    return this.recorder.run({ kind: "file_read", label }, async (scope) => {
      try {
        scope.setIO({
          ...(identity === null ? {} : { resource_id: identity, resource_label: this.resourceLabel("file", identity) }),
          requested_range: requestedRange,
        });
      } catch {
        this.noteCaptureFailure("Pi file-read metadata capture failed");
      }
      const raw = await fsReadFile(absolutePath);
      if (context !== undefined && identity !== null) context.beforeByResource.set(identity, Buffer.from(raw));
      try {
        scope.setIO({
          measurements: {
            read_bytes: classification("observed", READ_BYTES_METHOD),
            returned_bytes: classification("observed", READ_BYTES_METHOD),
            content_sha256: classification("derived", "sha256-of-backing-bytes"),
          },
          read_bytes: quantity(raw.byteLength),
          returned_bytes: quantity(raw.byteLength),
          content_sha256: sha256(raw),
        });
      } catch {
        this.noteCaptureFailure("Pi file-read measurement capture failed");
      }
      return raw;
    });
  }

  private captureProbe<T>(
    label: "access" | "exists" | "stat" | "mkdir",
    absolutePath: string,
    resourceKind: "file" | "directory" | null,
    operation: () => T | PromiseLike<T>,
  ): Promise<T> {
    let identity: string | null = null;
    try { identity = this.resourceId(absolutePath); }
    catch { this.noteCaptureFailure(`Pi ${label} resource identity capture failed`); }
    return this.recorder.run({
      kind: "other",
      label,
      classification: classification("observed", `${DEFAULT_CAPTURE_METHOD}.${label}`),
    }, async (scope) => {
      try {
        scope.setIO({
          ...(identity === null ? {} : {
            resource_id: identity,
            resource_label: resourceKind === null ? this.opaqueResourceLabel(identity) : this.resourceLabel(resourceKind, identity),
          }),
          requested_range: null,
        });
      } catch {
        this.noteCaptureFailure(`Pi ${label} metadata capture failed`);
      }
      return await operation();
    });
  }

  private captureWrite(absolutePath: string, content: string): Promise<void> {
    let identity: string | null = null;
    try { identity = this.resourceId(absolutePath); }
    catch { this.noteCaptureFailure("Pi file-write resource identity capture failed"); }
    const context = this.toolStorage.getStore();
    const before = identity === null ? undefined : context?.beforeByResource.get(identity);
    const label = context?.semantic.label === "edit" ? "edit" : context?.semantic.label === "write" ? "write" : "file_write";
    const body = Buffer.from(content, "utf8");
    return this.recorder.run({ kind: "file_write", label }, async (scope) => {
      try {
        scope.setIO({
          ...(identity === null ? {} : { resource_id: identity, resource_label: this.resourceLabel("file", identity) }),
          requested_range: null,
        });
      } catch {
        this.noteCaptureFailure("Pi file-write metadata capture failed");
      }
      await fsWriteFile(absolutePath, content, "utf8");
      const diff = before === undefined ? null : byteSplice(before, body);
      if (identity !== null) context?.beforeByResource.delete(identity);
      try {
        scope.setIO({
          measurements: {
            written_bytes: classification("observed", WRITE_BYTES_METHOD),
            inserted_bytes: classification("derived", EDIT_DIFF_METHOD),
            deleted_bytes: classification("derived", EDIT_DIFF_METHOD),
            content_sha256: classification("derived", "sha256-of-written-bytes"),
          },
          written_bytes: quantity(body.byteLength),
          inserted_bytes: diff === null ? null : quantity(diff.inserted),
          deleted_bytes: diff === null ? null : quantity(diff.deleted),
          content_sha256: sha256(body),
        });
      } catch {
        this.noteCaptureFailure("Pi file-write measurement capture failed");
      }
    });
  }

  private captureDirectoryRead(absolutePath: string): Promise<string[]> {
    let identity: string | null = null;
    try { identity = this.resourceId(absolutePath); }
    catch { this.noteCaptureFailure("Pi directory-read resource identity capture failed"); }
    const context = this.toolStorage.getStore();
    const label = context?.semantic.label === "ls" ? "ls" : "directory_read";
    return this.recorder.run({ kind: "directory_read", label }, async (scope) => {
      try {
        scope.setIO({
          ...(identity === null ? {} : { resource_id: identity, resource_label: this.resourceLabel("directory", identity) }),
          requested_range: null,
        });
      } catch {
        this.noteCaptureFailure("Pi directory-read metadata capture failed");
      }
      const entries = await fsReaddir(absolutePath);
      try {
        scope.setIO({
          measurements: {
            entry_count: classification("observed", DIRECTORY_ENTRIES_METHOD),
            examined_entries: classification("observed", DIRECTORY_ENTRIES_METHOD),
          },
          entry_count: quantity(entries.length),
          examined_entries: quantity(entries.length),
        });
      } catch {
        this.noteCaptureFailure("Pi directory-read measurement capture failed");
      }
      return entries;
    });
  }

  private toolLabel(toolName: string, semantic: ToolSemantic): string {
    const explicit = Object.prototype.hasOwnProperty.call(this.safeLabels, toolName) ? this.safeLabels[toolName] : undefined;
    const generic = Object.prototype.hasOwnProperty.call(this.safeLabels, "tool") ? this.safeLabels.tool : undefined;
    return explicit ?? (semantic.resourceKind === null ? generic ?? "tool" : semantic.label);
  }

  private resourceLabel(kind: "file" | "directory", resourceId: string): string {
    const explicit = Object.prototype.hasOwnProperty.call(this.safeLabels, kind) ? this.safeLabels[kind] : undefined;
    return explicit ?? `opaque-resource:${resourceId.slice(-16)}`;
  }

  private opaqueResourceLabel(resourceId: string): string {
    return `opaque-resource:${resourceId.slice(-16)}`;
  }

  private resourceId(path: string): string {
    const identity = pathIdentity(path);
    const digest = createHmac("sha256", this.resourceKey)
      .update(this.recorder.namespace, "utf8")
      .update("\0", "utf8")
      .update(identity, "utf8")
      .digest("hex");
    return `hmac-sha256:${digest}`;
  }

  private noteCaptureFailure(message: string): void {
    this.captureFailures.add(message);
  }
}

/** Create a zero-model-call bridge for Pi's built-in tools and custom AgentTools. */
export function createPiOperationBridge(recorder: OperationRecorder, options: PiOperationBridgeOptions = {}): PiOperationBridge {
  return new PiOperationBridgeImpl(recorder, options);
}
