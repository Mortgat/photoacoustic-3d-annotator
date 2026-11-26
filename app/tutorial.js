/* Tutoriel.

   Ce qu'il enseigne : l'outil, le vocabulaire, et les pieges de la modalite.
   Ce qu'il n'enseigne PAS : la bonne reponse. La campagne mesure les endroits
   ou un lecteur et la regle automatique divergent ; un tutoriel qui montrerait
   les verdicts de la regle apprendrait aux lecteurs a la reproduire.

   Principe de redaction, demande par l'utilisateur : donner des CLES de
   comprehension, claires et breves. Plus on en dit, plus on sature le lecteur
   et plus on degrade son intuition. Chaque ecran suit donc le meme gabarit :
   une phrase d'entree, deux a cinq points qui commencent par un mot-cle en
   gras, au plus un encadre. Les figures ne portent que des etiquettes courtes :
   les phrases longues debordaient du cadre, en anglais comme en japonais. */

const G = {
  ink: "#cfdae3", dim: "#7d8f9d", faint: "#3a4854",
  hair: "#3fd45c", vessel: "#f2655f", noise: "#f5a23c",
  mark: "#7fd4f5", other: "#8395a3", skin: "#d8c9a3", real: "#e8eef3",
  add: "#f2c14e", cut: "#b14bff", partB: "#f78fb3",
  signal: "#e9dcc4", shape: "#a8703a",
};
/* Le bruit n'est pas un semis de points : ce sont de petites formes difformes,
   plus grosses qu'un voxel, sans direction. */
const blob = (x, y, k, fill) => `<path transform="translate(${x},${y}) scale(${k})"
  d="M-6 -2 C-7 -7 -1 -9 3 -6 C8 -4 8 1 5 4 C3 8 -3 7 -5 4 C-8 2 -7 0 -6 -2 Z" fill="${fill}"/>`;
const blob2 = (x, y, k, fill) => `<path transform="translate(${x},${y}) scale(${k})"
  d="M-5 -4 C-2 -8 5 -6 6 -2 C7 1 3 2 4 5 C4 8 -2 7 -4 4 C-7 2 -8 -1 -5 -4 Z" fill="${fill}"/>`;
/* Le vrai signal, dessine au pinceau : un trait large, irregulier, dans une
   couleur a lui. Le contour detecte (bleu) se pose par-dessus. */
const brush = (d, w) => `
  <path d="${d}" fill="none" stroke="${G.signal}" stroke-width="${w + 5}" stroke-linecap="round" opacity=".18"/>
  <path d="${d}" fill="none" stroke="${G.signal}" stroke-width="${w}" stroke-linecap="round" opacity=".55"
        stroke-dasharray="2 1.5 6 1 3 2"/>`;
/* Bulbe : a la base d'un poil, un arrondi a peine plus large que le trait. Il
   n'est pas toujours visible a l'acquisition — d'ou l'asterisque des figures. */
const bulb = (x, y, fill, w = 5) => `<ellipse cx="${x}" cy="${y}" rx="${w * 0.78}" ry="${w * 0.95}" fill="${fill}"/>`;
const txt = (x, y, s, fill, size = 12, anchor = "start", weight = 400) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" font-family="IBM Plex Sans, Noto Sans JP, sans-serif" text-anchor="${anchor}">${s}</text>`;

/* --- 1. la forme a juger, parmi d'autres ------------------------------------- */
const figShapes = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yShapes}">
  <g transform="translate(70,40)">
    <path d="M0 40 L110 0 L232 34 L122 78 Z" fill="${G.faint}" opacity=".5" stroke="${G.dim}" stroke-width="1.2"/>
    <path d="M0 40 L0 172 L122 212 L122 78 Z" fill="${G.faint}" opacity=".3" stroke="${G.dim}" stroke-width="1.2"/>
    <path d="M122 78 L232 34 L232 168 L122 212 Z" fill="${G.faint}" opacity=".18" stroke="${G.dim}" stroke-width="1.2"/>
    <path d="M6 66 Q 60 56 122 84 T 228 62" fill="none" stroke="${G.skin}" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="M30 130 Q 70 120 96 150" fill="none" stroke="${G.shape}" stroke-width="6" stroke-linecap="round" opacity=".85"/>
    <path d="M172 58 L182 110" fill="none" stroke="${G.shape}" stroke-width="6" stroke-linecap="round" opacity=".85"/>
    <path d="M100 38 L114 96 L120 146" fill="none" stroke="${G.mark}" stroke-width="8" stroke-linecap="round"/>
  </g>
  ${txt(212, 188, t.toJudge, G.mark, 13, "start", 600)}
  <line x1="208" y1="184" x2="194" y2="170" stroke="${G.mark}" stroke-width="1.2"/>
  ${txt(40, 268, t.otherShapes, G.shape, 12)}
  <line x1="92" y1="256" x2="116" y2="196" stroke="${G.shape}" stroke-width="1.2"/>
  ${txt(300, 100, t.skinEst, G.skin, 11.5)}
  ${txt(200, 292, "≈ 2.5 × 2.6 × 2.5 mm", G.dim, 10.5, "middle")}
</svg>`;

/* --- 2. ce qui se voit ------------------------------------------------------- */
const figAnatomy = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yAnatomy}">
  <path d="M0 110 Q 100 102 200 108 T 400 106 L400 300 L0 300 Z" fill="${G.faint}" opacity=".35"/>
  <path d="M0 110 Q 100 102 200 108 T 400 106" fill="none" stroke="${G.skin}" stroke-width="2.5"/>
  ${txt(8, 100, t.skin, G.skin, 12)}
  <path d="M120 30 L140 108 L150 150" fill="none" stroke="${G.hair}" stroke-width="5" stroke-linecap="round"/>
  <path d="M170 24 L190 106 L200 148" fill="none" stroke="${G.hair}" stroke-width="5" stroke-linecap="round"/>
  <path d="M222 36 L240 106 L248 140" fill="none" stroke="${G.hair}" stroke-width="5" stroke-linecap="round"/>
  ${bulb(150, 151, G.hair)}${bulb(200, 149, G.hair)}${bulb(248, 141, G.hair)}
  ${txt(392, 294, t.bulbNote, G.dim, 10.5, "end")}
  ${txt(254, 44, t.hairs, G.hair, 13, "start", 600)}
  ${txt(254, 60, t.sameWay, G.dim, 11)}
  <path d="M10 142 Q 120 132 220 144 T 390 140" fill="none" stroke="${G.vessel}" stroke-width="6" stroke-linecap="round" opacity=".9"/>
  <path d="M250 142 Q 272 196 312 220 T 360 272" fill="none" stroke="${G.vessel}" stroke-width="5" stroke-linecap="round" opacity=".9"/>
  <path d="M312 220 Q 290 250 262 280" fill="none" stroke="${G.vessel}" stroke-width="4" stroke-linecap="round" opacity=".9"/>
  ${txt(14, 170, t.vessel, G.vessel, 13, "start", 600)}
  ${txt(14, 186, t.flatNearSurface, G.dim, 11)}
  <g opacity=".9">${blob(64, 236, 1.3, G.noise)}${blob2(92, 252, 1.1, G.noise)}${blob(40, 262, 0.9, G.noise)}</g>
  ${txt(118, 250, t.noise, G.noise, 13, "start", 600)}
</svg>`;

/* --- 3. la peau : la surface tracee est decalee, pas ondulee ------------------
   Deux cas, cote a cote. La surface reelle est la surface tracee DECALEE et
   legerement inclinee : c'est l'erreur typique, trop haut ou trop bas — non une
   ondulation, que la version precedente suggerait a tort. */
const skinPanel = (dx, title, drawnY, realY, tilt, hairPath, t, bulbX, bulbY) => `
  <g transform="translate(${dx},0)">
    ${txt(95, 22, title, G.ink, 12, "middle", 600)}
    <rect x="4" y="34" width="182" height="200" rx="7" fill="${G.faint}" opacity=".28" stroke="${G.dim}" stroke-width="1"/>
    <line x1="8" y1="${realY - tilt}" x2="182" y2="${realY + tilt}" stroke="${G.real}" stroke-width="2"/>
    <line x1="8" y1="${drawnY}" x2="182" y2="${drawnY}" stroke="${G.skin}" stroke-width="2" stroke-dasharray="7 4"/>
    <path d="${hairPath}" fill="none" stroke="${G.mark}" stroke-width="7" stroke-linecap="round"/>
    ${bulb(bulbX, bulbY, G.mark, 7)}
  </g>`;
const figSkin = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11ySkin}">
  ${skinPanel(8, t.hairAbove, 196, 128, 8, "M90 60 L98 118 L102 150", t, 102, 151)}
  ${skinPanel(204, t.hairBelow, 82, 150, -7, "M86 86 L94 150 L98 176", t, 98, 177)}
  <line x1="40" y1="262" x2="70" y2="262" stroke="${G.skin}" stroke-width="2" stroke-dasharray="7 4"/>
  ${txt(78, 266, t.drawn, G.skin, 12)}
  <line x1="218" y1="262" x2="248" y2="262" stroke="${G.real}" stroke-width="2"/>
  ${txt(256, 266, t.real, G.real, 12)}
  ${txt(200, 290, t.bulbNote, G.dim, 10.5, "middle")}
