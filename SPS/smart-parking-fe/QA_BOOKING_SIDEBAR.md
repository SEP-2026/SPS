QA Checklist — Booking sidebar (compact rail)

Scope
- Verify the collapsed (icon-only) sidebar behaves like Image 1: narrow rail, centered icons, tooltips, hover-expand shows labels.

Environments
- Desktop (Chrome/Edge/Firefox) at widths: 1440px, 1024px, 768px
- Mobile: 420px, 360px
- Reduced-motion: OS prefers-reduced-motion enabled

Tests
1. Default state
- Open `/booking`.
- Expected: sidebar shows expanded by default (unless user previously collapsed it).
- Action: click the collapse toggle.
- Expected: sidebar shrinks to 64px, shows icons only, labels hidden.

2. Hover-expand on desktop
- With sidebar collapsed, hover over the rail.
- Expected: rail animates to ~220px, labels appear with slide/fade, tooltips hidden while expanded.
- Action: move mouse away.
- Expected: labels hide, rail returns to 64px.

3. Keyboard accessibility
- Tab to the first nav item when rail is collapsed.
- Expected: focusing a nav item opens the rail (labels visible) and focus-visible outline shows.
- Press Enter on a nav item.
- Expected: navigation occurs to the corresponding route.

4. Tooltips
- When collapsed and not hovered, hover a nav icon.
- Expected: a tooltip appears to the right with correct label text (content from `title`).
- Verify tooltip color, padding and shadow match the spec.

5. Active state
- Navigate to each route (or simulate) and verify the corresponding nav-item has `.is-active` styling (color and subtle background).

6. Persistence
- Collapse the sidebar.
- Reload the page.
- Expected: collapsed state persists (localStorage key `bookingSidebarCollapsed`).

7. Responsive/mobile
- At small widths (<720px) verify sidebar becomes fixed overlay and does not push content off-screen.
- Verify collapsed state does not block essential content; toggle should allow opening/closing.

8. Reduced motion
- Enable `prefers-reduced-motion` and repeat hover/expand tests.
- Expected: animations disabled; rail and tooltip appear/disappear immediately.

Notes & Known issues
- If any labels overlap content on very small screens, consider changing hover-expand to show as a floating panel instead of widening the rail.

Report
- For each test, note the browser, screen size, steps, observed vs expected, and console errors if any.
