<script lang="ts">
    import { Dialog } from 'bits-ui';
    import { X } from '@lucide/svelte';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { selection } from '$lib/logic/selection';
    import type { GPXFileWithStatistics } from '$lib/logic/statistics-tree';
    import { i18n } from '$lib/i18n.svelte';
    import RouteSheet from './RouteSheet.svelte';

    let { open = $bindable(false) }: { open?: boolean } = $props();
    let routes: { id: string; data: GPXFileWithStatistics }[] = $state([]);
    let selectedId = $state('');
    let selected = $derived(routes.find((route) => route.id === selectedId));

    $effect(() => {
        if (!open) return;
        // Snapshot the selected full files, so editing behind the dialog cannot alter a sheet.
        const files: typeof routes = [];
        selection.applyToOrderedSelectedItemsFromFile((id) => {
            const state = fileStateCollection.getFileState(id);
            if (state?.file && state.statistics && state.file.getNumberOfTrackPoints() > 0) {
                files.push({ id, data: { file: state.file, statistics: state.statistics } });
            }
        });
        routes = files;
        selectedId = files[0]?.id ?? '';
    });
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
            class="fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border bg-background p-4 shadow-lg sm:p-6"
        >
            <div class="flex items-center justify-between gap-3">
                <Dialog.Title class="text-lg font-semibold"
                    >{i18n._('share.title', 'Share route as PDF')}</Dialog.Title
                >
                <Dialog.Close
                    aria-label={i18n._('share.close', 'Close')}
                    class="rounded-md p-2 hover:bg-accent"><X size="18" /></Dialog.Close
                >
            </div>
            <Dialog.Description class="text-sm text-muted-foreground"
                >{i18n._(
                    'share.description',
                    'A printable sheet with the complete route, its statistics and elevation profile.'
                )}</Dialog.Description
            >
            {#if routes.length > 1}
                <label class="flex flex-col gap-1 text-sm">
                    {i18n._('share.route', 'Route')}
                    <select
                        bind:value={selectedId}
                        class="w-full rounded-md border bg-background p-2"
                    >
                        {#each routes as route}<option value={route.id}
                                >{route.data.file.metadata.name ||
                                    i18n._('share.untitled', 'Untitled route')}</option
                            >{/each}
                    </select>
                </label>
            {/if}
            {#if selected}
                {#key selected.id}<RouteSheet route={selected.data} />{/key}
            {:else}
                <p role="status" class="py-8 text-center text-sm text-muted-foreground">
                    {i18n._('share.empty', 'Select a route with track points to create a PDF.')}
                </p>
            {/if}
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