</svg>`;

/* --- 4. deux vues -------------------------------------------------------------- */
const figViews = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yViews}">
  ${txt(100, 26, t.volume, G.ink, 12, "middle", 600)}
  <rect x="14" y="36" width="172" height="200" rx="8" fill="${G.faint}" opacity=".35" stroke="${G.dim}" stroke-width="1"/>
  <path d="M74 84 L96 140 L108 196" fill="none" stroke="${G.mark}" stroke-width="9" stroke-linecap="round" opacity=".9"/>
  <g transform="translate(40,196)">
    <line x1="0" y1="0" x2="0" y2="-34" stroke="#3b82d6" stroke-width="2.6"/><path d="M0 -40 l-5 8 l10 0 z" fill="#3b82d6"/>
    ${txt(8, -30, "Z", "#3b82d6", 12, "start", 600)}
    <line x1="0" y1="0" x2="34" y2="0" stroke="#e05545" stroke-width="2.6"/><path d="M40 0 l-8 -5 l0 10 z" fill="#e05545"/>
    ${txt(30, 16, "X", "#e05545", 12, "start", 600)}
  </g>
  <path d="M44 222 A 60 60 0 0 1 156 222" fill="none" stroke="${G.dim}" stroke-width="1.4" stroke-dasharray="3 4"/>
  <path d="M156 222 l-9 -5 l1 9 z" fill="${G.dim}"/>
  ${txt(100, 256, t.dragRotate, G.dim, 11, "middle")}
  ${txt(300, 26, t.projection, G.ink, 12, "middle", 600)}
  <rect x="214" y="36" width="172" height="200" rx="8" fill="${G.faint}" opacity=".35" stroke="${G.dim}" stroke-width="1"/>
  <g stroke="${G.ink}" stroke-width="2.4" fill="none" opacity=".45" stroke-linecap="round">
    <path d="M232 70 L250 120"/><path d="M262 60 L280 116"/><path d="M340 64 L352 120"/>
    <path d="M236 170 L256 214"/><path d="M350 160 L364 214"/><path d="M318 190 L330 222"/>
  </g>
  <rect x="276" y="112" width="48" height="48" fill="none" stroke="${G.mark}" stroke-width="2"/>
  <path d="M292 122 L300 150" stroke="${G.mark}" stroke-width="5" stroke-linecap="round"/>
  ${txt(300, 256, t.zoomOut, G.dim, 11, "middle")}
  ${txt(334, 108, t.theBlock, G.mark, 11)}
</svg>`;

/* --- 5. trois natures, et un doute qui s'y ajoute -------------------------------- */
const natCell = (x, label, colour, draw) => `
  <g transform="translate(${x},0)">
    <rect x="0" y="40" width="88" height="150" rx="7" fill="${G.faint}" opacity=".32" stroke="${G.dim}" stroke-width="1"/>
    <line x1="4" y1="84" x2="84" y2="84" stroke="${G.skin}" stroke-width="1.6" stroke-dasharray="5 3" opacity=".8"/>
    ${draw}
    ${txt(44, 28, label, colour, 13, "middle", 600)}
  </g>`;
const figNature = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yNature}">
  <g transform="translate(56,14)">
    ${natCell(0, t.hair, G.hair, `<path d="M36 50 L44 110 L48 168" fill="none" stroke="${G.hair}" stroke-width="6" stroke-linecap="round"/>${bulb(48, 169, G.hair, 6)}`)}
    ${natCell(100, t.vessel, G.vessel, `<path d="M8 122 Q 40 110 62 128 T 82 134" fill="none" stroke="${G.vessel}" stroke-width="7" stroke-linecap="round"/><path d="M40 118 Q 48 148 66 168" fill="none" stroke="${G.vessel}" stroke-width="5" stroke-linecap="round"/>`)}
    ${natCell(200, t.noise, G.noise, `${blob(34, 118, 1.2, G.noise)}${blob2(58, 136, 1.0, G.noise)}`)}
  </g>
  ${txt(200, 224, "+", G.dim, 18, "middle", 600)}
  <g transform="translate(120,236)">
    <rect x="0" y="0" width="160" height="30" rx="7" fill="none" stroke="${G.other}" stroke-width="1.5" stroke-dasharray="5 3"/>
    <rect x="14" y="9" width="12" height="12" rx="2" fill="none" stroke="${G.other}" stroke-width="1.6"/>
    <path d="M16.5 15 l3 3 l5 -6" fill="none" stroke="${G.other}" stroke-width="1.8" stroke-linecap="round"/>
    ${txt(36, 20, t.notSure, G.other, 12.5, "start", 600)}
  </g>
  ${txt(200, 288, t.notSureNote, G.dim, 11, "middle")}
</svg>`;

/* --- 6. la fusion la plus courante : un vaisseau sous un poil ------------------- */
const figMerge = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yMerge}">
  <path d="M0 120 Q 120 114 240 120 T 400 118 L400 300 L0 300 Z" fill="${G.faint}" opacity=".32"/>
  <path d="M0 120 Q 120 114 240 120 T 400 118" fill="none" stroke="${G.skin}" stroke-width="2" stroke-dasharray="7 4"/>
  ${txt(8, 110, t.skin, G.skin, 11.5)}
  <path d="M40 188 Q 150 172 230 186 T 380 182" fill="none" stroke="#5a6b78" stroke-width="16" stroke-linecap="round"/>
  <path d="M176 36 L190 118 L200 176" fill="none" stroke="#5a6b78" stroke-width="15" stroke-linecap="round"/>
  <path d="M40 188 Q 150 172 230 186 T 380 182" fill="none" stroke="${G.mark}" stroke-width="10" stroke-linecap="round"/>
  <path d="M176 36 L190 118 L200 176" fill="none" stroke="${G.mark}" stroke-width="10" stroke-linecap="round"/>
  <line x1="178" y1="166" x2="222" y2="160" stroke="${G.cut}" stroke-width="4" stroke-dasharray="5 3"/>
  ${txt(212, 50, t.hair, G.hair, 13, "start", 600)}
  ${txt(300, 214, t.vessel, G.vessel, 13, "start", 600)}
  ${txt(234, 150, t.cutHere, G.cut, 12, "start", 600)}
  ${txt(200, 262, t.oneOutline, G.mark, 12, "middle")}
</svg>`;

/* --- 6. les trois etats du contour, sur un signal dessine au pinceau -------- */
const supCell = (x, label, colour, draw, caption) => `
  <g transform="translate(${x},0)">
    <rect x="0" y="34" width="120" height="150" rx="7" fill="${G.faint}" opacity=".32" stroke="${G.dim}" stroke-width="1"/>
    <line x1="4" y1="80" x2="116" y2="80" stroke="${G.skin}" stroke-width="1.4" stroke-dasharray="5 3" opacity=".7"/>
    ${draw}
    ${txt(60, 24, label, colour, 13, "middle", 600)}
    ${txt(60, 204, caption, G.dim, 10.5, "middle")}
  </g>`;
const figSupport = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11ySupport}">
  <g transform="translate(14,20)">
    ${supCell(0, t.correct, "#9fb1bd",
      `${brush("M52 48 L60 110 L64 168", 9)}
       <path d="M52 48 L60 110 L64 168" fill="none" stroke="${G.mark}" stroke-width="4" stroke-linecap="round"/>${bulb(64, 169, G.signal, 6)}`,
      t.capCorrect)}
    ${supCell(128, t.incorrect, "#5faccd",
      `${brush("M50 44 L60 110 L66 172", 9)}${bulb(66, 173, G.signal, 6)}
       <path d="M55 76 L60 110 L63 146" fill="none" stroke="${G.mark}" stroke-width="4" stroke-linecap="round"/>`,
      t.capIncorrect)}
    ${supCell(256, t.merged, "#f5a23c",
      `${brush("M8 150 Q 50 138 76 150 T 116 146", 10)}${brush("M58 46 L64 104 L68 146", 8)}
       <path d="M8 150 Q 50 138 76 150 T 116 146" fill="none" stroke="${G.mark}" stroke-width="4" stroke-linecap="round"/>
       <path d="M58 46 L64 104 L68 146" fill="none" stroke="${G.mark}" stroke-width="4" stroke-linecap="round"/>`,
      t.capMerged)}
  </g>
  <line x1="60" y1="270" x2="92" y2="270" stroke="${G.signal}" stroke-width="8" stroke-linecap="round" opacity=".55"/>
  ${txt(100, 274, t.realSignal, G.signal, 12)}
  <line x1="222" y1="270" x2="254" y2="270" stroke="${G.mark}" stroke-width="4" stroke-linecap="round"/>
  ${txt(262, 274, t.detected, G.mark, 12)}
