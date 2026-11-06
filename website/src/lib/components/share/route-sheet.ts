import { LngLatBounds, Map, type StyleSpecification } from 'maplibre-gl';
import type { GPXFile } from 'gpx';
import sheetCSS from './route-sheet.css?inline';

// Use only the base map and overlays, excluding editor routes and interaction layers.
export async function captureRouteMap(
    editor: Map,
    file: GPXFile,
    startLabel: string,
    endLabel: string,
    signal: AbortSignal
): Promise<{ image: string; attribution: string }> {
    const style = structuredClone(editor.getStyle());
    const anchor = style.layers.findIndex((layer) => layer.id === 'overlays-end');
    if (anchor < 0) throw new Error('Base map is not ready');
    style.layers = style.layers.slice(0, anchor);
    const sources = new Set(
        style.layers.flatMap((layer) => ('source' in layer ? [layer.source] : []))
    );
    style.sources = Object.fromEntries(
        Object.entries(style.sources).filter(([id]) => sources.has(id))
    );
    delete style.terrain;
    style.projection = { type: 'mercator' };

    const attribution = document.createElement('div');
    attribution.innerHTML = [
        ...new Set(
            Object.entries(style.sources).flatMap(([id, source]) => {
                const credit =
                    editor.getSource(id)?.attribution ||
                    ('attribution' in source ? source.attribution : '');
                return credit ? [credit] : [];
            })
        ),
    ].join(' · ');

    const segments = file
        .getSegments()
        .map((segment) =>
            segment.trkpt.map((point): [number, number] => [
                point.attributes.lon,
                point.attributes.lat,
            ])
        )
        .filter((segment) => segment.length > 0);
    const first = segments[0]?.[0];
    const last = segments.at(-1)?.at(-1);
    if (!first || !last) throw new Error('Route has no track points');

    const container = document.createElement('div');
    container.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1000px;height:560px;pointer-events:none';
    document.body.append(container);
    let preview: Map | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        preview = new Map({
            container,
            style: style as StyleSpecification,
            interactive: false,
            attributionControl: false,
            canvasContextAttributes: { preserveDrawingBuffer: true },
            pixelRatio: 2,
        });
        const snapshot = preview;
        await new Promise<void>((resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('Map capture timed out')), 25000);
            abort = () => reject(new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', abort, { once: true });
            snapshot.on('error', (event) => reject(event.error));
            snapshot.once('load', () => {
                snapshot.addSource('sheet-route', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'MultiLineString', coordinates: segments },
                    },
                });
                snapshot.addLayer({
                    id: 'sheet-route-halo',
                    type: 'line',
                    source: 'sheet-route',
                    paint: { 'line-color': '#fff', 'line-width': 7 },
                });
                snapshot.addLayer({
                    id: 'sheet-route-line',
                    type: 'line',
                    source: 'sheet-route',
                    paint: { 'line-color': '#147d64', 'line-width': 4 },
                });
                const bounds = new LngLatBounds(first, first);
                segments.forEach((segment) => segment.forEach((point) => bounds.extend(point)));
                snapshot.fitBounds(bounds, { padding: 55, maxZoom: 16, duration: 0 });
                // DOM markers are painted into the exported canvas below.
                snapshot.once('idle', resolve);
            });
        });
        const canvas = document.createElement('canvas');
        const sourceCanvas = snapshot.getCanvas();
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(sourceCanvas, 0, 0);
        const scale = canvas.width / 1000;
        // Offset labels vertically so both remain visible on a loop route.
        for (const [point, label, color, offset] of [
            [first, startLabel, '#147d64', -17],
            [last, endLabel, '#b93e4c', 17],
        ] as const) {
            const position = snapshot.project(point);
            const x = position.x * scale;
            const y = (position.y + offset) * scale;
            context.beginPath();
            context.moveTo(position.x * scale, position.y * scale);
            context.lineTo(x, y);
            context.strokeStyle = color;
            context.lineWidth = 2 * scale;
            context.stroke();
            context.beginPath();
            context.arc(x, y, 12 * scale, 0, 2 * Math.PI);
            context.fillStyle = color;
            context.fill();
            context.strokeStyle = '#fff';
            context.stroke();
            context.fillStyle = '#fff';
            context.font = `bold ${12 * scale}px Arial`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label, x, y);
        }
        return { image: canvas.toDataURL('image/png'), attribution: attribution.textContent ?? '' };
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        preview?.remove();
        container.remove();
    }
}

export function printRouteSheet(
    article: HTMLElement,
    title: string,
    onError: () => void
): () => void {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
    const cleanup = () => frame.remove();
    const documentTitle = document.createElement('title');
    documentTitle.textContent = title;
    frame.onload = async () => {
        try {
            const target = frame.contentWindow;
            if (!target) throw new Error('Print window unavailable');
            await Promise.all(Array.from(target.document.images, (image) => image.decode()));
            target.addEventListener('afterprint', cleanup, { once: true });
            target.focus();
            target.print();
        } catch {
            cleanup();
            onError();
        }
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${documentTitle.outerHTML}<style>${sheetCSS}</style></head><body>${article.outerHTML}</body></html>`;
    document.body.append(frame);
    return cleanup;
}
