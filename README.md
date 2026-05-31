# Scroll Break

Paste text. Read it one scroll at a time.

Scroll Break is a small static React app for turning long text into a vertical, one-line reading experience. It is built for GitHub Pages.

## Local development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

## Publish to GitHub Pages

1. Create a new GitHub repository.
2. Push this project to the repository's `main` branch.
3. In GitHub, open `Settings` -> `Pages`.
4. Set `Build and deployment` to `GitHub Actions`.
5. Push to `main` again or run the `Deploy to GitHub Pages` workflow manually.

The Vite base path is derived from `GITHUB_REPOSITORY`, so the app will build correctly for a project page such as `/scroll-break/`.