</svg>`;

/* --- 7. comment on corrige, en voxels ----------------------------------------
   Ce que le lecteur voit en mode Blocs : une grille de cubes. A gauche, un
   contour incomplet qu'on prolonge (jaune) et dont on retire l'exces (cage
   rouge). A droite, une fusion qu'on coupe (violet) en deux parties, chacune
   de sa couleur, chacune avec sa nature. */
const cell = (x, y, fill, cage) => cage
  ? `<rect x="${x + 1.5}" y="${y + 1.5}" width="13" height="13" fill="none" stroke="#eb382e" stroke-width="1.8"/>`
  : `<rect x="${x + 1}" y="${y + 1}" width="14" height="14" rx="1.5" fill="${fill}"/>`;
const figCorrect = t => {
  const left = [], right = [];
  // gauche : poil oblique ; le contour detecte en couvre le milieu seulement
  const hair = [[3,1],[3,2],[4,3],[4,4],[4,5],[5,6],[5,7],[5,8],[6,9],[6,10]];
  hair.forEach(([c, r], i) => {
    const kind = i < 2 || i > 8 ? "add" : "cand";
    left.push(cell(18 + c * 16, 34 + r * 16, kind === "add" ? G.add : G.mark));
  });
  left.push(cell(18 + 6 * 16, 34 + 5 * 16, null, true), cell(18 + 7 * 16, 34 + 5 * 16, null, true));
  // droite : poil vertical + vaisseau horizontal, un seul contour ; une coupe
  const vert = [[4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6]];
  const horiz = [[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,8],[7,8],[8,8]];
  vert.forEach(([c, r]) => right.push(cell(212 + c * 16, 34 + r * 16, G.mark)));
  right.push(cell(212 + 4 * 16, 34 + 7 * 16, G.cut));
  horiz.forEach(([c, r]) => right.push(cell(212 + c * 16, 34 + r * 16, G.partB)));
  return `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yCorrect}">
  ${txt(100, 22, t.incorrectFix, G.ink, 12, "middle", 600)}
  ${left.join("")}
  ${txt(300, 22, t.mergedFix, G.ink, 12, "middle", 600)}
  ${right.join("")}
  <g transform="translate(14,238)">
    ${cell(0, 0, G.mark)}${txt(20, 12, t.kept, G.dim, 11)}
    ${cell(96, 0, G.add)}${txt(116, 12, t.added, G.dim, 11)}
    ${cell(192, 0, null, true)}${txt(212, 12, t.removed, G.dim, 11)}
    ${cell(288, 0, G.cut)}${txt(308, 12, t.cutMark, G.dim, 11)}
  </g>
  ${txt(300, 206, t.twoParts, G.partB, 11, "middle")}
</svg>`;
};

/* --- 8. corriger d'abord dans la projection ----------------------------------
   Une grille de colonnes vue du dessus : le contour detecte (bleu) deborde du
   signal (pinceau) d'un cote et en manque un bout de l'autre. Erase efface les
   colonnes en trop, l'ajout de colonne rallonge le contour la ou le signal
   continue. */
const figColumns = t => {
  const sig = [[2,1],[3,2],[3,3],[4,4],[5,5],[5,6],[6,7],[7,8],[7,9]];
  const det = [[3,2],[3,3],[4,4],[5,5],[5,6],[6,7],[6,8],[5,8]];
  const erase = [[6,8],[5,8]];
  const add = [[2,1],[7,8],[7,9]];
  const at = (c, r, dx) => [26 + dx + c * 17, 40 + r * 17];
  const panel = (dx, fixed) => {
    const out = [];
    for (let r = 0; r < 11; r++) for (let c = 0; c < 10; c++) {
      const [x, y] = at(c, r, dx);
      out.push(`<rect x="${x}" y="${y}" width="16" height="16" fill="#1c2630"/>`);
    }
    for (const [c, r] of sig) { const [x, y] = at(c, r, dx); out.push(`<rect x="${x}" y="${y}" width="16" height="16" fill="${G.signal}" opacity=".55"/>`); }
    const kept = fixed ? det.filter(([c, r]) => !erase.some(e => e[0] === c && e[1] === r)) : det;
    for (const [c, r] of kept) { const [x, y] = at(c, r, dx); out.push(`<rect x="${x + 3}" y="${y + 3}" width="10" height="10" rx="2" fill="${G.mark}"/>`); }
    if (fixed) {
      for (const [c, r] of erase) { const [x, y] = at(c, r, dx); out.push(`<rect x="${x + 1.5}" y="${y + 1.5}" width="13" height="13" fill="none" stroke="#eb382e" stroke-width="1.8"/>`); }
      for (const [c, r] of add) { const [x, y] = at(c, r, dx); out.push(`<rect x="${x + 3}" y="${y + 3}" width="10" height="10" rx="2" fill="${G.add}"/>`); }
    }
    return out.join("");
  };
  return `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yColumns}">
  ${txt(110, 26, t.before, G.ink, 12, "middle", 600)}
  ${txt(306, 26, t.after, G.ink, 12, "middle", 600)}
  ${panel(0, false)}${panel(196, true)}
  <path d="M200 134 l12 0 m-5 -5 l5 5 l-5 5" stroke="${G.dim}" stroke-width="1.6" fill="none"/>
  <g transform="translate(26,242)">
    <rect x="0" y="0" width="14" height="14" fill="${G.signal}" opacity=".55"/>${txt(20, 12, t.realSignal, G.dim, 11)}
    <rect x="112" y="2" width="10" height="10" rx="2" fill="${G.mark}"/>${txt(130, 12, t.detected, G.dim, 11)}
    <rect x="236" y="1" width="13" height="13" fill="none" stroke="#eb382e" stroke-width="1.8"/>${txt(256, 12, t.erasedCol, G.dim, 11)}
  </g>
  <g transform="translate(26,264)">
    <rect x="0" y="2" width="10" height="10" rx="2" fill="${G.add}"/>${txt(20, 12, t.addedCol, G.dim, 11)}
  </g>
</svg>`;
};

/* --- figures reelles : rendus de l'annotateur sur de vraies donnees ------------ */
const figImages = (items, t, title) => `
<div class="fig-real n-${items.length}">
${title ? `<p class="fig-title">${t[title]}</p>` : ""}
<div class="fig-grid fig-${items.length}">
  ${items.map(([file, cap]) => `<figure><img src="${file}" alt="${t[cap]}" loading="lazy"><figcaption>${t[cap]}</figcaption></figure>`).join("")}
