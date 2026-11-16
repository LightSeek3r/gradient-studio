// Everything `run` touches in the outside world, injected so it can be tested.

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

/** The slice of the file system the CLI uses. All methods may reject. */
export interface CliFs {
  /** Follows symbolic links. */
  stat(path: string): Promise<FileStat>;
  readdir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export interface CliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  fs: CliFs;
  /**
   * Reads standard input. Implementations should stop after `limit` bytes
   * (returning at most `limit` bytes); the CLI treats a result of exactly
   * `limit` bytes as "too large".
   */
  readStdin: (limit: number) => Promise<Uint8Array>;
  /** Directory that relative paths and `--ignore` patterns are resolved against. */
  cwd: string;
  /** Whether stdout understands ANSI colour (`--no-color` still turns it off). */
  color: boolean;
  /** Version printed by `--version` and echoed in JSON output. */
  version: string;
}
