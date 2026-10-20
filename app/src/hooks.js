// Extension points the feature modules plug into, kept out of main.js so modules never import the entry.
export const ctxHooks = { render: null };   // (containerEl) => boolean handled
export const keyHooks = [];                 // (event, { typing, mod }) => boolean handled
