# Talkis Product UI Style Rule

Use this rule when creating or editing Talkis product UI: the desktop app, settings windows,
dashboard screens, auth pages, product landing sections, and reusable UI patterns inspired by
Talkis. The goal is one visual language across `talkis-pc` and `talkis-web`, not a one-off
landing-page prompt.

## Design Direction

- Core idea: Pure Thought - calm, precise, premium, and low-noise.
- Visual model: warm paper-like product surfaces, Swiss restraint, black-and-white clarity.
- Product feel: utility first, quietly polished, fast to scan, no decorative clutter.
- Prefer real controls and states over marketing composition when building app or dashboard UI.

## Typography

- UI/body font: `Inter`, fallback `system-ui, sans-serif`.
- Brand/headline font: `Manrope` 700-800 when available; otherwise a bold neutral sans.
- Brand wordmark: uppercase, bold, tight but controlled tracking, usually `letter-spacing: -0.06em`.
- Product headings: bold sans, compact line height, usually `letter-spacing: -0.04em` in the app.
- Web text can use `letter-spacing: 0` where that is already the local convention.
- Do not base the identity on serif display faces, script faces, or decorative headline styles.

Reference tokens from `src/index.css`:

```css
--font: "Inter", system-ui, sans-serif;
--font-main: "Inter", system-ui, sans-serif;
--font-accent: "Manrope", "Inter", system-ui, sans-serif;
--font-brand: "Manrope", "Inter", system-ui, sans-serif;
```

## Color Tokens

- Main background: `#faf9f6`.
- Soft background: `#f4f1eb`.
- Primary text: `#000000`.
- Secondary text: `#39342d` in desktop UI, `#666666` in web surfaces.
- Tertiary text: `#5d564d`, `#847d73`, or `#999999` depending on local tokens.
- Primary accent: black foreground/action with white contrast.
- Danger: `#8f2d20`.
- Success: restrained green, for example `#1f5130`.

Surfaces:

- `--surface: rgba(255, 255, 255, 0.72)`.
- `--surface-hi: rgba(255, 255, 255, 0.88)`.
- `--surface-solid: #f8f5ef`.
- Borders: `rgba(0, 0, 0, 0.06)` to `rgba(0, 0, 0, 0.16)`.
- Use blur for floating surfaces and sticky nav, not heavy shadows.

## Shape, Spacing, And Density

- Standard radii: `8px`, `10px`, `12px`, `16px`.
- App/window radius: `16px`.
- Pill controls: `999px`.
- Message bubble radius: `22px 22px 0 22px` in app patterns.
- App and dashboard surfaces should feel dense enough for repeat use. Avoid oversized empty cards.
- Use clear grid and table alignment for settings, billing, users, history, logs, and admin flows.

## Components

Buttons:

- Primary CTA: black pill, white text, uppercase when the local UI uses uppercase buttons.
- Secondary CTA: transparent or light background with a thin black border.
- Product app buttons: use `.btn`, `.btn-primary`, `.btn-danger` patterns from `src/index.css`.
- Keep transitions subtle: background, border, color, small translate on hover.

Navigation:

- Web navigation: sticky top bar, `rgba(250, 249, 246, 0.8)`, `backdrop-filter: blur(20px)`,
  thin bottom border.
- App sidebar/dashboard nav: light background, 10px radius, active state `rgba(0, 0, 0, 0.04)`,
  never inverted black for ordinary active nav.
- Icons: lucide-style line icons, 18px default, slightly stronger stroke for active states.

Cards and panels:

- Use light panels with subtle borders and little or no shadow.
- Do not put large page sections inside floating cards.
- Use cards for repeated items, settings groups, modals, profile/billing summaries, and tables.
- Subscription/sidebar CTA blocks are light cards with black CTA buttons, not inverted black blocks.

Forms and tables:

- Inputs are quiet: transparent or white-tinted controls, thin borders, strong focus rings.
- Settings forms should be stacked, readable, and explicit about saved/default values.
- Tables use small uppercase headers, thin row borders, hover tint, and horizontal scroll on mobile.

## Layout Patterns

Desktop app:

- Preserve the compact app frame, warm background, subtle grid texture, and blurred surfaces.
- Keep window and widget sizing conventions from the existing app instead of inventing new chrome.
- Settings views should optimize repeated work: sidebar navigation, readable panels, inline status,
  clear destructive states, and restrained empty states.

Web landing:

- First viewport should immediately signal Talkis and the product.
- Use strong product screenshots, real UI, voice/widget visuals, or product-specific motion.
- Keep hero text direct. Supporting copy carries the value proposition.
- Avoid generic SaaS gradient heroes and stock-like decoration.

Dashboard:

- Use a sticky header, fixed-width sidebar on desktop, compact nav links, and a focused main column.
- Keep billing, users, profile, and admin flows work-focused: tables, forms, summaries, and clear CTAs.
- On mobile, collapse to a single column and keep header actions reachable without overflow.

## Motion

- Motion must support comprehension: reveal, voice pulse, cleanup flow, loading/progress, hover feedback.
- Use short timings and standard easing such as `cubic-bezier(0.22, 1, 0.36, 1)`.
- Avoid decorative effects that compete with text, controls, or product screenshots.

## Implementation Rules

- Prefer existing local tokens and classes before adding new styling primitives.
- In `talkis-pc`, use inline styles with CSS variables for React components unless the file already
  uses shared CSS classes.
- In `talkis-web`, reuse `globals.css` utility classes such as `btn-black`, `btn-outline`,
  `sticky-nav`, dashboard classes, and type classes before adding custom variants.
- Keep UI text Russian in product surfaces unless a specific screen is intentionally English.
- Test responsive text fit. Buttons, nav links, tables, and cards must not overflow their containers.
- Do not change unrelated layout systems when applying this style to one screen or component.

## Anti-Patterns

- Purple/blue neon palettes, glassmorphism-heavy dashboards, or generic AI gradients.
- Heavy drop shadows, deep card stacks, nested cards, and decorative blobs.
- Random fonts or mixed visual systems in one screen.
- Black inverted nav/sidebar active states for ordinary product navigation.
- Marketing-only sections when the requested output is an app, dashboard, or tool.