</div>
</div>`;

const T = {
  en: {
    a11yShapes: "A block with the shape to judge and other detected shapes",
    a11yAnatomy: "Hairs, a vessel and noise near the skin",
    a11ySkin: "The drawn skin surface is shifted from the real one",
    a11yViews: "The volume view and the projection view",
    a11yNature: "Hair, vessel or noise, plus a Not sure mark",
    a11yMerge: "A vessel passing under a hair, detected as one shape",
    toJudge: "the shape to judge", otherShapes: "other detected shapes", skinEst: "skin (estimated)",
    skin: "skin", hairs: "hairs", sameWay: "often point the same way", hair: "hair",
    vessel: "vessel", flatNearSurface: "flat near the surface", noise: "noise",
    hairAbove: "Hair above the drawn skin", hairBelow: "Hair below the drawn skin",
    drawn: "drawn surface", real: "real surface",
    volume: "Volume", projection: "Projection", dragRotate: "drag to rotate",
    zoomOut: "scroll to zoom out", theBlock: "the block",
    notSure: "Not sure", notSureNote: "tick it in addition to a nature",
    cutHere: "cut here", oneOutline: "one outline, two objects",
    realHair: "Hair", realVessel: "Vessel", realNoise: "Noise",
    realAbove: "Hair above the drawn skin", realCross: "Vessel crossing the drawn skin",
    realMerged: "Detected: one outline", realCut: "Corrected: cut (violet), trimmed (red), part B",
    realTitle: "Synthetic examples (phantom), not part of the blocks you will read",
    realMipBefore: "Before", realMipAfter: "After: columns erased, one cut",
    realColsBefore: "Before: the bright tip is missed", realColsAfter: "After: columns added",
    bulbNote: "* bulb, not always visible in the scan",
    realAdd: "Added voxels, in yellow", realRemoved: "Removed voxels, red cages",
    realSteps: "The annotator, with the Steps panel",
    a11ySupport: "Leave as is, fix the outline, several objects — over the real signal",
    a11yCorrect: "Correcting an outline voxel by voxel, and cutting a merge",
    correct: "leave as is", incorrect: "fix the outline", merged: "several objects",
    capCorrect: "outline follows the signal", capIncorrect: "the ends are missed",
    capMerged: "vessel under a hair",
    realSignal: "real signal", detected: "detected shape",
    incorrectFix: "Fix the outline — extend and trim", mergedFix: "Several objects — cut",
    kept: "detected", added: "added", removed: "removed", cutMark: "cut",
    twoParts: "each part gets its own nature",
    a11yColumns: "Correcting the outline in the projection: erase and add columns",
    before: "Before", after: "After, in the projection",
    erasedCol: "column erased", addedCol: "column added (brightest voxel touching the shape)",
    realVolume: "Volume, in profile", realMip: "Projection of the same block", realMipOut: "Zoomed out: the square is the block",
  },
  ja: {
    a11yShapes: "判定する形と、他の検出された形を含むブロック",
    a11yAnatomy: "皮膚付近の毛・血管・ノイズ",
    a11ySkin: "描かれた皮膚表面は実際の表面からずれている",
    a11yViews: "ボリューム表示と投影表示",
    a11yNature: "毛・血管・ノイズと、確信なしの印",
    a11yMerge: "毛の下を通る血管が、1つの形として検出された例",
    toJudge: "判定する形", otherShapes: "他の検出された形", skinEst: "皮膚（推定）",
    skin: "皮膚", hairs: "毛", sameWay: "近くの毛は同じ向き", hair: "毛",
    vessel: "血管", flatNearSurface: "表面近くでは平ら", noise: "ノイズ",
    hairAbove: "描かれた皮膚より上の毛", hairBelow: "描かれた皮膚より下の毛",
    drawn: "描かれた表面", real: "実際の表面",
    volume: "ボリューム", projection: "投影", dragRotate: "ドラッグで回転",
    zoomOut: "ホイールで縮小", theBlock: "ブロック",
    notSure: "確信なし", notSureNote: "種類に加えて付ける印",
    cutHere: "ここで切断", oneOutline: "1つの領域に2つの物体",
    realHair: "毛", realVessel: "血管", realNoise: "ノイズ",
    realAbove: "描かれた皮膚より上の毛", realCross: "描かれた皮膚を横切る血管",
    realMerged: "検出：1つの領域", realCut: "修正後：切断（紫）、削除（赤）、部分 B",
    realTitle: "合成データ（ファントム）の例：判定対象のブロックではありません",
    realMipBefore: "修正前", realMipAfter: "修正後：列を消去し、1か所で切断",
    realColsBefore: "修正前：明るい先端が欠けている", realColsAfter: "修正後：列を追加",
    bulbNote: "＊ 毛球（スキャンで見えないこともあります）",
    realAdd: "追加したボクセル（黄）", realRemoved: "除去したボクセル（赤い枠）",
    realSteps: "手順パネルを開いた注釈画面",
    a11ySupport: "実際の信号の上に描いた、このまま・領域を修正・複数の物体の例",
    a11yCorrect: "ボクセル単位の修正と、融合の切断",
    correct: "このまま", incorrect: "領域を修正", merged: "複数の物体",
    capCorrect: "領域が信号に沿っている", capIncorrect: "端が欠けている",
    capMerged: "毛の下を通る血管",
    realSignal: "実際の信号", detected: "検出された形",
    incorrectFix: "領域を修正 — 延長と削除", mergedFix: "複数の物体 — 切断",
    kept: "検出", added: "追加", removed: "除去", cutMark: "切断",
    twoParts: "各部分に種類を指定",
    a11yColumns: "投影上での領域修正：列の消去と追加",
    before: "修正前", after: "投影上で修正後",
    erasedCol: "列を消去", addedCol: "列を追加（形に接する最も明るいボクセル）",
    realVolume: "ボリューム（横から）", realMip: "同じブロックの投影", realMipOut: "縮小表示：四角がブロック",
  },
};

/* Rendus reels, produits par le banc a partir de l'annotateur lui-meme, sur des
   composantes qui ne font PAS partie de la cohorte mesuree (4261, et des
   composantes source non tirees). Une dalle montree ici ne pourrait plus etre
   lue en aveugle. La liste est lue par `figure` ; si un fichier manque, la
   figure schematique prend le relais. */
export const REAL = {
  nature: [["tuto/hair.webp", "realHair"], ["tuto/vessel.webp", "realVessel"], ["tuto/blob.webp", "realNoise"]],
  skin: [["tuto/hair_above.webp", "realAbove"], ["tuto/vessel_cross.webp", "realCross"]],
  views: [["tuto/view_volume.webp", "realVolume"], ["tuto/view_mip.webp", "realMip"], ["tuto/view_mipout.webp", "realMipOut"]],
  tools: [["tuto/merge_before3d.webp", "realMerged"], ["tuto/merge_after3d.webp", "realCut"]],
  columns: [["tuto/merge_beforemip.webp", "realMipBefore"], ["tuto/merge_aftermip.webp", "realMipAfter"],
            ["tuto/cols_before.webp", "realColsBefore"], ["tuto/cols_after.webp", "realColsAfter"]],
  steps: [["tuto/steps.webp", "realSteps"]],
};

export const TUTORIAL = {
  editHelp: {
    en: "In the projection, each click or drag acts on a whole column: Erase removes it, 1 vx adds the brightest voxel touching the shape (click again for the next). In 3D, click a face to add a voxel there; Erase or right-click removes one. A removed voxel of the proposal stays as a red cage. Ctrl-Z undoes.",
    ja: "投影上では、クリックやドラッグが列全体に作用します。「消去」は列を取り除き、「1 ボクセル」は形に接する最も明るいボクセルを追加します（もう一度クリックで次）。3Dでは面をクリックしてボクセルを追加し、「消去」または右クリックで除去します。除去された提案ボクセルは赤い枠として残ります。Ctrl+Zで取り消し。",
  },
  splitHelp: {
    en: "Click the shape where two objects meet to cut it; click the projection to cut a whole line of sight. Each separated part gets its own nature — use the dots, or select a part and press 1–3; ? or 4 marks a doubt. Right-click puts a cut back.",
    ja: "2つの物体が接する位置で形をクリックすると切断します。投影をクリックすると視線方向の列全体を切断します。分離した各部分に種類を指定します（丸印、または部分を選んで1〜3。? または 4 で迷いの印）。右クリックで切断を戻します。",
  },

  steps: [
    {
      figure: lang => figShapes(T[lang]),
      h: { en: "What you are asked to do", ja: "お願いしたいこと" },
      body: {
        en: `<p class="lead">Each block contains a shape that was <b>detected automatically</b>. Check it against the real signal.</p>
<ul class="points">
<li><b>Correct the shape</b> if it does not follow the signal.</li>
<li><b>Decide what it is</b> — hair, vessel or noise.</li>
</ul>`,
        ja: `<p class="lead">各ブロックには <b>自動的に検出された形</b> が含まれています。実際の信号と照らし合わせてください。</p>
<ul class="points">
<li>形が信号に沿っていなければ <b>形を修正</b> します。</li>
<li>それが何かを <b>判定</b> します — 毛、血管、ノイズ。</li>
</ul>`,
      },
      note: {
        en: "The detection says nothing about what the shape is. That is your call.",
        ja: "検出はその形が何であるかについて何も述べていません。判断するのはあなたです。",
      },
    },
    {
      figure: lang => figAnatomy(T[lang]) + figImages(REAL.nature, T[lang], "realTitle"),
      h: { en: "What you will see", ja: "見えるもの" },
      body: {
        en: `<p class="lead">Three kinds of object show up in these scans.</p>
<ul class="points">
<li><b>Hair</b> — thin and elongated, close to the skin. Neighbouring hairs often point the same way.</li>
<li><b>Vessel</b> — mostly under the skin, often branching. Near the surface, it runs parallel to it.</li>
<li><b>Noise</b> — no coherent shape.</li>
</ul>`,
        ja: `<p class="lead">これらのスキャンには3種類の物体が映ります。</p>
<ul class="points">
<li><b>毛</b> — 細長く、皮膚の近くにあります。近くの毛はしばしば同じ向きを向いています。</li>
<li><b>血管</b> — 多くは皮膚より深く、よく分岐します。表面近くでは表面と平行に走ります。</li>
<li><b>ノイズ</b> — 一貫した形がありません。</li>
</ul>`,
      },
      note: {
        en: "Hairs and vessels are usually bright and clearly visible in the projection. Noise and the rest are not.",
        ja: "毛と血管は、投影では通常明るくはっきり見えます。ノイズやその他のものはそうではありません。",
      },
    },
    {
      figure: lang => figSkin(T[lang]) + figImages(REAL.skin, T[lang], "realTitle"),
      h: { en: "The skin: your best clue, but imperfect", ja: "皮膚：最良の手がかり、ただし不完全" },
      body: {
        en: `<p class="lead">The skin is the best clue to what an object is. But the drawn surface is an <b>estimate</b> — often shifted up or down.</p>
<ul class="points">
<li>A hair can sit <b>entirely above</b> the drawn skin.</li>
<li>A hair can sit <b>almost entirely below</b> it.</li>
<li>A vessel can seem to <b>cross</b> it.</li>
</ul>
<p>None of these cases is rare.</p>`,
        ja: `<p class="lead">皮膚は物体が何であるかを知る最良の手がかりです。ただし、描かれた表面は <b>推定</b> であり、上下にずれていることがよくあります。</p>
<ul class="points">
<li>毛が描かれた皮膚より <b>完全に上</b> にあることがあります。</li>
<li>毛が <b>ほぼ完全に下</b> にあることがあります。</li>
<li>血管が皮膚を <b>横切って</b> 見えることがあります。</li>
</ul>
<p>いずれも珍しいことではありません。</p>`,
      },
      note: {
        en: "Use the skin to find your way in space — never as the only criterion.",
        ja: "皮膚は空間の中での目印に使ってください。ただし、それだけで判断しないでください。",
      },
    },
    {
      figure: lang => figViews(T[lang]) + figImages(REAL.views, T[lang], "realTitle"),
      h: { en: "Two views of the same block", ja: "同じブロックの2つの表示" },
      body: {
        en: `<p class="lead">Left, the volume. Right, the projection.</p>
<ul class="points">
<li><b>Volume</b> — opens in profile: <b>Z points out of the skin</b> (up), X to the right. Drag to rotate, scroll to zoom, shift-drag to pan.</li>
<li><b>Projection</b> — every depth in one image. Scroll to zoom out to the whole scan; the square marks the block.</li>
<li><b>Render</b> — <i>Signal</i> shows intensity, <i>Shape</i> shows form. <i>Blocks</i> is for editing.</li>
<li><b>Detected shape: Hide</b> — look at the bare signal.</li>
<li><b>Other shapes</b> — compare with the neighbours: nearby hairs often look alike.</li>
</ul>`,
        ja: `<p class="lead">左がボリューム、右が投影です。</p>
<ul class="points">
<li><b>ボリューム</b> — 横から見た向きで開きます。<b>Z は皮膚の外向き</b>（上）、X は右です。ドラッグで回転、ホイールで拡大縮小、Shift+ドラッグで移動。</li>
<li><b>投影</b> — 全ての奥行きを1枚に重ねた画像。ホイールでスキャン全体まで縮小でき、四角がブロックの位置です。</li>
<li><b>描画</b> — 「信号」は強度、「形」は形状を示します。「ブロック」は編集用です。</li>
<li><b>検出された形：非表示</b> — 素の信号を見ます。</li>
<li><b>他の形</b> — 近くの形と比べます。近くの毛はよく似ています。</li>
</ul>`,
      },
      note: {
        en: "The blue Z axis always stays up: drag sideways to turn around it, up or down to tilt.",
        ja: "青い Z 軸は常に上を向いています。左右にドラッグするとその周りを回転し、上下にドラッグすると傾きます。",
      },
    },
    {
      figure: lang => figNature(T[lang]),
      h: { en: "First question — what is it?", ja: "第1の問い — それは何か" },
      body: {
        en: `<p class="lead">Choose the <b>most likely</b> of the three. Keys <span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span>.</p>
