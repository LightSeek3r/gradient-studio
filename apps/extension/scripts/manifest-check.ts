// Diffs a BUILT manifest against tests/permissions-allowlist.json. Pure: used by
// tests/manifest.test.ts and by the CLI (scripts/check-manifest.ts, run as part
// of `npm run build`). Returns a list of problems; empty means the manifest
// asks for nothing the allow-list does not name.

export interface Allowlist {
  manifest_version: number;
  permissions: string[];
  optional_permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  topLevelKeys: string[];
  firefox: { gecko: Record<string, unknown> };
  devtools_page: string;
  files: string[];
}

type Manifest = Record<string, unknown>;

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined ? [] : [`<not an array: ${JSON.stringify(v)}>`]);

function diffList(label: string, actual: string[], allowed: string[], problems: string[]): void {
  for (const item of actual) if (!allowed.includes(item)) problems.push(`${label}: "${item}" is not in the allow-list`);
  for (const item of allowed) if (!actual.includes(item)) problems.push(`${label}: allow-listed "${item}" is missing (update the allow-list if this is intended)`);
}

export function checkManifest(manifest: Manifest, allow: Allowlist, browser: "chrome" | "firefox"): string[] {
  const problems: string[] = [];

  if (manifest.manifest_version !== allow.manifest_version) problems.push(`manifest_version is ${String(manifest.manifest_version)}, expected ${allow.manifest_version}`);

  for (const key of Object.keys(manifest)) {
    if (!allow.topLevelKeys.includes(key)) problems.push(`top-level key "${key}" is not in the allow-list`);
  }

  diffList("permissions", asList(manifest.permissions), allow.permissions, problems);
  diffList("optional_permissions", asList(manifest.optional_permissions), allow.optional_permissions, problems);
  diffList("host_permissions", asList(manifest.host_permissions), allow.host_permissions, problems);
  diffList("optional_host_permissions", asList(manifest.optional_host_permissions), allow.optional_host_permissions, problems);

  if (manifest.devtools_page !== allow.devtools_page) problems.push(`devtools_page is ${JSON.stringify(manifest.devtools_page)}, expected ${JSON.stringify(allow.devtools_page)}`);

  // Content Security Policy: strict, no remote hosts, no unsafe keywords, no network.
  const csp = (manifest.content_security_policy as { extension_pages?: unknown } | undefined)?.extension_pages;
  if (typeof csp !== "string") {
    problems.push("content_security_policy.extension_pages is missing");
  } else {
    if (/https?:|wss?:|\*/.test(csp)) problems.push(`CSP names a remote host or wildcard: ${csp}`);
    if (/unsafe-/.test(csp)) problems.push(`CSP uses an unsafe keyword: ${csp}`);
    if (!/connect-src 'none'/.test(csp)) problems.push("CSP must contain connect-src 'none'");
    if (!/script-src 'self'(;|$)/.test(csp)) problems.push("CSP script-src must be exactly 'self'");
    if (!/default-src 'none'/.test(csp)) problems.push("CSP must start from default-src 'none'");
  }

  const specific = manifest.browser_specific_settings as { gecko?: Record<string, unknown> } | undefined;
  if (browser === "firefox") {
    if (JSON.stringify(specific?.gecko) !== JSON.stringify(allow.firefox.gecko)) {
      problems.push(`browser_specific_settings.gecko differs from the allow-list: ${JSON.stringify(specific?.gecko)}`);
    }
    const dcp = (specific?.gecko?.data_collection_permissions ?? {}) as { required?: unknown; optional?: unknown };
    if (JSON.stringify(dcp.required) !== JSON.stringify(["none"]) || dcp.optional !== undefined) {
      problems.push('Firefox data_collection_permissions must be exactly { required: ["none"] }');
    }
  } else if (specific !== undefined) {
    problems.push("browser_specific_settings must only be present in the Firefox build");
  }

  return problems;
}

/** Every file of a build must match one of the allow-list's patterns (no background script, content script, map, or stray asset). */
export function checkFiles(files: string[], allow: Allowlist): string[] {
  const problems: string[] = [];
  const patterns = allow.files.map((p) => new RegExp(`^${p}$`));
  for (const file of files) {
    if (!patterns.some((re) => re.test(file))) problems.push(`unexpected file in the build: ${file}`);
  }
  return problems;
}
