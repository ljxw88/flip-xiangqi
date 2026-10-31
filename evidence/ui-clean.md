# Board-first UI cleanup

- Before: repeated status copy, nested cards, and permanent capture prose competed with the board. After: one contextual status row, a thin board rim on the felt, and small capture icons only when needed; capture announcements remain available to screen readers. Header and mobile zoom are quieter; rooms and rules remain in the sheet.
- Android red glyphs: keep Noto Serif SC and disabled font synthesis, but use its 700 weight instead of 900 and size glyphs relative to the board rather than the viewport. River text already uses 700.
- Checked: 81 tests, production build, and Chromium desktop/mobile emulation including zoom, hotseat and two-player rooms. A real Android Chrome/Mac visual check is still recommended.
- Tailnet preview: <http://100.88.150.21:5174/> (Vite and an isolated room server in the `flip-ui-clean` tmux session; HTTP invite links may require manual copying).
