# Academic Portfolio

A clean, responsive personal portfolio for researchers and students. No build step required — just HTML, CSS, and JavaScript.

## Preview locally

Open `index.html` in your browser, or run a local server:

```bash
# Python
python3 -m http.server 8000

# Node (if you have npx)
npx serve .
```

Then visit [http://localhost:8000](http://localhost:8000).

## Customize

### 1. Personal info
Edit `index.html` and replace all placeholder text:
- Your name, title, department, and university
- About section bio
- Research interests, publications, projects, education
- Email and social profile links

### 2. Profile photo
Replace the placeholder in the hero section:

```html
<div class="hero-photo">
  <img src="assets/photo.jpg" alt="Your Name">
</div>
```

Add your image to the `assets/` folder.

### 3. CV download
Place your CV PDF at `assets/cv.pdf`, or update the link in the hero section.

### 4. Contact form
The form is a placeholder. To make it work, connect to one of:
- [Formspree](https://formspree.io) — add `action="https://formspree.io/f/YOUR_ID"` to the form
- [Netlify Forms](https://docs.netlify.com/forms/setup/) — add `netlify` attribute when deploying to Netlify

### 5. Colors & fonts
Edit the CSS variables at the top of `styles.css`:

```css
:root {
  --color-accent: #2d4a7c;
  --color-highlight: #c4a35a;
  /* ... */
}
```

## Deploy for free

- **GitHub Pages** — push to a repo, enable Pages in Settings
- **Netlify** — drag and drop the folder at [netlify.com](https://netlify.com)
- **Vercel** — import the repo at [vercel.com](https://vercel.com)

## File structure

```
├── index.html      Main page
├── styles.css      All styles
├── script.js       Navigation & interactivity
├── assets/         Photos, CV, etc.
└── README.md       This file
```