<ul class="points">
<li><b>Hair</b></li>
<li><b>Vessel</b></li>
<li><b>Noise</b> — also artefacts, and anything that is neither hair nor vessel.</li>
<li><b>Not sure</b> — tick it <b>as well</b> when you hesitate (key <span class="kbd">4</span>). You still choose a nature.</li>
</ul>
<p>Most shapes were chosen because they may be tubular — a hair or a vessel. <b>Noise</b> is still a valid answer when that is what you see.</p>`,
        ja: `<p class="lead">3つのうち <b>最も可能性の高いもの</b> を選んでください。キー <span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span>。</p>
<ul class="points">
<li><b>毛</b></li>
<li><b>血管</b></li>
<li><b>ノイズ</b> — アーティファクトや、毛でも血管でもないものも含みます。</li>
<li><b>確信なし</b> — 迷うときは、種類に <b>加えて</b> 付けます（キー <span class="kbd">4</span>）。種類は必ず選びます。</li>
</ul>
<p>ほとんどの形は、管状（毛または血管）である可能性があるために選ばれています。それでも、そう見えるなら <b>ノイズ</b> も正しい回答です。</p>`,
      },
      note: {
        en: "You do not need certainty: choose the most likely nature, and tick Not sure if you hesitate.",
        ja: "確信は必要ありません。最も可能性の高い種類を選び、迷うときは「確信なし」を付けてください。",
      },
    },
    {
      figure: lang => figSupport(T[lang]),
      h: { en: "Second question — does the shape need work?", ja: "第2の問い — 形に手を加えるか" },
      body: {
        en: `<p class="lead">The blue outline is what was detected. What should be done with it? Keys <span class="kbd">Q</span> <span class="kbd">W</span> <span class="kbd">E</span>.</p>
<ul class="points">
<li><b>Leave as is</b> — it matches the real object to a voxel or two, or there is nothing worth fixing.</li>
<li><b>Fix the outline</b> — a part is missing or extra. You fix it voxel by voxel.</li>
<li><b>Several objects</b> — it covers two objects or more. You cut them apart and give each its nature.</li>
</ul>
<p>No need for a perfect outline on a vessel or on noise: <b>Leave as is</b>. Outlines are fixed for hairs. Fix the outline and Several objects can both apply.</p>`,
        ja: `<p class="lead">青い領域が検出結果です。これをどう扱いますか？ キー <span class="kbd">Q</span> <span class="kbd">W</span> <span class="kbd">E</span>。</p>
<ul class="points">
<li><b>このままでよい</b> — 実際の物体と1〜2ボクセルの誤差で一致している、または直す価値がない。</li>
<li><b>領域を修正</b> — 一部が欠けている、または余分。ボクセル単位で修正します。</li>
<li><b>複数の物体</b> — 2つ以上の物体を覆っている。切り分けて、それぞれに種類を指定します。</li>
</ul>
<p>血管やノイズの領域を完璧にする必要はありません。<b>このままでよい</b> を選びます。領域を直すのは毛です。「領域を修正」と「複数の物体」は同時に当てはまることがあります。</p>`,
      },
      note: {
        en: "Most common case of several objects: a vessel passing just under a hair.",
        ja: "複数の物体で最もよくあるのは、毛のすぐ下を血管が通っている場合です。",
      },
    },
    {
      figure: lang => figCorrect(T[lang]) + figImages(REAL.tools, T[lang], "realTitle"),
      h: { en: "Correcting and separating", ja: "修正と分離" },
      body: {
        en: `<p class="lead">Choosing <b>Fix the outline</b> or <b>Several objects</b> opens its tools. The volume switches to Blocks.</p>
<ul class="points">
<li><b>Add</b> — click a face of the object. The voxel lands on the face you see; rotate to reach hidden faces.</li>
<li><b>Remove</b> — Erase, or right-click. A removed voxel stays as a red cage.</li>
<li><b>Cut</b> — click where two objects meet. Each part then gets its own nature.</li>
<li><b>Bucket</b> — click another detected shape (brown) to add it whole, for example a small vessel to its large neighbour. Then join them with a bridge (1 vx): an outline in several pieces cannot be confirmed.</li>
<li><b>Fill gaps</b> — fills any one-voxel gap between two filled voxels (along X, Y or Z) and any closed cavity. It also runs by itself when you confirm.</li>
</ul>`,
        ja: `<p class="lead"><b>領域を修正</b> または <b>複数の物体</b> を選ぶと、その道具が開き、ボリュームはブロック表示になります。</p>
<ul class="points">
<li><b>追加</b> — 物体の面をクリックします。見えている面にボクセルが置かれます。隠れた面には回転して回り込みます。</li>
<li><b>除去</b> — 消去、または右クリック。除去したボクセルは赤い枠として残ります。</li>
<li><b>切断</b> — 2つの物体が接する位置をクリックします。各部分に種類を指定します。</li>
<li><b>塗りつぶし</b> — 他の検出された形（茶色）をクリックすると、丸ごと追加されます（例：小さな血管を隣の大きな血管へ）。その後、1 ボクセルで橋渡しします。いくつかの部分に分かれた領域は確定できません。</li>
<li><b>隙間を埋める</b> — X・Y・Z のいずれかの方向で2つのボクセルに挟まれた1ボクセルの隙間と、閉じた空洞を埋めます。確定時にも自動で実行されます。</li>
</ul>`,
      },
      note: {
        en: "Your corrections are saved voxel by voxel — they are part of the answer.",
        ja: "修正はボクセル単位で保存されます。それも回答の一部です。",
      },
    },
    {
      figure: lang => figColumns(T[lang]) + figImages(REAL.columns, T[lang], "realTitle"),
      h: { en: "Editing: the projection first, then 3D", ja: "編集：まず投影、次に3D" },
      body: {
        en: `<p class="lead">Most corrections are fastest in the <b>projection</b>. Each click there acts on a whole column of the block; you can also drag.</p>
<ul class="points">
<li><b>Hide / Show</b> the detected shape and check that it follows the bright signal.</li>
<li><b>Cut</b> — click or drag across the projection where two objects meet.</li>
<li><b>Erase</b> — click or drag to remove the columns that go beyond the signal.</li>
<li><b>Add</b> (1 vx) — click a column: the brightest voxel touching the shape is added. Click again to add the next one.</li>
<li>Right-click undoes the column action.</li>
</ul>
<p>Once the outline is right in the projection, finish in <b>3D</b>: rotate and correct voxel by voxel.</p>`,
        ja: `<p class="lead">ほとんどの修正は <b>投影</b> で行うのが最も速いです。投影上のクリックはブロックの列全体に作用し、ドラッグもできます。</p>
<ul class="points">
<li>検出された形を <b>表示 / 非表示</b> にして、明るい信号に沿っているか確認します。</li>
<li><b>切断</b> — 2つの物体が接する位置をクリック、またはドラッグします。</li>
<li><b>消去</b> — 信号からはみ出した列をクリック、またはドラッグして取り除きます。</li>
<li><b>追加</b>（1 ボクセル）— 列をクリックすると、形に接する最も明るいボクセルが追加されます。もう一度クリックすると次のボクセルが追加されます。</li>
<li>右クリックで列の操作を取り消します。</li>
</ul>
<p>投影上で領域が正しくなったら、<b>3D</b> で仕上げます。回転させ、ボクセル単位で修正します。</p>`,
      },
      note: {
        en: "2D first, 3D second: the projection shows the whole shape at once.",
        ja: "まず2D、次に3D。投影なら形全体を一度に見られます。",
      },
    },
    {
      figure: lang => figImages(REAL.steps, T[lang]),
      h: { en: "For every block", ja: "各ブロックで行うこと" },
      body: {
        en: `<ol class="procedure">
<li><b>Locate</b> the shape relative to the skin — the blue Z axis points out of it.</li>
<li><b>Hide</b> the detected shape to compare it with the real signal. Turn <b>Other shapes</b> off and on to read the context.</li>
<li><b>Switch render</b> — Signal for intensity, Shape for form.</li>
<li><b>Choose the nature.</b></li>
<li><b>Check the outline</b> — keep it, or correct it: in the projection first (cut, erase, add columns), then in 3D.</li>
<li><b>Confirm and continue.</b></li>
</ol>`,
        ja: `<ol class="procedure">
