/* ===========================================================================
   Configuration of a deployment
   ---------------------------------------------------------------------------
   Everything that depends on WHERE the annotator runs lives here, so that
   app.js stays identical between deployments.

   dataBase  Folder holding the cohort built by tools/build_cohort.py
             (cohorte.json, atlas/, ctx/, champs/). The URL parameter
             `?data=<name>` selects `data/<name>/`; default: the demo cohort.
   author    Reader ID of the study author. That reader gets the author-only
             tools (practice slabs, tutorial picker, result collection).
   pages     Optional links between the pages of a two-step campaign
             (step 1 = review candidates, step 2 = search missed objects).
             Leave `review: null` and `search: []` for a single-page setup:
             the step links and the hand-off dialog are then hidden.
   ======================================================================== */
const params = new URLSearchParams(location.search);
const dataName = (params.get("data") || "demo").replace(/[^A-Za-z0-9_-]/g, "");

export const CONFIG = {
  dataBase: `data/${dataName}/`,
  author: params.get("author") || "author",
  /* Demo: step 1 = review of detected candidates, step 2 = search tiles.
     Relative links, so they work locally and on GitHub Pages alike.
     Set `review: null, search: []` for a single-page deployment. */
  pages: {
    review: "?data=demo",
    search: ["?data=demo-search"],
  },
};

/* Resolves a path from the cohort against the data folder. Absolute URLs and
   paths starting with "/" are left untouched. */
export const dataUrl = p => (/^(?:[a-z]+:|\/)/i.test(p) ? p : CONFIG.dataBase + p);
