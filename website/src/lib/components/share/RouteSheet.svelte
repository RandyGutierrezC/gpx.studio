<script lang="ts">
    import { onMount, onDestroy, untrack } from 'svelte';
    import { get } from 'svelte/store';
    import { Button } from '$lib/components/ui/button';
    import { Printer, RotateCw } from '@lucide/svelte';
    import { map } from '$lib/components/map/map';
    import { ListRootItem } from '$lib/components/file-list/file-list';
    import type { GPXFileWithStatistics } from '$lib/logic/statistics-tree';
    import { i18n } from '$lib/i18n.svelte';
    import { getDistanceWithUnits, getElevationWithUnits } from '$lib/units';
    import { captureRouteMap, printRouteSheet } from './route-sheet';
    import './route-sheet.css';

    let { route }: { route: GPXFileWithStatistics } = $props();
    const snapshot = untrack(() => route);
    const statistics = snapshot.statistics.getStatisticsFor(new ListRootItem());
    const title = snapshot.file.metadata.name || i18n._('share.untitled', 'Untitled route');
    const profile: { distance: number; elevation: number | undefined }[][] = [];
    let offset = 0;
    for (const segment of snapshot.file.getSegments()) {
        const stats = segment.getStatistics();
        profile.push(
            segment.trkpt.map((point, index) => ({
                distance: offset + stats.local.data[index].distance.total,
                elevation: point.ele,
            }))
        );
        offset += stats.global.distance.total;
    }
    const elevations = profile
        .flat()
        .flatMap((point) =>
            point.elevation !== undefined && Number.isFinite(point.elevation)
                ? [point.elevation]
                : []
        );
    const minElevation = elevations.reduce((min, value) => Math.min(min, value), Infinity);
    const maxElevation = elevations.reduce((max, value) => Math.max(max, value), -Infinity);
    const range = Math.max(10, maxElevation - minElevation);
    const total = statistics.global.distance.total;
    // Keep gaps between segments and where elevation data is missing.
    const paths = profile.map((segment) => {
        let drawing = false;
        return segment
            .map((point) => {
                if (point.elevation === undefined || !Number.isFinite(point.elevation)) {
                    drawing = false;
                    return '';
                }
                const x = 65 + (total > 0 ? point.distance / total : 0) * 600;
                const y = 115 - ((point.elevation - minElevation) / range) * 90;
                const command = drawing ? 'L' : 'M';
                drawing = true;
                return `${command}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
    });

    let article: HTMLElement;
    let image = $state('');
    let attribution = $state('');
    let loading = $state(true);
    let error = $state(false);
    let printError = $state(false);
    let controller: AbortController | undefined;
    let cleanupPrint: (() => void) | undefined;

    async function capture() {
        controller?.abort();
        const current = new AbortController();
        controller = current;
        loading = true;
        error = false;
        image = '';
        try {
            const editor = get(map);
            if (!editor) throw new Error('Map is not ready');
            const result = await captureRouteMap(editor, snapshot.file, 'A', 'B', current.signal);
            if (!current.signal.aborted) {
                image = result.image;
                attribution = result.attribution;
            }
        } catch {
            if (!current.signal.aborted) error = true;
        } finally {
            if (!current.signal.aborted) loading = false;
        }
    }

    function print() {
        printError = false;
        cleanupPrint?.();
        cleanupPrint = printRouteSheet(article, title, () => (printError = true));
    }

    onMount(() => {
        void capture();
    });
    onDestroy(() => {
        controller?.abort();
        cleanupPrint?.();
    });
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-muted-foreground max-w-md">
        {i18n._(
            'share.instructions',
            'Choose “Save as PDF” in the print dialog to download your route sheet.'
        )}
    </p>
    <Button onclick={print} disabled={loading || error || !image}>
        <Printer size="16" />
        {i18n._('share.save', 'Save as PDF')}
    </Button>
</div>
{#if printError}
    <p role="alert" class="text-sm text-destructive">
        {i18n._('share.print_error', 'Could not open printing. Please try again.')}
    </p>
{/if}
<article bind:this={article} class="route-sheet rounded-lg border shadow-sm">
    <div class="sheet-brand">gpx.studio / {i18n._('share.sheet', 'ROUTE SHEET')}</div>
    <h1>{title}</h1>
    <div class="sheet-stats">
        <div class="sheet-stat">
            <strong>{getDistanceWithUnits(total)}</strong><span
                >{i18n._('quantities.distance')}</span
            >
        </div>
        <div class="sheet-stat">
            <strong
                >{elevations.length
                    ? getElevationWithUnits(statistics.global.elevation.gain)
                    : '—'}</strong
            ><span>{i18n._('share.ascent', 'Elevation gain')}</span>
        </div>
        <div class="sheet-stat">
            <strong
                >{elevations.length
                    ? getElevationWithUnits(statistics.global.elevation.loss)
                    : '—'}</strong
            ><span>{i18n._('share.descent', 'Elevation loss')}</span>
        </div>
    </div>
    {#if image}
        <img class="sheet-map" src={image} alt={i18n._('share.map', 'Map of the complete route')} />
        <p class="sheet-attribution">{attribution}</p>
    {:else}
        <div
            class="sheet-map flex flex-col items-center justify-center gap-3"
            role="status"
            aria-live="polite"
        >
            <p class="sheet-note">
                {loading
                    ? i18n._('share.loading', 'Preparing route map…')
                    : i18n._(
                          'share.map_error',
                          'Could not prepare the map. Check your connection and try again.'
                      )}
            </p>
            {#if error}<Button variant="outline" onclick={capture}
                    ><RotateCw size="16" />{i18n._('share.retry', 'Try again')}</Button
                >{/if}
        </div>
    {/if}
    <div class="sheet-legend">
        <span><b>A</b> {i18n._('share.start', 'Start')}</span><span
            ><b class="sheet-end">B</b> {i18n._('share.finish', 'Finish')}</span
        >
    </div>
    <h2>{i18n._('menu.elevation_profile')}</h2>
    {#if elevations.length}
        <svg
            class="sheet-profile"
            viewBox="0 0 700 150"
            role="img"
            aria-label={i18n._('menu.elevation_profile')}
        >
            <path d="M65,20 V115 H665" fill="none" stroke="#dce5e2" />
            <path d="M65,70 H665" fill="none" stroke="#eaf0ed" />
            {#each paths as path}<path
                    d={path}
                    fill="none"
                    stroke="#147d64"
                    stroke-width="2"
                    stroke-linejoin="round"
                />{/each}
            <g fill="#536762" font-size="11" font-family="Arial, sans-serif">
                <text x="0" y="28">{getElevationWithUnits(minElevation + range)}</text>
                <text x="0" y="118">{getElevationWithUnits(minElevation)}</text>
                {#each [0, 0.25, 0.5, 0.75, 1] as fraction}<text
                        x={65 + fraction * 600}
                        y="140"
                        text-anchor="middle">{getDistanceWithUnits(total * fraction)}</text
                    >{/each}
            </g>
        </svg>
    {:else}
        <p class="sheet-note">
            {i18n._('share.no_elevation', 'This route has no elevation data.')}
        </p>
    {/if}
    <footer>{i18n._('share.footer', 'Complete route · Created with gpx.studio')}</footer>
</article>