<li>皮膚に対する形の <b>位置を確認</b> します。青い Z 軸が皮膚の外向きです。</li>
<li>検出された形を <b>隠して</b> 実際の信号と比べます。<b>他の形</b> を切り替えて周囲を把握します。</li>
<li><b>描画を切り替えます</b> — 強度は「信号」、形状は「形」。</li>
<li><b>種類を選びます。</b></li>
<li><b>領域を確認</b> し、そのまま残すか修正します。まず投影で（切断・列の消去・列の追加）、次に3Dで。</li>
<li><b>確定して次へ</b> 進みます。</li>
</ol>`,
      },
      note: {
        en: "This list stays in the annotator under Steps. The tutorial reopens at any time with the Tutorial button.",
        ja: "この手順は注釈画面の「手順」にいつでも表示できます。チュートリアルは「チュートリアル」ボタンでいつでも開き直せます。",
      },
    },
  ],
};

/* ===========================================================================
   Second instrument — rechercher les poils que le registre n'a pas proposes.
   Meme gabarit que le tutoriel principal : une phrase d'entree, deux a quatre
   points a mot-cle gras, au plus un encadre. Les schemas reprennent les memes
   conventions : gris pour ce qui est deja detecte, pinceau pour le vrai signal,
   une couleur par poil trace.
   ======================================================================== */
const TR = { a: "#7fd4f5", b: "#4fd1c5", brown: "#a8703a", target: "#ff5f5f", click: "#f2c14e" };
const tileFrame = (x, y, w, h) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${G.faint}" opacity=".3" stroke="${G.dim}" stroke-width="1"/>`;
const skinLine = (x0, x1, y) => `
  <path d="M${x0} ${y} Q ${(x0 + x1) / 2} ${y - 6} ${x1} ${y + 2}" fill="none" stroke="${G.skin}" stroke-width="2" stroke-dasharray="7 4"/>`;
const brownShape = (d, w = 7) => `<path d="${d}" fill="none" stroke="${TR.brown}" stroke-width="${w}" stroke-linecap="round" opacity=".9"/>`;

/* 1. ce qu'on cherche : dans le carre rouge, ce qui n'est pas brun */
const figTraceFind = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yFind}">
  ${tileFrame(20, 24, 360, 250)}
  ${skinLine(24, 376, 128)}
  ${txt(30, 120, t.skin, G.skin, 11.5)}
  <rect x="110" y="44" width="180" height="180" fill="none" stroke="${TR.target}" stroke-width="2.4"/>
  ${txt(116, 40, t.searchHere, TR.target, 12, "start", 600)}
  ${brownShape("M130 190 Q 170 180 206 196")}
  ${brownShape("M318 150 L326 206")}
  ${brush("M226 64 L238 116 L244 160", 7)}
  <line x1="250" y1="92" x2="300" y2="86" stroke="${TR.click}" stroke-width="1.2"/>
  ${txt(304, 84, t.missed, TR.click, 12.5, "start", 600)}
  ${txt(304, 100, t.traceIt, G.dim, 11)}
  <line x1="168" y1="204" x2="150" y2="250" stroke="${TR.brown}" stroke-width="1.2"/>
  ${txt(40, 262, t.detected, TR.brown, 12)}
  ${txt(40, 278, t.ignore, G.dim, 11)}
</svg>`;

/* 2. tracer : pas a pas */
const figTraceClicks = t => {
  const d = "M110 62 Q 150 110 170 150 T 250 236";
  const dots = [[110, 62], [140, 102], [170, 150], [210, 196], [250, 236]];
  return `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yClicks}">
  ${tileFrame(40, 30, 320, 240)}
  ${brush(d, 10)}
  <path d="${d}" fill="none" stroke="${TR.a}" stroke-width="5" stroke-linecap="round"/>
  ${dots.map(([x, y], k) => `<circle cx="${x}" cy="${y}" r="7" fill="${G.faint}" stroke="${TR.click}" stroke-width="2.4"/>
  ${txt(x, y + 4, String(k + 1), TR.click, 10.5, "middle", 600)}`).join("")}
  ${blob(290, 110, 1.1, G.signal)}
  <path d="M170 150 L286 112" fill="none" stroke="${G.vessel}" stroke-width="1.6" stroke-dasharray="4 3"/>
  ${txt(236, 78, t.jump, G.vessel, 11.5, "start", 600)}
  ${txt(236, 94, t.undoIt, G.dim, 11)}
  ${txt(126, 106, t.shortSteps, TR.click, 12, "end", 600)}
  ${txt(52, 256, t.pathFollows, TR.a, 12, "start", 600)}
</svg>`;
};

/* 3. un poil qui rejoint une forme brune : elle prend sa couleur */
const figTraceAttach = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yAttach}">
  ${txt(100, 30, t.before, G.ink, 12, "middle", 600)}
  ${txt(300, 30, t.after, G.ink, 12, "middle", 600)}
  ${tileFrame(14, 42, 172, 200)}
  ${brownShape("M60 70 Q 70 110 80 130", 9)}
  ${brush("M80 130 L96 180 L104 222", 7)}
  <circle cx="70" cy="100" r="7" fill="${G.faint}" stroke="${TR.click}" stroke-width="2.4"/>
  ${txt(70, 104, "1", TR.click, 10.5, "middle", 600)}
  <circle cx="102" cy="212" r="7" fill="${G.faint}" stroke="${TR.click}" stroke-width="2.4"/>
  ${txt(102, 216, "2", TR.click, 10.5, "middle", 600)}
  ${tileFrame(214, 42, 172, 200)}
  <path d="M260 70 Q 270 110 280 130" fill="none" stroke="${TR.a}" stroke-width="9" stroke-linecap="round"/>
  <path d="M280 130 L296 180 L304 222" fill="none" stroke="${TR.a}" stroke-width="7" stroke-linecap="round"/>
  <path d="M190 142 l16 0 m-6 -6 l6 6 l-6 6" stroke="${G.dim}" stroke-width="1.6" fill="none"/>
  ${txt(100, 264, t.clickBrown, TR.brown, 11.5, "middle")}
  ${txt(300, 264, t.joins, TR.a, 11.5, "middle")}
  ${txt(200, 290, t.sameNature, G.dim, 11, "middle")}
</svg>`;

/* 4. verifier, etiqueter */
const figTraceLabel = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yLabel}">
  ${tileFrame(24, 30, 200, 220)}
  <path d="M70 58 L84 126 L92 170" fill="none" stroke="${TR.a}" stroke-width="7" stroke-linecap="round"/>
  <path d="M130 70 Q 160 120 178 200" fill="none" stroke="${TR.b}" stroke-width="7" stroke-linecap="round"/>
  ${brownShape("M60 214 Q 110 204 150 220", 6)}
  <g transform="translate(236,74)">
    <rect x="0" y="0" width="150" height="30" rx="6" fill="${G.faint}" opacity=".5"/>
    <rect x="8" y="10" width="10" height="10" rx="3" fill="${TR.a}"/>${txt(24, 19, "A", G.ink, 11.5, "start", 600)}
    <circle cx="96" cy="15" r="8" fill="none" stroke="${G.other}" stroke-width="1.8"/>${txt(96, 19, "?", G.other, 10.5, "middle", 700)}
    ${txt(134, 19, "×", G.dim, 13, "middle")}
    <rect x="0" y="40" width="150" height="30" rx="6" fill="${G.faint}" opacity=".5"/>
    <rect x="8" y="50" width="10" height="10" rx="3" fill="${TR.b}"/>${txt(24, 59, "B", G.ink, 11.5, "start", 600)}
    <circle cx="96" cy="55" r="8" fill="${G.other}"/>${txt(96, 59, "?", "#0a0e12", 10.5, "middle", 700)}
    ${txt(134, 59, "×", G.dim, 13, "middle")}
    ${txt(75, 98, t.notSureShort, G.other, 11, "middle")}
  </g>
  <g transform="translate(236,214)">
    <rect x="0" y="0" width="120" height="28" rx="6" fill="none" stroke="${G.dim}"/>
    ${txt(30, 18, "Show", G.ink, 11, "middle", 600)}${txt(88, 18, "Hide", G.dim, 11, "middle")}
    ${txt(60, 46, t.keyC, G.dim, 10.5, "middle")}
  </g>
</svg>`;

/* 5. deplacer la vue : le carre rouge reste le bloc a fouiller */
const figTraceWindow = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yWindow}">
  <rect x="50" y="20" width="252" height="252" rx="4" fill="none" stroke="${G.dim}" stroke-width="1.2" stroke-dasharray="6 4"/>
  <rect x="134" y="104" width="84" height="84" fill="${G.faint}" opacity=".35" stroke="${TR.target}" stroke-width="2.4"/>
  ${brush("M170 118 Q 178 160 176 196 T 196 262", 7)}
  <path d="M170 118 Q 178 160 176 206" fill="none" stroke="${TR.a}" stroke-width="5" stroke-linecap="round"/>
  <rect x="148" y="170" width="84" height="84" fill="none" stroke="${G.mark}" stroke-width="1.8" stroke-dasharray="3 3"/>
  <circle cx="190" cy="246" r="7" fill="${G.faint}" stroke="${TR.click}" stroke-width="2.4"/>
  ${txt(58, 38, t.canMove, G.dim, 11)}
  ${txt(224, 100, t.searchHere, TR.target, 11.5, "start", 600)}
  <line x1="200" y1="244" x2="306" y2="226" stroke="${TR.click}" stroke-width="1"/>
  ${txt(310, 222, t.clickOutside, TR.click, 11.5, "start", 600)}
  ${txt(310, 238, t.recentres, G.dim, 11)}
  ${txt(310, 150, t.viewNow, G.mark, 11, "start", 600)}
  <line x1="306" y1="148" x2="234" y2="178" stroke="${G.mark}" stroke-width="1"/>
  <g transform="translate(332,50)" fill="none" stroke="${G.mark}" stroke-width="1.4">
    <rect x="10" y="0" width="14" height="14" rx="3"/><rect x="0" y="16" width="14" height="14" rx="3"/>
    <rect x="20" y="16" width="14" height="14" rx="3"/><rect x="10" y="32" width="14" height="14" rx="3"/>
  </g>
  ${txt(349, 112, t.arrows, G.dim, 10.5, "middle")}
  ${txt(349, 126, t.arrows2, G.dim, 10.5, "middle")}
</svg>`;

