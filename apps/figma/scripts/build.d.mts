export function build(options?: { outdir?: string; minify?: boolean }): Promise<{ outdir: string; sizes: Record<string, number> }>
