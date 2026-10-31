# Art Timeline

Art Timeline is a browser game for placing famous artworks in chronological
order. The interface and game instructions are in Spanish.

## Play locally

The game loads its artwork dataset with `fetch`, so serve the project over
HTTP rather than opening `index.html` directly. With Python installed, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser. Select a gap in the timeline or
drag the current artwork into place. Correct placements increase your score;
the best score is saved in browser local storage. Select an artwork image to
open the enlarged view. Artworks whose images fail to load are automatically
skipped without affecting your progress.

Artwork records are loaded from `artworks.json`. If the dataset cannot be
loaded, the game uses a small built-in fallback set. Images are loaded from
their remote URLs. The JSON dataset is downloaded from Wikidata.

## Tests

The project uses Node.js's built-in test runner and has no package dependencies.
Use Node.js 18 or later, then run:

```sh
npm test
```

The tests cover artwork normalization, year formatting, chronological
placement checks, and required fields in every bundled dataset record. GitHub
Actions runs them on pushes and pull requests.

## Game settings

The browser game settings are in
[`game-config.json`](./game-config.json):

- `updateCheckIntervalMs` controls how often the game checks for a deployed
  update, in milliseconds. The default `300000` is five minutes.
- `wikimediaImageWidth` controls the requested width, in pixels, for Wikimedia
  file images. The default is `900`.

Both settings must be positive integers. The game checks this config for
deployed changes along with its other resources.

## Refresh the artwork dataset

To check for updated Wikidata records, open the repository's **Actions** tab,
select **Refresh artwork dataset**, and choose **Run workflow**. The workflow
opens a pull request with any changes to `artworks.json`; review and merge it to
publish the update. The refresh is manual so it won't unexpectedly change the
game's content. In repository settings, allow GitHub Actions to create pull
requests so the workflow can open its update PR.

Refresh settings live in
[`scripts/refresh-artworks.config.json`](./scripts/refresh-artworks.config.json):

- `artworkLimit` sets the maximum number of complete artworks written.
- `candidateLimit` sets how many popular painting candidates Wikidata checks;
  keep this at least as large as `artworkLimit`.
- `labelLanguages` sets the preferred label languages in order (for example,
  `["es", "en"]`).

Edit the config and run the workflow again to use the new values. The workflow
can return fewer than `artworkLimit` records if Wikidata has fewer candidates
with all required fields.