/* 6. rien a tracer */
const figTraceNone = t => `
<svg viewBox="0 0 400 300" role="img" aria-label="${t.a11yNone}">
  ${tileFrame(60, 30, 280, 200)}
  ${skinLine(64, 336, 118)}
  <rect x="120" y="50" width="160" height="160" fill="none" stroke="${TR.target}" stroke-width="2"/>
  ${brownShape("M140 170 Q 170 160 200 176")}
  <g opacity=".5">${blob(240, 180, 1.1, G.noise)}${blob2(262, 194, 0.9, G.noise)}</g>
  <rect x="120" y="248" width="160" height="30" rx="7" fill="#2f6f8f"/>
  ${txt(200, 268, t.noneBtn, "#ffffff", 12, "middle", 600)}
</svg>`;

const TT = {
  en: {
    a11yFind: "A block with brown detected shapes, a red square to search, and one missed hair",
    a11yClicks: "Short clicks along a hair; a long click that jumps to a noise speck",
    a11yAttach: "A traced hair that runs into a brown shape; the shape takes the hair's colour",
    a11yLabel: "Two traced hairs, each with its colour; the second marked Not sure; the Show and Hide switch",
    a11yWindow: "The view moved around the red square, inside the dashed frame",
    a11yNone: "A block with nothing to trace",
    skin: "skin", searchHere: "search here only", missed: "missed hair", traceIt: "not brown: trace it",
    detected: "already detected (brown)", ignore: "ignore it — unless a hair runs into it",
    shortSteps: "short steps", jump: "a jump?", undoIt: "Ctrl-Z, click beside it", pathFollows: "the path follows the signal",
    before: "Click the brown shape", after: "It joins the hair",
    clickBrown: "1 on brown, 2 on the hair", joins: "same colour as the hair", sameNature: "…and the same nature: one object",
    notSureShort: "? = not sure it is a hair", keyC: "key C: check the bare signal",
    canMove: "dashed: how far the view can move (2.5 mm)", clickOutside: "click the hair", recentres: "the view follows",
    viewNow: "the view now", arrows: "arrows", arrows2: "or wheel-drag",
    noneBtn: "No missed hair — next",
  },
  ja: {
    a11yFind: "茶色の検出済みの形、探す範囲を示す赤い四角、見逃された毛を含むブロック",
    a11yClicks: "毛に沿った短いクリックと、ノイズへ跳んだ長いクリック",
    a11yAttach: "トレースした毛が茶色の形につながり、形が毛の色になる",
    a11yLabel: "色の付いた2本のトレース済みの毛（2本目に確信なしの印）と、表示・非表示の切り替え",
    a11yWindow: "赤い四角の周りでビューが点線の枠の中を移動する",
    a11yNone: "トレースするものがないブロック",
    skin: "皮膚", searchHere: "探すのはここだけ", missed: "見逃された毛", traceIt: "茶色でない：トレース",
    detected: "検出済み（茶色）", ignore: "無視する（毛がつながる場合を除く）",
    shortSteps: "小さな歩幅", jump: "跳んだら", undoIt: "Ctrl+Z、隣をクリック", pathFollows: "経路は信号に沿う",
    before: "茶色の形をクリック", after: "毛に合流する",
    clickBrown: "1 茶色、2 毛の上", joins: "毛と同じ色", sameNature: "…同じ種類：1つの物体",
    notSureShort: "? = 毛か確信なし", keyC: "C キー：素の信号を確認",
    canMove: "点線：ビューの移動範囲（2.5 mm）", clickOutside: "毛をクリック", recentres: "ビューが追従",
    viewNow: "現在のビュー", arrows: "矢印", arrows2: "またはホイール",
    noneBtn: "見逃しなし — 次へ",
  },
};

export const TRACE_TUTORIAL = {
  editHelp: {
    en: "Trace: click step by step along the hair in the projection; Ctrl-Z as soon as a click goes wrong. Click a brown shape to join it. Move the view with the arrows on the 3D view, or drag with the wheel pressed. Esc: another hair; C: show or hide.",
    ja: "トレース：投影上で毛に沿って少しずつクリックし、ずれたらすぐ Ctrl+Z。茶色の形をクリックすると毛に合流します。3Dビュー上の矢印、またはホイールを押したままドラッグでビューを移動。Esc：別の毛、C：表示切替。",
  },
  splitHelp: TUTORIAL.splitHelp,
  steps: [
    {
      figure: lang => figTraceFind(TT[lang]),
      h: { en: "What you are asked to do", ja: "お願いしたいこと" },
      body: {
        en: `<p class="lead">Look for the <b>hairs the automatic method missed</b>, inside the <b>red square</b>.</p>
<ul class="points">
<li><b>Brown</b> — shapes already found. Never trace them.</li>
<li><b>Hairs only</b> — thin, elongated, near the skin. Ignore noise.</li>
<li><b>A vessel?</b> — thicker, often branching, under the skin. Do not trace it: just move on.</li>
<li><b>Weak signal</b> — look carefully where the image is faint: that is where hairs get missed.</li>
</ul>`,
        ja: `<p class="lead"><b>赤い四角</b> の中で、自動手法が <b>見逃した毛</b> を探してください。</p>
<ul class="points">
<li><b>茶色</b> — すでに見つかった形です。トレースしないでください。</li>
<li><b>毛だけ</b> — 細長く、皮膚の近くにあるもの。ノイズは無視します。</li>
<li><b>血管なら</b> — より太く、よく分岐し、皮膚の下にあります。トレースせず、そのまま次へ進みます。</li>
<li><b>弱い信号</b> — 画像が暗い所をよく見てください。毛が見逃されるのはそういう場所です。</li>
</ul>`,
      },
      note: {
        en: "Most blocks contain no missed hair. Saying so is a complete answer.",
        ja: "ほとんどのブロックには見逃された毛はありません。「見逃しなし」も立派な回答です。",
      },
    },
    {
      figure: lang => figTraceClicks(TT[lang]),
      h: { en: "Tracing a hair — the reference method", ja: "毛のトレース — 基本の方法" },
      body: {
        en: `<p class="lead"><b>Click step by step</b> along the hair in the projection, and press <b>Ctrl-Z</b> as soon as a click goes wrong.</p>
<ul class="points">
<li><b>Short steps</b> — each click lands on the bright voxel linked to the previous one; the path follows the signal and takes the hair's width.</li>
<li><b>A jump?</b> — Ctrl-Z, then click right next to it.</li>
<li><b>New hair</b> — Esc or right-click.</li>
</ul>`,
        ja: `<p class="lead">投影上で毛に沿って <b>少しずつクリック</b> し、クリックがずれたらすぐ <b>Ctrl+Z</b> を押します。</p>
<ul class="points">
<li><b>小さな歩幅</b> — クリックは直前の点につながる明るいボクセルに置かれ、経路は信号に沿って毛の太さも取り込みます。</li>
<li><b>跳んだら</b> — Ctrl+Z で戻し、すぐ隣をクリックします。</li>
<li><b>新しい毛</b> — Esc または右クリック。</li>
</ul>`,
      },
      note: {
        en: "This is the best way to build a clean shape: it leaves almost nothing to fix in 3D afterwards.",
        ja: "これが最もきれいな形を作る方法です。後から3Dで直す箇所がほとんど残りません。",
      },
    },
    {
      figure: lang => figTraceAttach(TT[lang]),
      h: { en: "A hair that runs into a brown shape", ja: "茶色の形につながる毛" },
      body: {
        en: `<p class="lead">Part of a hair may already be detected: it shows in <b>brown</b>, and the rest does not.</p>
<ul class="points">
<li><b>Click the brown shape</b>, then trace the rest — or the other way round. The path goes to the shape at its brightest.</li>
<li>The shape <b>joins the hair</b>: same colour, same nature. It is one object.</li>
<li>Erase the link and the shape turns brown again.</li>
</ul>`,
        ja: `<p class="lead">毛の一部がすでに検出されていることがあります。その部分は <b>茶色</b> で、残りはそうではありません。</p>
<ul class="points">
<li><b>茶色の形をクリック</b> してから残りをトレースします（逆の順でも構いません）。経路は最も明るい所を通ってその形まで伸びます。</li>
<li>形は <b>毛に合流</b> します。同じ色、同じ種類で、1つの物体になります。</li>
<li>つなぎ目を消すと、形は茶色に戻ります。</li>
</ul>`,
      },
      note: {
        en: "Join a brown shape only when you see one continuous hair.",
        ja: "1本の連続した毛に見えるときだけ、茶色の形を合流させてください。",
      },
    },
    {
      figure: lang => figTraceLabel(TT[lang]),
      h: { en: "Checking, and marking a doubt", ja: "確認と迷いの印" },
      body: {
        en: `<p class="lead">Each traced hair gets <b>its own colour</b> and a line in the list.</p>
<ul class="points">
<li><b>Show / Hide</b> the traced hairs (key <span class="kbd">C</span>) to check they follow the real signal.</li>
<li><b>Not sure</b> it is a hair? Tick its <b>?</b> in the list (key <span class="kbd">4</span>).</li>
<li><b>Retouch</b> — Erase removes voxels, 1 vx adds one. <b>Delete</b> — the × on a line.</li>
</ul>`,
        ja: `<p class="lead">トレースした毛には、それぞれ <b>固有の色</b> と一覧の行が付きます。</p>
<ul class="points">
<li>トレースした毛を <b>表示 / 非表示</b>（キー <span class="kbd">C</span>）にして、実際の信号に沿っているか確認します。</li>
<li>毛か <b>確信が持てない</b> ときは、一覧でその <b>?</b> を付けます（キー <span class="kbd">4</span>）。</li>
<li><b>修正</b> — 「消去」で除去、「1 ボクセル」で追加。<b>削除</b> — 行の ×。</li>
</ul>`,
      },
      note: {
        en: "Rotate the volume before confirming: a path can cut a corner through the background.",
        ja: "確定する前にボリュームを回転させて確認してください。経路が背景を近道していることがあります。",
      },
    },
    {
      figure: lang => figTraceWindow(TT[lang]),
      h: { en: "Moving the view", ja: "ビューの移動" },
      body: {
        en: `<p class="lead">The projection opens on the <b>red square</b>, the block to search.</p>
<ul class="points">
<li><b>Leaving the square?</b> — zoom out with the wheel to see where the structure goes. The dashed frame is how far the view can move.</li>
<li><b>Move the view</b> — the arrows on the 3D view, or drag with the wheel pressed.</li>
<li><b>Follow a hair</b> — with a hair in progress, a click outside the square moves the view and the trace goes on. ⌂ brings it back.</li>
</ul>`,
        ja: `<p class="lead">投影は、探すブロックである <b>赤い四角</b> に合わせて開きます。</p>
<ul class="points">
<li><b>四角の外へ続く？</b> — ホイールで縮小し、構造がどこへ続くか確認します。点線の枠がビューを移動できる範囲です。</li>
<li><b>ビューの移動</b> — 3Dビュー上の矢印、またはホイールを押したままドラッグ。</li>
<li><b>毛をたどる</b> — 毛をたどっている途中で四角の外をクリックすると、ビューが移動してトレースが続きます。⌂ で戻ります。</li>
</ul>`,
      },
      note: {
        en: "Search the red square only: the frame around it is there to finish hairs that start inside.",
        ja: "探すのは赤い四角の中だけです。周囲の枠は、内側から始まる毛を最後までたどるためのものです。",
      },
    },
    {
      figure: lang => figTraceNone(TT[lang]),
      h: { en: "Nothing to trace?", ja: "トレースするものがないとき" },
      body: {
        en: `<p class="lead">Confirm with <b>No missed hair — next</b>.</p>
<ul class="points">
<li><b>Look at the whole red square</b> first — the projection, then the volume.</li>
<li><b>Do not force it</b> — trace only what you would call a hair, and tick <b>?</b> when you hesitate. A vessel is not a missed hair.</li>
</ul>`,
        ja: `<p class="lead">「<b>見逃しなし — 次へ</b>」で確定します。</p>
<ul class="points">
<li>まず <b>赤い四角全体を見ます</b> — 投影、次にボリューム。</li>
<li><b>無理をしない</b> — 毛と言えるものだけをトレースし、迷うときは <b>?</b> を付けます。血管は見逃された毛ではありません。</li>
</ul>`,
      },
      note: {
        en: "These steps stay in the page under Steps. The tutorial reopens at any time with the Tutorial button.",
        ja: "この手順は「手順」にいつでも表示できます。チュートリアルは「チュートリアル」ボタンでいつでも開き直せます。",
      },
    },
  ],
};

