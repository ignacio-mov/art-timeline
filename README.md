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
open the enlarged view.

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
placement checks, and the bundled dataset.
