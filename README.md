# julien-dular.github.io

Personal website of Julien Dular, served with GitHub Pages at [julien-dular.github.io](https://julien-dular.github.io).

Plain HTML, CSS and JavaScript — no build step.

## Preview locally

The publication lists are loaded from a YAML file with `fetch`, so the site must be served over HTTP (opening `index.html` directly won't load them):

```bash
python3 -m http.server 8000
```

Then visit [http://localhost:8000](http://localhost:8000).

## Structure

```
├── index.html             Home page (about, projects, main publications, contact)
├── publications.html      Full publication list
├── projects/              One page per project
│   ├── rohm-lts/explorer/ ROHM explorer module, copied from rohm-model/web by sync.sh (do not edit here)
│   └── nonlinear-iterations/explorer/  Nonlinear iterations explorer, copied from nonlinear-iterations/web by sync.sh (do not edit here)
├── data/publications.yaml Publication data (source for both publication views)
├── publications.js        Loads and renders data/publications.yaml
├── script.js              Home page scripts (nav, scroll highlight)
├── publications-page.js   Publications page scripts
├── project-page.js        Project page scripts
├── styles.css             All styles
└── assets/                Photo and icons
    ├── fonts/             Self-hosted web fonts (Crimson Pro, Source Sans 3) and their licenses
    └── vendor/            Third-party scripts (js-yaml, MIT)
```

The site loads no resources from third-party servers (fonts and scripts are served from this repository), so visitors' IP addresses are not shared with Google or CDNs.

## Editing publications

Edit `data/publications.yaml`. Entries are grouped by category (`first-author`, `co-author`, `oral-presentations`, `posters`). Set `main: true` on an entry to show it in the "Main Publications" section of the home page. Optional `links` (list of `label` / `url`) are rendered as buttons under the entry.

## Adding a project

1. Copy an existing page in `projects/` and edit its content.
2. Add a card to the Projects section of `index.html`.
3. Add the page to the Projects dropdown in the nav of `index.html` and of every page in `projects/`.
