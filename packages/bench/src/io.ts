// Everything `run` touches in the outside world, injected so it can be tested.

export interface BenchIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Reads all of standard input as UTF-8. */
  readStdin(): Promise<string>;
}
