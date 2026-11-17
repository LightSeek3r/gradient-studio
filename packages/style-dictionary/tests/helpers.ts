/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures read untyped JSON */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import StyleDictionary from "style-dictionary";
import { register, type Opal42Options } from "../src/index";

export interface BuildSpec {
  /** token files: name -> JSON-serialisable content */
  tokens: Record<string, unknown>;
  options?: Opal42Options;
  /** transforms of the platform; default: the ready-made group */
  transforms?: string[];
  /** Style Dictionary `usesDtcg` config */
  usesDtcg?: boolean;
  files?: { destination: string; format: string; options?: Record<string, unknown> }[];
  actions?: string[];
  /** Style Dictionary's own log verbosity (default silent) */
  verbosity?: "silent" | "default" | "verbose";
}

export interface BuildResult {
  dir: string;
  read(file: string): Promise<string>;
  json(file: string): Promise<any>;
  /** dump.json keyed by token path */
  tokens(): Promise<Record<string, { value: any; attributes: any; original: any }>>;
  cleanup(): Promise<void>;
}

/** Runs a real Style Dictionary build on a temp directory. */
export async function build(spec: BuildSpec): Promise<BuildResult> {
  const dir = await mkdtemp(join(tmpdir(), "opal42-sd-"));
  await mkdir(join(dir, "tokens"), { recursive: true });
  const source: string[] = [];
  for (const [name, content] of Object.entries(spec.tokens)) {
    const p = join(dir, "tokens", name);
    await writeFile(p, JSON.stringify(content));
    source.push(p);
  }
  const sd = new StyleDictionary({
    source,
    log: { verbosity: spec.verbosity ?? "silent", warnings: "disabled" },
    ...(spec.usesDtcg === undefined ? {} : { usesDtcg: spec.usesDtcg }),
    platforms: {
      web: {
        ...(spec.transforms ? { transforms: spec.transforms } : { transformGroup: "opal42/css" }),
        buildPath: join(dir, "build") + "/",
        files: spec.files ?? [
          { destination: "gradients.css", format: "opal42/css-gradients" },
          { destination: "report.json", format: "opal42/report-json" },
          { destination: "dump.json", format: "test/dump" },
        ],
        ...(spec.actions ? { actions: spec.actions } : {}),
      },
    },
  });
  register(sd, { log: false, ...spec.options });
  // Test-only format: the transformed tokens exactly as Style Dictionary hands them to a format.
  sd.registerFormat({
    name: "test/dump",
    format: ({ dictionary }: { dictionary: { allTokens: any[] } }) =>
      JSON.stringify(
        dictionary.allTokens.map((t) => ({ path: t.path.join("."), value: t.$value ?? t.value, attributes: t.attributes, original: t.original.$value ?? t.original.value })),
      ),
  });
  await sd.buildAllPlatforms();
  return {
    dir,
    read: (f) => readFile(join(dir, "build", f), "utf8"),
    json: async (f) => JSON.parse(await readFile(join(dir, "build", f), "utf8")),
    tokens: async () => Object.fromEntries((JSON.parse(await readFile(join(dir, "build", "dump.json"), "utf8")) as any[]).map((t) => [t.path, t])),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