/* Seconde lecture rapide (etape 1) : les ecrans de l'etape 1 qui apprennent a
   voir, et deux ecrans propres a ce parcours — la consigne, et la verification
   du contour du premier lecteur. */
export const SECOND_TUTORIAL = {
  editHelp: TUTORIAL.editHelp,
  splitHelp: TUTORIAL.splitHelp,
  steps: [
    {
      figure: lang => figShapes(T[lang]),
      h: { en: "What you are asked to do", ja: "お願いしたいこと" },
      body: {
        en: `<p class="lead">Each block contains a shape that was <b>detected automatically</b>. A first reader has already outlined it. You give a <b>second, independent opinion</b>.</p>
<ul class="points">
<li><b>Say what it is</b> — hair, vessel, noise, or several objects.</li>
<li>Small specks stuck to an object (under about 0.75 mm, a few voxels) are not a separate object.</li>
<li><b>Lock</b> your answer. Only then does the first reader's outline appear.</li>
<li><b>Check</b> that outline: right, or not. You may fix it, but you do not have to.</li>
</ul>`,
        ja: `<p class="lead">各ブロックには <b>自動的に検出された形</b> が含まれています。最初の読み手がすでに領域を描いています。あなたには <b>独立した2人目の意見</b> をお願いします。</p>
<ul class="points">
<li>それが何かを <b>答えます</b> — 毛、血管、ノイズ、または複数の物体。</li>
<li>物体に付いた小さな断片（約0.75 mm未満、数ボクセル程度）は、別の物体として数えません。</li>
<li>回答を <b>確定</b> します。確定して初めて、最初の読み手の領域が表示されます。</li>
<li>その領域を <b>確認</b> します。正しいか、正しくないか。修正してもかまいませんが、必須ではありません。</li>
</ul>`,
      },
      note: {
        en: "About 15 seconds per block. Your first answer counts: do not try to guess what the first reader said.",
        ja: "1ブロックあたり約15秒です。最初の回答が大切です。最初の読み手の答えを推測しようとしないでください。",
      },
    },
    TUTORIAL.steps[1],
    TUTORIAL.steps[2],
    TUTORIAL.steps[3],
    TUTORIAL.steps[4],
    {
      figure: lang => figImages([["tuto/cols_before.webp", "realColsBefore"], ["tuto/cols_after.webp", "realColsAfter"]], T[lang], "realTitle"),
      h: { en: "Checking the first reader's outline", ja: "最初の読み手の領域を確認する" },
      body: {
        en: `<p class="lead">Once your answer is locked, the block shows the <b>first reader's outline</b>: voxels added in yellow, removed in red, separate objects in colour.</p>
<ul class="points">
<li><b>Yes, I agree</b> — it follows the bright signal of the object, without missing a piece.</li>
<li><b>No, don't fix it</b> — the outline is wrong: saying so is enough. A few words on why are welcome.</li>
<li><b>No, fix it</b> — optional: the editing tools open; correct only what is clearly wrong.</li>
</ul>
<p>If you and the first reader disagree on what the object is, there is nothing to check: the block will be settled later.</p>`,
        ja: `<p class="lead">回答を確定すると、ブロックに <b>最初の読み手の領域</b> が表示されます。追加したボクセルは黄色、除去したものは赤、別々の物体は色分けされます。</p>
<ul class="points">
<li><b>はい、同意します</b> — 物体の明るい信号に沿っていて、欠けている部分がない。</li>
<li><b>いいえ、修正しない</b> — 領域は正しくない。そう答えるだけで十分です。理由を一言いただけると助かります。</li>
<li><b>いいえ、修正する</b> — 任意です。編集の道具が開きます。明らかに違うところだけを直してください。</li>
</ul>
<p>物体が何かについて最初の読み手と意見が分かれた場合は、確認するものはありません。そのブロックは後で決着をつけます。</p>`,
      },
      note: {
        en: "Checking takes a few seconds; fixing is a bonus, never an obligation.",
        ja: "確認は数秒で済みます。修正はあくまで任意です。",
      },
    },
  ],
};

/* Seconde lecture rapide (etape 2) : pointer les poils manques, verrouiller,
   puis valider les traces du premier lecteur. */
export const SECOND_TRACE_TUTORIAL = {
  editHelp: TRACE_TUTORIAL.editHelp,
  splitHelp: TRACE_TUTORIAL.splitHelp,
  steps: [
    {
      figure: lang => figTraceFind(TT[lang]),
      h: { en: "What you are asked to do", ja: "お願いしたいこと" },
      body: {
        en: `<p class="lead">Some hairs were <b>missed</b> by the automatic method. Look for them inside the <b>red square</b>.</p>
<ul class="points">
<li><b>Click each missed hair once</b>, in the projection. No need to trace it.</li>
<li>Only hairs <b>entirely</b> missed. A hair whose body is a brown shape was found: skip it. Tiny brown specks along a hair do not count as found.</li>
<li>A line in the projection that does not hold in the 3D view: skip it. Only the signal that is there is judged.</li>
<li>Nothing there? Press <b>No missed hair here</b> — most blocks have none.</li>
<li><b>Lock</b> your answer. The first reader's tracing then appears in yellow: say whether each tracing matching one of your marks is right.</li>
</ul>`,
        ja: `<p class="lead">自動手法が <b>見逃した</b> 毛があります。<b>赤い四角</b> の中で探してください。</p>
<ul class="points">
<li>見逃された毛を、投影上で <b>それぞれ1回クリック</b> します。トレースは不要です。</li>
<li>対象は <b>完全に</b> 見逃された毛だけです。本体が茶色の形になっている毛は検出済みなので飛ばします。毛に沿った小さな茶色の点は、検出済みとはみなしません。</li>
<li>投影では線に見えても3D表示で何も残らないものは飛ばします。判定するのは、実際にある信号だけです。</li>
<li>何もなければ <b>「見逃しなし」</b> を押します。ほとんどのブロックには何もありません。</li>
<li>回答を <b>確定</b> すると、最初の読み手のトレースが黄色で表示されます。あなたの印と一致したトレースが正しいかどうかを答えます。</li>
</ul>`,
      },
      note: {
        en: "Brown shapes are already detected: ignore them. Skip vessels. About 15 seconds per block.",
        ja: "茶色の形はすでに検出済みなので無視してください。血管は飛ばします。1ブロックあたり約15秒です。",
      },
    },
    TRACE_TUTORIAL.steps[4],
  ],
};
