# ROHM explorer

Interactive explorer of the Reduced Order Hysteretic Magnetization (ROHM) model, as a self-contained
`<rohm-explorer>` web component.

**Generated from the `rohm-model` repository (`web/explorer/`) by `web/sync.sh`. Do not edit here.**

Usage in a page:

```html
<rohm-explorer></rohm-explorer>
<script type="module" src="rohm-lts/explorer/rohm-explorer.js"></script>
```

- `rohm-explorer.js`: the element (renders in a shadow root; styles in `explorer.css` apply only there)
- `model/rohm.js`: JavaScript port of `ROHM_S_Chain.py` and `ROHM_CS_Chain.py`
- `ui/plot.js`: canvas plots
- `ui/cells.js`: animated cell view
- `ui/params.js`: custom values table
- `ui/tour.js`: content of the "Learn step by step" panel
- `data/`: model presets and field-dependent scaling functions

No third-party code, no request outside this folder.
