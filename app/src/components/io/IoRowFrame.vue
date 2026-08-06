<script setup lang="ts">
// The shape every IO row has: glyph, name, reading, controls.
//
// The old app gave each type its own template and let each one lay itself out
// (`src/views/io/*.html`), so a temperature's value sat in a `.value_temp`
// span, a scenario's button in an `.action_button` anchor, and a string input
// had no value column at all — sixteen files that agreed on `.io` and on
// nothing else. One frame here, four slots, and a type only decides what goes
// in them. It is also the single place the pending indicator and the `rw`
// gate's consequences can be made to look the same everywhere.
//
// The row is NOT a card you press. Nothing about it hovers or lifts, and it
// has no filament: the buttons inside it are the interactive things, and
// dressing their container as another target would be a lie. The only colour
// on a resting row is its glyph, which is the app's rule for glyphs
// everywhere (HomeView's tiles, the room header's plate).
//
// `aria-busy` rather than a live region for the pending state: a room can hold
// a dozen rows, and a dozen polite announcements racing each other after one
// tap is worse than silence. The dot is the visual half, `aria-busy` the
// programmatic one, and neither interrupts.

withDefaults(
    defineProps<{
        /** The IO's name — server data, never translated. */
        name: string;
        /** A set_state is in flight: show the activity dot. */
        pending?: boolean;
        /**
         * A short label ABOVE nothing and BELOW the name, in the app's eyebrow
         * type. Only `UnknownIo` uses it, to say what the server called a type
         * this app cannot draw.
         */
        note?: string;
    }>(),
    { pending: false, note: '' },
);
</script>

<template>
    <div class="io-row" :aria-busy="pending ? 'true' : undefined">
        <span class="io-row__lead">
            <slot name="icon" />
            <!-- Anchored to the glyph, not to the row: it is this control that
                 is waiting, and a badge on the thing itself costs no layout
                 (a dot that appears in the flow would shove the name). -->
            <span v-if="pending" class="io-row__pending pulse-soft" aria-hidden="true" />
        </span>

        <span class="io-row__text">
            <span class="io-row__name">{{ name }}</span>
            <span v-if="note !== ''" class="io-row__note">{{ note }}</span>
        </span>

        <span v-if="$slots.value" class="io-row__value"><slot name="value" /></span>

        <span v-if="$slots.actions" class="io-row__actions"><slot name="actions" /></span>
    </div>
</template>

<style scoped>
.io-row {
    display: flex;
    align-items: center;
    /* Wraps rather than crushes. `.io-row__text` below holds a floor, so a
       row whose controls and name cannot share one line puts the controls on
       a second line instead of hyphenating the name into "Appl / ique" — the
       phone-width failure the old fixed layout had no answer for at all. */
    flex-wrap: wrap;
    gap: var(--space-3);
    inline-size: 100%;
    /* The height of a row that HAS a 44px button, applied to every row: rows
       that differ in height by the 8px their controls happen to need read as
       a ragged list rather than as one instrument panel. */
    min-block-size: 4.25rem;
    padding: var(--space-3);
    background-color: var(--c-surface);
    border: 1px solid var(--c-border);
    border-radius: var(--radius-md);
}

.io-row__lead {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    /* The glyph slot sets the size; every icon inside inherits it. */
    font-size: 1.375rem;
}

.io-row__pending {
    position: absolute;
    inset-block-start: -1px;
    inset-inline-end: -1px;
    inline-size: 0.5rem;
    block-size: 0.5rem;
    border-radius: 50%;
    background-color: var(--c-accent);
    /* Knocked out of the row's own surface before it glows: the dot sits on
       top of whatever glyph the type uses, and a lit bulb's rays reach into
       exactly this corner. Without the ring it disappears into them. */
    box-shadow:
        0 0 0 2px var(--c-surface),
        0 0 6px var(--c-accent-glow);
}

.io-row__text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    /* Takes the slack, down to a floor of 6rem — about ten characters, which
       is where a name stops being a name and starts being fragments. Below
       that the row wraps and the controls take a line of their own rather
       than squeezing further: no name is broken mid-word ("Appl / ique") to
       make room for a slider. The floor is set low on purpose, so that
       wrapping stays the escape hatch for the rows that genuinely cannot fit
       (a dimmer, a shutter that also reports a percentage) instead of
       becoming the house style at 360px. */
    flex: 1;
    min-inline-size: 6rem;
}

.io-row__name {
    font-size: 0.9375rem;
    font-weight: 500;
    letter-spacing: var(--tracking-tight);
    line-height: 1.25;
    overflow-wrap: anywhere;
}

.io-row__note {
    /* The app's eyebrow: the type treatment used wherever a label NAMES
       something (room type on the tiles, on the room header). */
    font-size: 0.6875rem;
    font-weight: 500;
    letter-spacing: var(--tracking-wide);
    text-transform: uppercase;
    color: var(--c-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.io-row__value {
    flex: none;
    font-size: 0.9375rem;
    /* Readings change in place; digits must not dance. */
    font-variant-numeric: tabular-nums;
    color: var(--c-text-muted);
    white-space: nowrap;
    /* A value is server data and can be a sentence. Capped here, once, so no
       row type can push its own name out of its own row. */
    max-inline-size: min(16rem, 45%);
    overflow: hidden;
    text-overflow: ellipsis;
}

.io-row__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    /* No-op while the controls share the name's line (the name has already
       eaten the slack); it is what right-aligns them once they wrap onto a
       line of their own. */
    margin-inline-start: auto;
}

/* On the narrowest phones the two action buttons and a long name are fighting
   for the same 320px; give the fight back to the name. */
@media (max-width: 24rem) {
    .io-row {
        gap: var(--space-2);
        padding-inline: var(--space-2);
    }
}
</style>
