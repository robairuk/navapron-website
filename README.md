# NavApron Website

Official landing page for **NavApron** — free desktop taxi chart companion for Microsoft Flight Simulator.

## Files

- `index.html` — main page (hero, features, how it works, testimonials, changelog, feedback, download)
- `styles.css` — aviation-themed dark design
- `script.js` — mobile menu + light scroll behaviour
- `logo.png` — official NavApron logo (header, footer & favicon)

## Cheapest hosting (recommended)

### Option 1 — GitHub Pages (completely free)

1. Create a new GitHub repository (e.g. `navapron` or `navapron-website`).
2. Upload **all four files** to the root of the repo (or put them in a `/docs` folder).
3. Go to **Settings → Pages**.
4. Under “Source”, choose **Deploy from a branch** → `main` (or `docs` folder).
5. Save. Your site will be live at `https://YOURUSERNAME.github.io/navapron/` (or a custom domain later).

### Option 2 — Cloudflare Pages (also free)

1. Push the folder to a GitHub repo.
2. Log in to Cloudflare → Pages → Create project → Connect the repo.
3. Build settings: leave empty (static site). Deploy.

### Option 3 — Netlify Drop (fastest, no Git required)

1. Go to [https://app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `navapron-website` folder onto the page.
3. Instant free URL. You can later claim it and connect a custom domain.

## Before you publish

1. **Download link**  
   In `index.html`, replace the two `https://flightsim.to/` links with the exact NavApron page URL on flightsim.to.

2. **Feedback form**  
   - Go to [formspree.io](https://formspree.io) and create a free form.  
   - Replace `YOUR_FORM_ID` in the form `action` attribute with the ID Formspree gives you.  
   - Or change the form to a simple `mailto:` if you prefer.

3. **Testimonials**  
   The three quotes are placeholders. Replace them with real feedback once you have it (or remove the section).

4. **Changelog**  
   Update the version / date / bullet points as you release new builds.

5. **Optional custom domain**  
   Both GitHub Pages and Cloudflare Pages support free custom domains (you only pay for the domain itself).

## Local preview

Just open `index.html` in any modern browser, or run a tiny local server:

```bash
npx serve .
```

That’s it — zero cost to host and easy to expand later (add a blog, screenshots gallery, etc.).
