# Talkis Product UI Reference

This reference captures the portable Talkis product UI language. Use it for Talkis screens and
for other products that should feel inspired by Talkis without copying brand content.

## Style Thesis

- Pure Thought: calm, precise, premium, and low-noise.
- Warm paper-like surfaces with black-and-white clarity.
- Product-first composition: useful controls, readable data, clear states, and restrained polish.
- Visual restraint over decoration. The interface should feel fast to scan and easy to operate.

## Typography

- Body/UI: `Inter`, then `system-ui, sans-serif`.
- Brand and headings: `Manrope` 700-800 when available, otherwise a bold neutral sans.
- Wordmark: uppercase, heavy weight, controlled tight tracking, usually around `-0.06em`.
- Product headings: compact line-height, bold sans, around `-0.04em` tracking in desktop UI.
- Web surfaces may keep `letter-spacing: 0` when already established by local CSS.
- Avoid serif display faces, script faces, and decorative headline styles as the identity base.

## Core Tokens

Use local token names when they exist.

```css
--bg: #faf9f6;
--bg-soft: #f4f1eb;
--surface: rgba(255, 255, 255, 0.72);
--surface-hi: rgba(255, 255, 255, 0.88);
--surface-solid: #f8f5ef;
--surface-strong: #f1ede6;
--text-hi: #000000;
--text-mid: #39342d;
--text-low: #5d564d;
--text-faint: #847d73;
--accent: #000000;
--accent-contrast: #ffffff;
--border: rgba(0, 0, 0, 0.09);
--border-subtle: rgba(0, 0, 0, 0.06);
--border-strong: rgba(0, 0, 0, 0.16);
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-pill: 999px;
```

For web landing/dashboard surfaces, `--text-mid: #666666` and `--text-low: #999999` are acceptable
when they match the existing web CSS.

## Components

Buttons:

- Primary: black pill or rounded button, white text, high contrast.
- Secondary: transparent/light surface, thin black border, black text.
- Product app buttons can use light surfaces by default and reserve black for primary actions.
- Hover: small translate, slightly stronger border or fill. Avoid bouncy or showy motion.

Navigation:

- Sticky web nav: cappuccino translucent background, `backdrop-filter: blur(20px)`, thin bottom border.
- Product/sidebar nav: light active state `rgba(0, 0, 0, 0.04)`, 10px radius, no inverted black active item.
- Icons: line icons, 18px default, modest stroke-weight difference between inactive and active.

Cards and panels:

- Use light translucent or solid warm surfaces with thin borders.
- Prefer no shadow or a very soft one. Border and spacing should carry most separation.
- Avoid cards inside cards. Use cards for repeated items, settings groups, modals, summaries, and tables.
- Subscription CTA blocks are light cards with a black CTA, not black promotional blocks.

Forms and tables:

- Inputs are quiet and utilitarian: transparent or white-tinted controls, thin borders, clear focus.
- Settings forms should show saved/default values clearly and keep actions close to the setting.
- Tables use small uppercase headers, thin row borders, hover tint, and mobile horizontal scroll.

## Layout Patterns

Desktop app:

- Keep a warm app frame, subtle texture/grid, blurred surfaces, compact controls, and clear side nav.
- Settings screens should be dense but calm: stacked groups, inline status, explicit errors, clear defaults.
- Preserve local app chrome and sizing constraints.

Dashboard:

- Sticky header, fixed sidebar on desktop, focused main column, table-first workflows.
- Use summaries and cards to support actions, not as decoration.
- Mobile collapses to one column with reachable actions and no text overflow.

Landing/product pages:

- First viewport should reveal the product or a concrete product state.
- Prefer screenshots, real UI states, voice/widget visuals, or product-specific motion.
- Keep hero copy direct. Do not replace the product with generic abstract decoration.

## Motion

- Motion supports comprehension: reveal, voice pulse, cleanup flow, loading/progress, hover feedback.
- Use short timings and standard easing such as `cubic-bezier(0.22, 1, 0.36, 1)`.
- Avoid animation that competes with reading or makes work surfaces feel unstable.

## Anti-Patterns

- Purple/blue neon AI palettes, heavy gradients, decorative blobs, and generic glass dashboards.
- Heavy drop shadows, deep card stacks, and page sections styled as floating cards.
- Random font mixing or decorative display typography as the core style.
- Inverted black sidebars/nav active states for ordinary product navigation.
- Marketing-only composition when the requested artifact is an app, dashboard, tool, or settings view.
