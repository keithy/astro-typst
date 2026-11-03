// Registry for Typst assets that Astro builds must write into the output
// directory.
//
// Astro 7's static asset rearranger does not retain arbitrary `emitFile`
// calls made by a custom transform inside its SSR asset registry, so a
// `emitSvg` asset emitted during an Astro build can be silently dropped.
//
// The integration therefore registers assets here during the build, and
// flushes them from the `astro:build:done` hook, where the final output
// directory is known. Standalone Vite builds keep using Rollup's `emitFile`
// API and never touch this registry.

export interface TypstAsset {
    fileName: string;
    source: string;
}

let assets: TypstAsset[] = [];

export function registerTypstAsset(fileName: string, source: string): void {
    assets.push({ fileName, source });
}

export function takeTypstAssets(): TypstAsset[] {
    const taken = assets;
    assets = [];
    return taken;
}

export function clearTypstAssets(): void {
    assets = [];
}
