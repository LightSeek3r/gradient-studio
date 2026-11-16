// The manifest, in one place. WXT adds `manifest_version`, `devtools_page`,
// `version` (from package.json), `description` and the icons it finds in
// public/icon. Everything else is declared here.
//
// PERMISSIONS: none. A DevTools page needs none to create a panel or to call
// `inspectedWindow.eval`; the inspected page is reached through DevTools, not
// through host permissions. tests/manifest.test.ts diffs the BUILT manifests
// against tests/permissions-allowlist.json, so adding any permission, host
// permission, content script, background script or web-accessible resource
// fails the test until the allow-list is changed in the same, reviewed commit.

import type { UserManifest } from "wxt";

export type Target = "chrome" | "firefox" | "edge";

/**
 * Permanent Firefox add-on id (required for Manifest V3 on AMO). A random
 * GUID, deliberately not an e-mail or a domain we do not control. Never change
 * it after the first AMO upload: it is the extension's identity there.
 */
export const GECKO_ID = "{4f1a7c52-93d0-4b8e-a2c6-5d7e08b1f3a9}";

// Chrome 111: oldest version with every API and CSS feature the panel uses
// (see docs/extension.md). Firefox 142: first release with
// `data_collection_permissions` on both desktop and Android; older Firefox
// would ignore the key, but AMO's linter requires a minimum version for it.
export const CHROME_MIN = "111";
export const FIREFOX_MIN = "142.0";

/** Strict CSP for every extension page: no remote code, no network, no inline script or style. */
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function buildManifest(browser: Target): UserManifest {
  const manifest: UserManifest = {
    name: "Opal42 Gradient Score",
    short_name: "Gradient Score",
    description:
      "DevTools panel that lists the CSS gradients on the inspected page with a smoothness score and fixes. Runs locally: no network, no telemetry.",
    minimum_chrome_version: CHROME_MIN,
    content_security_policy: { extension_pages: CSP },
  };
  if (browser === "firefox") {
    // minimum_chrome_version is ignored (and flagged) by Firefox.
    delete manifest.minimum_chrome_version;
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN,
        // "none": the extension collects and transmits no user data at all.
        data_collection_permissions: { required: ["none"] },
      },
    };
  }
  return manifest;
}
