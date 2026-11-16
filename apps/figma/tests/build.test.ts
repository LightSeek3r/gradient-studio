import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from '../scripts/build.mjs'

const manifestUrl = new URL('../manifest.json', import.meta.url)
const typingsUrl = new URL('../../../node_modules/@figma/plugin-typings/plugin-api.d.ts', import.meta.url)

describe('manifest.json', () => {
  it('declares a Design Mode plugin with no network and dynamic page access', async () => {
    const m = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(m.editorType).toEqual(['figma'])
    expect(m.documentAccess).toBe('dynamic-page')
    expect(m.networkAccess).toEqual({ allowedDomains: ['none'] })
    expect(m.main).toBe('code.js')
    expect(m.ui).toBe('ui.html')
    expect(m.name).toBe('Opal42 Gradient Score')
  })

  it('asks for no permissions and no extra capabilities', async () => {
    const m = JSON.parse(await readFile(manifestUrl, 'utf8'))
    expect(Object.keys(m).sort()).toEqual(['api', 'documentAccess', 'editorType', 'id', 'main', 'name', 'networkAccess', 'ui'])
    expect(m.permissions).toBeUndefined()
    expect(m.enableProposedApi).toBeUndefined()
  })

  it('uses the API version of the installed typings', async () => {
    const m = JSON.parse(await readFile(manifestUrl, 'utf8'))
    const typings = await readFile(typingsUrl, 'utf8')
    expect(typings).toContain(`readonly apiVersion: '${m.api}'`)
  })
})

describe('build', () => {
  let dir: string
  let out: { sizes: Record<string, number> }
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opal42-figma-'))
    out = await build({ outdir: dir })
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('writes exactly the three files the manifest needs', async () => {
    for (const f of ['manifest.json', 'code.js', 'ui.html']) expect((await readFile(join(dir, f), 'utf8')).length).toBeGreaterThan(50)
    expect(out.sizes['code.js']).toBeLessThan(300 * 1024)
    expect(out.sizes['ui.html']).toBeLessThan(100 * 1024)
  })

  it('sandbox bundle is one self-contained script that reads the Figma globals', async () => {
    const js = await readFile(join(dir, 'code.js'), 'utf8')
    expect(js).not.toMatch(/\bimport\s*\(|\brequire\(|^import /m)
    expect(js).toContain('__html__')
    expect(js).toMatch(/\bfigma\b/)
  })

  it('has no remote code, fonts, images or network calls', async () => {
    const html = await readFile(join(dir, 'ui.html'), 'utf8')
    const js = await readFile(join(dir, 'code.js'), 'utf8')
    for (const text of [html, js]) {
      // XML namespace strings in the SVG/Android export templates are text, never requested.
      const urls = (text.match(/https?:\/\/[^"'\s)]*/g) ?? []).filter((u) => !/^http:\/\/(www\.w3\.org\/2000\/svg|schemas\.android\.com\/)/.test(u))
      expect(urls).toEqual([])
      expect(text).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/)
    }
    expect(html).not.toMatch(/<script[^>]*\ssrc=|<link\b|@import|@font-face|<img\b|<iframe\b/i)
    expect((html.match(/<script/g) ?? []).length).toBe(1)
  })

  it('inlines the Figma theme variables with fallbacks and follows the system theme', async () => {
    const html = await readFile(join(dir, 'ui.html'), 'utf8')
    expect(html).toContain('--figma-color-bg')
    expect(html).toContain('prefers-color-scheme: dark')
    expect(html).toContain('color-scheme')
  })
})
