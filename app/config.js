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
  pages: {
    review: null,     /* e.g. "https://example.org/annotator/?data=step1" */
    search: [],       /* e.g. ["https://example.org/annotator/?data=step2-p1"] */
  },
};

/* Resolves a path from the cohort against the data folder. Absolute URLs and
   paths starting with "/" are left untouched. */
export const dataUrl = p => (/^(?:[a-z]+:|\/)/i.test(p) ? p : CONFIG.dataBase + p);
