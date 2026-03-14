# Staff Quickstart

Use this app when you need to prepare a batch of sneaker images for Shopify.

## Start the app

From Terminal, run:

```bash
/Users/rohanagarwal/Documents/Playground/run-staff-app.sh
```

## Basic workflow

1. Open the app.
2. Click `Choose Input Folder` and select the batch folder.
3. Review any flagged products.
4. Confirm title, SKU, and price if needed.
5. Go to `Export`.
6. Click `Export To Folder` and choose the destination folder.

## Important defaults

- Output background is white (`#FFFFFF`).
- Images are placed on a fixed square canvas.
- The processor tries to trim supplier whitespace before placement.
- The product is aligned to a consistent lower baseline instead of being vertically centered.
- The desktop app can read a whole folder and write the output package back to disk.

## If the app does not open

Run these once from `/Users/rohanagarwal/Documents/Playground`:

```bash
npm install
source "$HOME/.cargo/env"
```

Then try the launcher again.
