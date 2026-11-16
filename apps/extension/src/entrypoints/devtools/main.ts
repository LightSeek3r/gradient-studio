// The DevTools page: invisible, runs once per DevTools window and adds the
// "Gradients" panel. All the work happens in the panel page (panel.html).
// `chrome.devtools` exists on both Chrome/Edge and Firefox (callback style).

type PanelsApi = { create(title: string, iconPath: string, pagePath: string): void };
const panels = (globalThis as unknown as { chrome?: { devtools?: { panels?: PanelsApi } } }).chrome?.devtools?.panels;
panels?.create("Gradients", "icon/32.png", "panel.html");
