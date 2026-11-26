import { CONFIG, dataUrl } from "./config.js?v=20261126b";
import { STR, STR_TRACE, STR_COMPLETE, STR_ARBITRATE, STR_ARB_EDIT, STR_TILE_REVIEW, STR_SECOND, STR_SECOND_TRACE } from "./strings.js?v=20261126b";
import { TUTORIAL, TRACE_TUTORIAL, SECOND_TUTORIAL, SECOND_TRACE_TUTORIAL } from "./tutorial.js?v=20261126b";

/* ===========================================================================
   Etat
   ======================================================================== */
let COH = null;                 /* cohorte.json */
let BOX = 48, COLS = 8, ROWS = 7, SKIN_SLOT = 48, PER_PACK = 4;
let byId = new Map();

let lang = "en";
let reader = null;              /* {id, startedAt, tutorialDone} */
/* `[!]` Trois choses distinctes, que la premiere version confondait.

   `mine`    les reponses CONFIRMEES, et elles seules. C'est ce qui part dans la
             base, dans l'export, et ce que compte la progression.
   `draft`   la reponse en cours sur la dalle affichee. Elle ne devient une
             reponse qu'au clic de confirmation.
   `drafts`  les brouillons laisses en route, en memoire seulement, pour qu'un
             aller-retour ne fasse pas perdre un travail commence.

   L'ancienne version creait une reponse vide des l'ouverture d'une dalle.
   Revenir en arriere puis confirmer sautait alors la dalle suivante, qui
   « avait deja une reponse » ; le saut s'empilait, et ces reponses vides
   etaient comptees comme lues et envoyees dans la base. */
let mine = {};
let draft = null;
let drafts = {};
/* Historique de navigation : les dalles confirmees, dans l'ordre de leur
   premiere confirmation. `hi === history.length` : on est sur la frontiere,
   une dalle neuve ; en deca, on relit une dalle deja jugee. */
let history = [];
let hi = 0;
let frontierId = null;
let counts = {};                /* slab_id -> nombre de lectures, toutes personnes */
let queue = [];                 /* slab_id, ordre de service pour ce lecteur */
let practice = false;           /* exercice apres le tutoriel : enregistre, marque, hors progression */
let practiceList = [], practiceIdx = 0;

const GOAL = 100;               /* objectif indicatif, jamais une limite */

let slab = null;                /* descripteur de la dalle courante */
let vol = null;                 /* Uint8Array BOX^3 * 4 : R signal, G masque, B autres, A etat */
let skinTex = null;             /* Uint8Array BOX^2 * 4 */
/* Chaque dalle s'ouvre de profil : X vers la droite, Z — hors de la peau — vers
   le haut. Un lecteur qui ne verifie pas l'axe ne peut ainsi pas juger « au-
   dessus » ce qui est en dessous. */
const VIEW0 = { yaw: 0, pitch: 1.45 };
let yaw = VIEW0.yaw, pitch = VIEW0.pitch, zoom = 1.0, panX = 0, panY = 0;
/* Peau et autres formes affichees d'emblee : la peau est le premier repere du
   lecteur, et les formes voisines aident a distinguer un poil d'un vaisseau. */
let overlay = true, skinOn = true, othersOn = true, render = "alpha";
let mipZoom = 1.0, deviated = false;
let splitOn = false, parts = [], selectedPart = 0;
let face = null, tool = "b1", drag = null, dragMoved = false;
let edit = null;                /* Uint8Array BOX^3 : l'INTENTION du lecteur */
let partLab = null;             /* Int16Array BOX^3 : etiquette de partie, -1 sinon */
let mipOx = 0, mipOy = 0, mipSide = 1;
let undoStack = [];
let slabShownAt = 0;

/* Reglage mesure, pas devine. Sur 24 dalles, l'opacite accumulee le long d'un
   rayon vaut 0,45 pour le fond et 0,52 pour l'objet a seuil nul : le CONTRASTE
   EST NUL, le signal brut en composition alpha ne distingue pas l'objet du
   tissu. Un volume photoacoustique est trop brouille pour cela.
   Le seuil a 70 coupe le brouillard (fond median 0,06), et l'objet reste
   visible par son MASQUE, dont l'opacite est desormais fixe — l'asservir a
   celle du signal faisait disparaitre l'objet des qu'on eclaircissait le fond. */
const PRESET = { floor: 70, ceil: 255, gamma: 100, opacity: 18 };
const ST_NEUTRAL = 0, ST_CUT = 64, ST_REMOVED = 128, ST_ADDED = 255;
/* E_FILL : voxel pose par Combler (bouton ou confirmation), tenu a part des
   ajouts du lecteur pour que le comblement reste reversible a l'analyse. */
const E_NONE = 0, E_ADD = 1, E_REM = 2, E_CUT = 3, E_FILL = 4;
/* E_ATT (mode trace) : voxel d'une forme deja detectee que le lecteur a
   rattachee a son poil. Etat derive, recalcule a chaque modification. */
const E_ATT = 5;
const isAdded = e => e === E_ADD || e === E_FILL || e === E_ATT;
const PART_BASE = 180, PART_STEP = 10, PART_MAX = 6;
/* Voxel ajoute par le lecteur, range dans une partie par une coupe : il garde
   sa face jaune (c'est un ajout) et prend en aretes la couleur de sa partie. */
const ADDED_PART_BASE = 236, ADDED_PART_STEP = 3;
const PART_COLORS = ["#7fd4f5", "#4fd1c5", "#f78fb3", "#a0a8ff", "#9fb1bd", "#c8d4de"];
const PART_LETTERS = "ABCDEF";
const CUT_COLOR = "#b14bff";
const PART_RGB = PART_COLORS.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
const SIX = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const RENDERS = ["alpha", "cloud", "blocks"];
const MODE_TOOLS = { incorrect: ["b1", "b7", "del", "fill"], merged: ["c1", "c7"] };
const NAT_COLOR = { hair: "var(--hair)", vessel: "var(--vessel)", noise: "var(--noise)", unsure: "var(--unsure)",
                    tubular: "var(--tubular)" };

const $ = id => document.getElementById(id);
/* Second instrument : la cohorte en mode « trace » sert des tuiles sans
   composante a juger, ou le lecteur trace les poils que le registre a manques.
   Ses libelles surchargent ceux de STR ; tout le reste de la page est commun. */
const isTrace = () => !!(COH && COH.mode === "trace");
/* Tour de completion : les etiquettes de l'etape 1 coupees par le bord de leur
   boite, reprises par l'auteur dans une region elargie. Il partage la marge et
   les fenetres du mode trace, et l'edition de l'etape 1. */
const isComplete = () => !!(COH && COH.mode === "complete");
const hasHalo = () => isTrace() || isComplete();
/* Arbitrage a l'aveugle : les dalles dont les lectures divergent, chaque
   reponse montree sans son lecteur, en lecture seule. */
const isArbitrate = () => !!(COH && COH.mode === "arbitrate");
/* Arbitrage dans l'outil complet (decision de l'auteur, 13 oct.) : l'etape 1 de
   l'auteur, ouverte sur sa reconstruction finale natures effacees, avec le
   decompte anonyme des lectures, sa propre voix comprise. Il choisit a nouveau
   les natures et peut retoucher le contour. */
const isArbEdit = () => !!(COH && COH.mode === "arbitrate_edit");
/* Revue des alertes de l'etape 2 (13 oct.) : l'outil de trace de l'auteur, sur
   les tuiles ou un volontaire a vu un poil non trace, ou juge un trace faux ;
   ouverte sur la derniere reponse de l'auteur, points des volontaires affiches. */
const isTileReview = () => !!(COH && COH.review_tiles);
const isStep1 = () => !hasHalo() && !isArbitrate() && !(COH && COH.picker);
/* Seconde lecture rapide : a l'etape 1, tout lecteur autre que l'auteur donne
   la nature de la forme automatique, verrouille sa reponse, puis valide la
   reconstruction de l'auteur. L'auteur garde l'outil complet. */
/* Lecteur complet : un volontaire qui fait le meme travail que l'auteur (outil
   complet, comme avant la seconde lecture rapide du 2 oct.). Identifiant dont le
   nom finit par « -full » (ex. taro-full-1). Decision de l'auteur, 12 oct. */
const isFullReader = () => !!reader && person(reader.id).endsWith("-full");
/* Version autonome : la seconde lecture ne s'active que si la cohorte le demande
   (second_reading: true) et fournit ref_auteur.json. */
const secondOn = () => !!(COH && COH.second_reading);
const isSecond = () => secondOn() && isStep1() && !isArbEdit() && !!reader && person(reader.id) !== AUTHOR && !isFullReader();
/* Etape 2, meme principe : pointer les poils manques, verrouiller, valider les traces de l'auteur. */
const isSecondTrace = () => secondOn() && isTrace() && !!reader && person(reader.id) !== AUTHOR && !isFullReader();
let TRACE_STR = null, COMPLETE_STR = null, ARB_STR = null, SECOND_STR = null, TRACE2_STR = null;
const S = () => (isTrace() && TRACE_STR ? (isSecondTrace() && TRACE2_STR ? TRACE2_STR[lang] : TRACE_STR[lang])
  : isComplete() && COMPLETE_STR ? COMPLETE_STR[lang]
  : isArbitrate() && ARB_STR ? ARB_STR[lang] : isSecond() && SECOND_STR ? SECOND_STR[lang] : STR[lang]);
const STEP1_TRACE = {
  en: { trTool: "Trace", trNewHair: "New path (Esc)",
        trStart: "Click where the bridge starts, on the shape or on the signal — in the projection or in 3D.",
        trContinue: "Click further along the signal: the path follows it. Esc or right-click: start a new path." },
  ja: { trTool: "トレース", trNewHair: "新しい経路（Esc）",
        trStart: "橋の始まる点（形または信号の上）をクリックします（投影または3D）。",
        trContinue: "信号に沿って続けてクリックすると、経路が信号をたどります。Esc または右クリックで新しい経路を始めます。" },
};
const tut = () => (isTrace() ? (isSecondTrace() ? SECOND_TRACE_TUTORIAL : TRACE_TUTORIAL) : isSecond() ? SECOND_TUTORIAL : TUTORIAL);
const goalCount = () => (hasHalo() || isArbitrate() || isArbEdit() ? COH.slabs.filter(s => !s.tutorial).length : GOAL);

/* ===========================================================================
   Persistance — trois etages, du plus durable au plus sur
   ---------------------------------------------------------------------------
   1. La base partagee, quand le lecteur a le droit d'y ecrire. C'est la seule
      voie par laquelle les reponses reviennent toutes seules a l'auteur.
   2. Le stockage local du navigateur, TOUJOURS ecrit, et ecrit EN PREMIER.
      Il n'atteint personne d'autre, mais il survit a un rechargement, a une
      coupure de reseau et a un refus de la base.
   3. L'export de fichier, declenche par le lecteur.

   L'ordre compte : on ecrit localement avant de tenter la base, jamais
   l'inverse. Une reponse perdue parce que le reseau a laché pendant l'ecriture
   distante est une reponse qu'il faut redonner, et un lecteur qui doit
   recommencer ne recommence pas.
   ======================================================================== */
const CHUNK = 32;      /* reponses par document partage */

const store = {
  db: null, user: null, downloads: null,
  mode: "local", ready: false, orgId: null, lastError: null,
  peers: {},           /* reader_id -> liste des dalles qu'il a lues */
  started: {},         /* reader_id -> debut de sa premiere session */

  async init() {
    const use = async n => {
      try { return (await window.claude?.use?.(n)) ?? null; } catch { return null; }
    };
    [this.db, this.user, this.downloads] = await Promise.all(
      ["db", "user", "downloads"].map(use));
    this.ready = true;
    try { this.orgId = (await this.user?.id?.()) ?? null; } catch { this.orgId = null; }
    if (this.db) {
      /* Le droit d'ecriture ne se lit pas, il s'eprouve : `can` peut ne rien
         dire, et seule une ecriture refusee tranche. On sonde donc une fois,
         sur le document qui n'appartient qu'a ce lecteur. */
      try { await this.pushReader(); this.mode = "shared"; }
      catch { this.mode = "local"; }
    }
    paintSave();
    if (this.mode === "shared") { await this.pullMine(); await this.pullPeers(); }
  },

  /* --- decoupage -----------------------------------------------------------
     La base plafonne a 5 000 documents. Un document par couple (lecteur,
     dalle) donnerait 20 lecteurs x 240 dalles = 4 800 : on ecrirait jusqu'au
     plafond, et une campagne un peu plus fournie s'y casserait le nez sans
     prevenir. Les reponses sont donc groupees par paquets de 32, ce qui ramene
     le compte a quelques centaines de documents.

     Les listes de voxels vivent a part, et seulement quand elles existent :
     la plupart des dalles n'en ont aucune, et les garder dans le paquet
     ferait grossir un document au-dela de ses 256 Kio. */
  chunkOf(id) { const s = byId.get(id); return Math.floor((s ? s.rank : 0) / CHUNK); },
  slim(v) {
    const { added_index, removed_index, cut_index, filled_index, attached_index, ...rest } = v;
    return rest;
  },
  hasEdits(v) {
    return (v.added_index || []).length || (v.removed_index || []).length ||
           (v.cut_index || []).length || (v.filled_index || []).length;
  },
  /* Document de retouches perime : jusqu'au 9 oct., une reponse revisee sans
     retouche ne le reecrivait pas, et celui de la reponse precedente restait
     (<tuile>, <dalle>). Une liste non vide la ou la reponse annonce 0
     le trahit : on l'ignore en entier. Meme regle que `merge_edits` (Python). */
  staleEdits(v, body) {
    if (!v || !body) return false;
    return [["added_index", "added_voxels"], ["removed_index", "removed_voxels"],
            ["filled_index", "filled_voxels"], ["attached_index", "attached_voxels"]]
      .some(([k, c]) => v[c] === 0 && (body[k] || []).length > 0);
  },

  localAll() {
    try { return JSON.parse(localStorage.getItem(`hcr:${reader.id}`) || "{}"); }
    catch { return {}; }
  },
  localWrite(all) {
    try { localStorage.setItem(`hcr:${reader.id}`, JSON.stringify(all)); }
    catch { /* quota, ou navigation privee : la voie distante reste */ }
  },

  async pushReader() {
    /* `set` remplace le document entier : la liste des dalles lues doit donc
       partir avec, sinon chaque enregistrement l'effacerait. */
    await this.db.doc(`readers/${reader.id}`).set({
      reader_id: reader.id,
      org_id: this.orgId,
      started_at: reader.startedAt,
      last_seen: new Date().toISOString(),
      lang,
      done: Object.keys(mine),
      step1: reader.step1 || null,
      search_page: Number.isInteger(reader.searchPage) ? reader.searchPage + 1 : null,
      user_agent: navigator.userAgent.slice(0, 180),
    });
  },

  async put(id, verdict) {
    const all = this.localAll();
    all[id] = verdict;
    this.localWrite(all);
    mine[id] = verdict;
    if (!this.db || this.mode !== "shared") { paintSave(); return; }
    setSaving(true);
    try {
      const chunk = this.chunkOf(id);
      const answers = {};
      for (const [key, value] of Object.entries(mine))
        if (this.chunkOf(key) === chunk) answers[key] = this.slim(value);
      await this.db.doc(`verdicts/${reader.id}__${chunk}`).set({
        reader_id: reader.id, chunk, at: new Date().toISOString(), answers,
      });
      if (this.hasEdits(verdict) || verdict.revisions) {
        await this.db.doc(`edits/${reader.id}__${id}`).set({
          reader_id: reader.id, slab_id: id,
          added_index: verdict.added_index || [],
          removed_index: verdict.removed_index || [],
          cut_index: verdict.cut_index || [],
          filled_index: verdict.filled_index || [],
          ...(verdict.attached_index ? { attached_index: verdict.attached_index } : {}),
        });
      }
      await this.pushReader();
    } catch (err) {
      /* `quota_exceeded` n'est pas transitoire : le dire, plutot que de
         laisser le lecteur croire que tout est enregistre. */
      this.mode = "local";
      this.lastError = err && err.code ? err.code : "unavailable";
    }
    setSaving(false);
    paintSave();
  },

  async pullMine() {
    try {
      const quand = v => (v && (v.revised_at || v.confirmed_at || v.at)) || "";
      const snap = await this.db.collection("verdicts")
        .where("reader_id", "==", reader.id).get();
      const enBase = {};
      for (const doc of snap.docs) {
        const body = doc.data() || {};
        for (const [id, value] of Object.entries(body.answers || {})) {
          enBase[id] = value;
          /* la plus recente l'emporte : une copie locale plus ancienne,
             renvoyee avec son paquet, ecraserait la revision faite ailleurs */
          if (!mine[id] || quand(value) > quand(mine[id])) mine[id] = value;
        }
      }
      const edits = await this.db.collection("edits")
        .where("reader_id", "==", reader.id).get();
      const avecDoc = new Set();
      for (const doc of edits.docs) {
        const body = doc.data() || {};
        avecDoc.add(body.slab_id);
        const target = mine[body.slab_id];
        if (target && !this.staleEdits(target, body)) {
          target.added_index = body.added_index || [];
          target.removed_index = body.removed_index || [];
          target.cut_index = body.cut_index || [];
          target.filled_index = body.filled_index || [];
        }
      }
      /* Une reponse confirmee pendant une panne de la base n'est partie qu'en
         local. La confirmation suivante a reecrit son morceau de reponses, mais
         pas son document de retouches (9 oct., completion page 1 : <dalle>,
         <dalle>, <dalle>). On le reecrit depuis la copie locale, si
         c'est bien la meme reponse que celle de la base. */
      const local = this.localAll();
      for (const [id, v] of Object.entries(local)) {
        if (avecDoc.has(id) || !v || v.slab_id !== id || !this.hasEdits(v)) continue;
        if (!enBase[id] || quand(enBase[id]) !== quand(v)) continue;
        await this.db.doc(`edits/${reader.id}__${id}`).set({
          reader_id: reader.id, slab_id: id,
          added_index: v.added_index || [], removed_index: v.removed_index || [],
          cut_index: v.cut_index || [], filled_index: v.filled_index || [],
          ...(v.attached_index ? { attached_index: v.attached_index } : {}),
        });
        this.editsRepaired = (this.editsRepaired || []).concat(id);
        if (mine[id] && !this.hasEdits(mine[id])) {
          for (const k of ["added_index", "removed_index", "cut_index", "filled_index", "attached_index"])
            if (v[k]) mine[id][k] = v[k];
        }
      }
      /* Reponses restees en local : donnees sans droit d'ecriture (invite en
         commentateur, puis passe editeur : Test-2, 12 oct., 10 reponses sur 12)
         ou pendant une panne. Une confirmation ne reecrit que le paquet de sa
         dalle : les autres paquets n'auraient jamais rejoint la base. Jamais
         pour l'auteur : ses lectures sont closes, la base fait foi. */
      const aEnvoyer = person(reader.id) === AUTHOR ? [] : Object.keys(mine).filter(id => byId.has(id) &&
        (!enBase[id] || quand(mine[id]) > quand(enBase[id])));
      for (const chunk of new Set(aEnvoyer.map(id => this.chunkOf(id)))) {
        const answers = {};
        for (const [key, value] of Object.entries(mine))
          if (this.chunkOf(key) === chunk) answers[key] = this.slim(value);
        await this.db.doc(`verdicts/${reader.id}__${chunk}`).set({
          reader_id: reader.id, chunk, at: new Date().toISOString(), answers,
        });
      }
      for (const id of aEnvoyer) {
        const v = mine[id];
        if (!this.hasEdits(v) && !v.revisions) continue;
        await this.db.doc(`edits/${reader.id}__${id}`).set({
          reader_id: reader.id, slab_id: id,
          added_index: v.added_index || [], removed_index: v.removed_index || [],
          cut_index: v.cut_index || [], filled_index: v.filled_index || [],
          ...(v.attached_index ? { attached_index: v.attached_index } : {}),
        });
      }
      if (aEnvoyer.length) await this.pushReader();
      this.localWrite(mine);
    } catch { /* on garde ce que le stockage local contient */ }
  },

  /* Chaque lecteur possede son document et n'ecrit que le sien : le compte de
     lectures se derive en les additionnant, sans compteur partage. Un compteur
     construit par lecture-modification-ecriture perdrait des increments — la
     derniere ecriture gagne — et fausserait l'ordonnancement. */
  async pullPeers() {
    try {
      const snap = await this.db.collection("readers").get();
      const tally = {};
      for (const doc of snap.docs) {
        const body = doc.data() || {};
        this.peers[body.reader_id] = body.done || [];
        this.started[body.reader_id] = body.started_at || "";
        /* L'auteur relit tout, en second lecteur : ses lectures n'entrent pas
           dans l'ordre de service, pour que les volontaires couvrent le plus
           de dalles distinctes possible. */
        if (person(body.reader_id) === AUTHOR) continue;
        /* un identifiant « test… » sert a essayer l'outil : il ne compte pas */
        if (person(body.reader_id).startsWith("test")) continue;
        for (const id of body.done || []) tally[id] = (tally[id] || 0) + 1;
      }
      counts = tally;
    } catch { /* ordonnancement par rang seul */ }
  },

  async collectAll() {
    if (!this.db) return null;
    const out = [];
    const snap = await this.db.collection("verdicts").get();
    for (const doc of snap.docs) {
      const body = doc.data() || {};
      for (const value of Object.values(body.answers || {})) out.push(value);
    }
    const index = new Map(out.map(v => [`${v.reader_id}__${v.slab_id}`, v]));
    const edits = await this.db.collection("edits").get();
    for (const doc of edits.docs) {
      const body = doc.data() || {};
      const target = index.get(`${body.reader_id}__${body.slab_id}`);
      if (target && !this.staleEdits(target, body)) {
        target.added_index = body.added_index || [];
        target.removed_index = body.removed_index || [];
        target.cut_index = body.cut_index || [];
        target.filled_index = body.filled_index || [];
      }
    }
    return out;
  },
};

/* ===========================================================================
   Chargement des dalles — atlas WebP, un paquet porte plusieurs dalles
   ======================================================================== */
const packCache = new Map();    /* nom -> ImageData de la bande entiere */
const slabCache = new Map();    /* slab_id -> {vol, skin} */
const PACK_KEEP = 8, SLAB_KEEP = 24;

/* `HTMLImageElement.decode()` a laisse une promesse pendante au SECOND appel
   pendant les essais : l'image etait chargee, le bouton bascule, et l'affichage
   ne suivait jamais. `onload` couvre exactement le meme besoin — l'image est
   utilisable par `drawImage` des cet evenement — sans dependre de la semantique
   de `decode`. Un lecteur bloque sur un chargement ne recommence pas. */
function loadImage(src){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image introuvable : " + src));
    img.src = src;
  });
}

async function packData(name) {
  if (packCache.has(name)) return packCache.get(name);
  const img = await loadImage(dataUrl(name.includes("/") ? name : `atlas/${name}`));
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  packCache.set(name, data);
  while (packCache.size > PACK_KEEP) packCache.delete(packCache.keys().next().value);
  return data;
}

function decodeSlab(sheetData, slot) {
  const W = sheetData.width, px = sheetData.data;
  const top = slot * ROWS * BOX;
  const out = new Uint8Array(BOX * BOX * BOX * 4);
  for (let z = 0; z < BOX; z++) {
    const r = (z / COLS) | 0, c = z % COLS;
    for (let y = 0; y < BOX; y++) {
      let s = (((top + r * BOX + y) * W) + c * BOX) * 4;
      let d = ((z * BOX + y) * BOX) * 4;
      for (let x = 0; x < BOX; x++, s += 4, d += 4) {
        out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2];
        out[d + 3] = ST_NEUTRAL;
      }
    }
  }
  /* Carte de peau : profondeur sur 16 bits repartie sur R et G, validite sur B.
     Trois etats, pas deux — 255 dans la boite, 128 hors de la boite, 0 absente.
     On ne dessine que le premier : une peau hors boite plaquee contre le bord
     ferait lire une profondeur fausse. */
  const sr = (SKIN_SLOT / COLS) | 0, sc = SKIN_SLOT % COLS;
  const skin = new Uint8Array(BOX * BOX * 4);
  for (let y = 0; y < BOX; y++) {
    let s = (((top + sr * BOX + y) * W) + sc * BOX) * 4;
    let d = (y * BOX) * 4;
    for (let x = 0; x < BOX; x++, s += 4, d += 4) {
      skin[d] = px[s]; skin[d + 1] = px[s + 1];
      skin[d + 2] = px[s + 2] === 255 ? 255 : 0; skin[d + 3] = 255;
    }
  }
  return { vol: out, skin };
}

async function fetchSlab(id) {
  if (slabCache.has(id)) {
    const c = slabCache.get(id);
    return { vol: c.vol.slice(), skin: c.skin };
  }
  const s = byId.get(id);
  if (s.halo_pack) {
    /* Mode trace : la marge de la tuile est decodee une fois, puis chaque
       fenetre en est extraite. Pas de cache par fenetre : la marge fait foi. */
    const tileId = s.window_of || s.slab_id, base = byId.get(tileId);
    if (!halo || halo.tile !== tileId) {
      const sheet = await packData(base.halo_pack);
      const size = base.halo_size;
      halo = { tile: tileId, size, ...decodeRegion(sheet, base.halo_slot, size),
               edit: new Uint8Array(size * size * BOX), lab: null };
    }
    return windowData(...s.window_xy);
  }
  const sheet = await packData(s.pack);
  const got = decodeSlab(sheet, s.pack_slot);
  slabCache.set(id, got);
  while (slabCache.size > SLAB_KEEP) slabCache.delete(slabCache.keys().next().value);
  return { vol: got.vol.slice(), skin: got.skin };
}

/* Precharge les paquets des prochaines dalles neuves de la file. */
function prefetch(n) {
  let seen = 0;
  for (const id of queue) {
    if (mine[id] || id === frontierId) continue;
    if (byId.has(id)) { const s = byId.get(id); packData(s.halo_pack || s.pack).catch(() => {}); }
    if (++seen >= n) break;
  }
}

/* ===========================================================================
   Rendu volumique — lancer de rayons WebGL2
   ---------------------------------------------------------------------------
   Deux differences avec la version de bureau, toutes deux imposees par les
   donnees source.

   La boite est quasi isotrope : 48 voxels par axe au pas natif (1,1,2) couvrent
   2,54 x 2,62 x 2,48 mm. Les demi-cotes viennent donc de l'espacement
   PHYSIQUE de la dalle, et non du nombre de voxels — sinon un objet rond
   paraitrait aplati d'un vingtieme.

   La peau n'est plus un plan. Sur une dalle prise autour d'une composante, la
   surface cutanee ondule ; elle arrive dans une carte 2D par colonne, avec
   trois etats de validite, et se dessine comme une nappe, pas comme un plan.
   ======================================================================== */
const cv = $("gl");
const gl = cv.getContext("webgl2", { antialias: false, alpha: false });
let prog, tex, skinMap, uni = {}, glOK = false;

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
uniform sampler3D uVol;
uniform sampler2D uSkinMap;
uniform mat3 uRot;
uniform vec3 uHalf, uBg, uMarkCol, uOtherCol, uSkinCol, uAddCol;
uniform vec2 uPan;
uniform float uFloor, uCeil, uGamma, uOpacity, uExtent, uAspect, uBox;
uniform int uChan, uOverlay, uSkin, uOthers, uRender, uSplit, uFaceOn, uAdded;
uniform vec3 uFaceCell, uFaceDir, uStep;
in vec2 vUv; out vec4 frag;

vec4 nearestS(vec3 tc){ return texture(uVol, (floor(tc / uStep) + 0.5) * uStep); }
/* codes du canal alpha : 0 neutre · 64 coupe · 128 retire · 180..230 partie ·
   236..251 ajoute dans une partie · 255 ajoute */
bool isCut(float a){ return a > 0.18 && a < 0.33; }
bool isRemoved(float a){ return a > 0.40 && a < 0.65; }
bool isPart(float a){ return a > 0.68 && a < 0.915; }
bool isAddedPart(float a){ return a > 0.915 && a < 0.992; }
vec3 partColor(float a){
  int k = int(floor((a * 255.0 - 175.0) / 10.0));
  if (k <= 0) return vec3(0.498, 0.831, 0.961);
  if (k == 1) return vec3(0.310, 0.820, 0.771);
  if (k == 2) return vec3(0.969, 0.561, 0.702);
  if (k == 3) return vec3(0.627, 0.659, 1.000);
  if (k == 4) return vec3(0.624, 0.694, 0.741);
  return vec3(0.784, 0.831, 0.871);
}
vec3 addedPartColor(float a){
  float k = floor((a * 255.0 - 234.5) / 3.0);
  return partColor((180.0 + 10.0 * k) / 255.0);
}
const vec3 CUT_COL = vec3(0.694, 0.294, 1.000);
float maskN(vec3 tc){
  vec4 s = nearestS(tc);
  if (isRemoved(s.a) || isCut(s.a)) return 0.0;
  return max(s.g, s.a > 0.68 ? 1.0 : 0.0);
}
float edgeness(vec3 tc){
  vec3 d = vec3(0.5) - abs(fract(tc / uStep) - 0.5);
  float lo = min(min(d.x, d.y), d.z), hi = max(max(d.x, d.y), d.z);
  return d.x + d.y + d.z - lo - hi;
}
float win(float v){
  float t = clamp((v - uFloor) / max(uCeil - uFloor, 1e-4), 0.0, 1.0);
  return pow(t, 1.0 / uGamma);
}
/* Profondeur de peau a cette colonne, en coordonnee de texture.
   Renvoie -1 quand la peau n'existe pas ou sort de la boite : l'appelant ne
   dessine alors aucune nappe, plutot qu'une nappe fausse plaquee au bord. */
float skinAt(vec2 xy){
  vec3 s = texture(uSkinMap, xy).rgb;
  if (s.b < 0.75) return -1.0;
  float z16 = s.r * 255.0 * 256.0 + s.g * 255.0;
  float zd = z16 * ((uBox + 2.0) / 65535.0) - 1.0;
  return (zd + 0.5) / uBox;
}
void main(){
  vec2 uv = vec2(vUv.x * uAspect, vUv.y) * uExtent + uPan;
  vec3 ro = uRot * vec3(uv, 3.0);
  vec3 rd = uRot * vec3(0.0, 0.0, -1.0);
  vec3 iv = 1.0 / rd;
  vec3 ta = (-uHalf - ro) * iv, tb = (uHalf - ro) * iv;
  vec3 tn = min(ta, tb), tf = max(ta, tb);
  float t0 = max(max(max(tn.x, tn.y), tn.z), 0.0);
  float t1 = min(min(tf.x, tf.y), tf.z);
  if (t1 <= t0) { frag = vec4(uBg, 1.0); return; }
  const int N = 168;
  float dt = (t1 - t0) / float(N);
  float alpha = 0.0; vec3 rgb = vec3(0.0);
  for (int i = 0; i < N; i++){
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    /* Z ecran vers le haut = indice 0 = le moins profond, donc au-dessus de la peau */
    vec3 tc = vec3(p.x / (2.0 * uHalf.x) + 0.5, p.y / (2.0 * uHalf.y) + 0.5,
                   0.5 - p.z / (2.0 * uHalf.z));
    vec4 s = uRender == 1 ? texture(uVol, (floor(tc / uStep) + 0.5) * uStep)
                          : texture(uVol, tc);
    float v = win(s.r);

    if (uFaceOn == 1){
      vec3 vpos = tc / uStep;
      if (all(lessThan(abs(floor(vpos) - uFaceCell), vec3(0.5)))){
        vec3 f = fract(vpos);
        float along = dot(f, abs(uFaceDir));
        float side = dot(uFaceDir, vec3(1.0));
        if (side > 0.0 ? along > 0.55 : along < 0.45){
          rgb += (1.0 - alpha) * 0.62 * uAddCol;
          alpha += (1.0 - alpha) * 0.62;
          if (alpha > 0.995) break;
        }
      }
    }

    if (uSplit == 1 && uOverlay == 1){
      float st = nearestS(tc).a;
      if (isCut(st)){
        float ca = edgeness(tc) < 0.13 ? 0.80 : 0.22;
        rgb += (1.0 - alpha) * ca * CUT_COL;
        alpha += (1.0 - alpha) * ca;
        if (alpha > 0.995) break;
        continue;
      }
      if (isPart(st) || isAddedPart(st)){
        vec3 n = normalize(vec3(
          maskN(tc + vec3(uStep.x, 0.0, 0.0)) - maskN(tc - vec3(uStep.x, 0.0, 0.0)),
          maskN(tc + vec3(0.0, uStep.y, 0.0)) - maskN(tc - vec3(0.0, uStep.y, 0.0)),
          maskN(tc + vec3(0.0, 0.0, uStep.z)) - maskN(tc - vec3(0.0, 0.0, uStep.z))) + 1e-5);
        float lam = 0.40 + 0.60 * abs(dot(n, normalize(uRot * vec3(0.4, 0.55, 1.0))));
        vec3 pc = isAddedPart(st) ? (edgeness(tc) < 0.13 ? addedPartColor(st) : uAddCol) : partColor(st);
        rgb += (1.0 - alpha) * pc * lam;
        alpha = 1.0; break;
      }
    }

    if (uOverlay == 1 && isRemoved(nearestS(tc).a)){
      if (edgeness(tc) < 0.11){
        rgb += (1.0 - alpha) * 0.55 * vec3(0.92, 0.22, 0.18);
        alpha += (1.0 - alpha) * 0.55;
        if (alpha > 0.995) break;
      }
      continue;
    }

    if (uRender == 2 && uOverlay == 1 && maskN(tc) > 0.45){
      vec3 n = normalize(vec3(
        maskN(tc + vec3(uStep.x, 0.0, 0.0)) - maskN(tc - vec3(uStep.x, 0.0, 0.0)),
        maskN(tc + vec3(0.0, uStep.y, 0.0)) - maskN(tc - vec3(0.0, uStep.y, 0.0)),
        maskN(tc + vec3(0.0, 0.0, uStep.z)) - maskN(tc - vec3(0.0, 0.0, uStep.z))) + 1e-5);
      float lam = 0.38 + 0.62 * abs(dot(n, normalize(uRot * vec3(0.4, 0.55, 1.0))));
      rgb += (1.0 - alpha) * (nearestS(tc).a > 0.75 ? uAddCol : uMarkCol) * lam;
      alpha = 1.0;
      break;
    }

    float a = uRender == 1 ? (v > 0.16 ? v * uOpacity * 1.5 : 0.0) : v * v * uOpacity;
    vec3 c = vec3(v);
    if (uOthers == 1 && s.b > 0.45){
      c = mix(vec3(v), uOtherCol, 0.55);
      a = max(a, 0.09);
    }
    if (uOverlay == 1 && s.g > 0.45){
      c = mix(vec3(v), uMarkCol, 0.72);
      a = max(a, 0.18);
    }
    if (uAdded == 1 && nearestS(tc).a > 0.75 && uSplit == 0){
      c = mix(vec3(v), uAddCol, 0.80);
      a = max(a, 0.24);
    }
    /* Peau : un quadrillage pose sur la surface, pas une nappe. Affichee par
       defaut, une nappe pleine masquait tout ce qui passe dessous — c'est-a-dire
       la moitie du sujet. Le quadrillage dit ou elle passe et laisse voir a
       travers ; un voile tres leger entre les lignes garde la surface lisible
       de profil. */
    if (uSkin == 1){
      float sz = skinAt(tc.xy);
      if (sz >= 0.0 && abs(tc.z - sz) < 0.7 / uBox){
        vec2 cell = fract(tc.xy * uBox / 8.0);
        float line = min(min(cell.x, 1.0 - cell.x), min(cell.y, 1.0 - cell.y));
        bool onLine = line < 0.035;
        c = mix(c, uSkinCol, onLine ? 0.80 : 0.30);
        a = max(a, onLine ? 0.20 : 0.010);
      }
    }
    rgb += (1.0 - alpha) * a * c;
    alpha += (1.0 - alpha) * a;
    if (alpha > 0.995) break;
  }
  frag = vec4(mix(uBg, rgb / max(alpha, 1e-3), clamp(alpha, 0.0, 1.0)), 1.0);
}`;

function sh(t, src) {
  const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o);
  if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(o)); return null; }
  return o;
}

function initGL() {
  if (!gl) return false;
  const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
  if (!v || !f) return false;
  prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return false; }
  gl.useProgram(prog);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const l = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
  for (const n of ["uVol","uSkinMap","uRot","uHalf","uBg","uMarkCol","uOtherCol","uSkinCol",
                   "uAddCol","uPan","uFloor","uCeil","uGamma","uOpacity","uExtent","uAspect",
                   "uBox","uChan","uOverlay","uSkin","uOthers","uAdded","uRender","uStep",
                   "uSplit","uFaceOn","uFaceCell","uFaceDir"])
    uni[n] = gl.getUniformLocation(prog, n);

  tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const p of ["TEXTURE_WRAP_S","TEXTURE_WRAP_T","TEXTURE_WRAP_R"])
    gl.texParameteri(gl.TEXTURE_3D, gl[p], gl.CLAMP_TO_EDGE);

  skinMap = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, skinMap);
  /* La carte de peau se lit au plus proche voisin : interpoler deux colonnes
     dont l'une est invalide inventerait une profondeur intermediaire. */
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.uniform1i(uni.uVol, 0);
  gl.uniform1i(uni.uSkinMap, 1);
  gl.uniform1f(uni.uBox, BOX);
  gl.uniform3f(uni.uStep, 1 / BOX, 1 / BOX, 1 / BOX);
  return true;
}

function upload() {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, BOX, BOX, BOX, 0, gl.RGBA, gl.UNSIGNED_BYTE, vol);
}
function uploadSkin() {
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, skinMap);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BOX, BOX, 0, gl.RGBA, gl.UNSIGNED_BYTE, skinTex);
}
function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function rgbOf(c) {
  const d = document.createElement("canvas").getContext("2d");
  d.fillStyle = c; d.fillRect(0, 0, 1, 1);
  const p = d.getImageData(0, 0, 1, 1).data;
  return [p[0] / 255, p[1] / 255, p[2] / 255];
}
/* Camera en tourne-disque : `yaw` tourne autour de Z (la normale a la peau),
   `pitch` incline de la vue de dessus (0) a la vue de dessous (pi), le profil
   etant a pi/2. Z reste donc toujours vers le haut de l'ecran : le bloc ne
   peut plus se retrouver a l'envers, et un profil s'obtient depuis n'importe
   quel cote. A yaw = 0 la matrice est celle de la version precedente, donc la
   vue d'ouverture n'a pas change. Colonnes : axe droit, axe haut, vers l'oeil. */
function rotMat() {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return new Float32Array([cy, sy, 0, -sy*cp, cy*cp, sp, sy*sp, -cy*sp, cp]);
}
function halfExtent() {
  const sp = (slab && slab.spacing_mm) || [1, 1, 1];
  const m = Math.max(sp[0], sp[1], sp[2]);
  return [sp[0] / m, sp[1] / m, sp[2] / m];
}
function drawGL() {
  if (!glOK || !vol) return;
  const box = $("v3d").getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  gl.viewport(0, 0, w, h);
  const bg = rgbOf(css("--stagebg")), mk = rgbOf(css("--mark")), sk = rgbOf(css("--skin"));
  const ad = rgbOf(css("--added")), ot = rgbOf(css("--other"));
  gl.uniform3f(uni.uBg, bg[0], bg[1], bg[2]);
  gl.uniform3f(uni.uMarkCol, mk[0], mk[1], mk[2]);
  gl.uniform3f(uni.uSkinCol, sk[0], sk[1], sk[2]);
  gl.uniform3f(uni.uAddCol, ad[0], ad[1], ad[2]);
  gl.uniform3f(uni.uOtherCol, ot[0], ot[1], ot[2]);
  const hx = halfExtent();
  gl.uniform3f(uni.uHalf, hx[0], hx[1], hx[2]);
  gl.uniform1i(uni.uAdded, overlay ? 1 : 0);
  gl.uniformMatrix3fv(uni.uRot, false, rotMat());
  gl.uniform2f(uni.uPan, panX, panY);
  gl.uniform1f(uni.uFloor, +F.value / 255);
  gl.uniform1f(uni.uCeil, +C.value / 255);
  gl.uniform1f(uni.uGamma, +G.value / 100);
  gl.uniform1f(uni.uOpacity, +O.value / 100);
  gl.uniform1f(uni.uExtent, 1.3 / zoom);
  gl.uniform1f(uni.uAspect, w / h);
  gl.uniform1i(uni.uChan, 0);
  gl.uniform1i(uni.uOverlay, overlay ? 1 : 0);
  gl.uniform1i(uni.uSkin, skinOn ? 1 : 0);
  gl.uniform1i(uni.uOthers, othersOn ? 1 : 0);
  gl.uniform1i(uni.uRender, RENDERS.indexOf(render));
  gl.uniform1i(uni.uSplit, splitOn ? 1 : 0);
  gl.uniform1i(uni.uFaceOn, face ? 1 : 0);
  if (face) {
    gl.uniform3f(uni.uFaceCell, face.cell[0], face.cell[1], face.cell[2]);
    gl.uniform3f(uni.uFaceDir, face.dir[0], face.dir[1], face.dir[2]);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  placeGnomon();
}
function placeGnomon() {
  const m = rotMat();
  const axes = { gX: [m[0], m[3], m[6]], gZ: [m[2], m[5], m[8]] };
  for (const [id, [ax, ay, az]] of Object.entries(axes)) {
    const g = $(id); if (!g) continue;
    const len = Math.hypot(ax, ay);
    const ang = Math.atan2(-ay, ax) * 180 / Math.PI;
    const base = id === "gZ" ? 90 : 0;
    g.setAttribute("transform", `rotate(${(ang + base).toFixed(1)}) scale(${Math.max(len, 0.08).toFixed(3)} 1)`);
    g.setAttribute("opacity", (az < 0 ? 0.42 : 1).toFixed(2));
  }
  const eq = $("gEq");
  if (eq) eq.setAttribute("ry", (30 * Math.abs(Math.sin(pitch)) + 1).toFixed(1));
}

/* ===========================================================================
   Projection d'intensite maximale
   ---------------------------------------------------------------------------
   Regle de superposition, en profondeur croissante depuis l'observateur :
     - le REMPLISSAGE prend la couleur du premier voxel etiquete non retire ;
     - une BORDURE signale qu'un voxel retire ou coupe existe dans la colonne ;
     - une colonne qui ne contient que des retires est pleine rouge.
   Un retrait n'efface donc jamais ce qui est dessous, et ne se fait jamais
   passer pour un ajout.
   ======================================================================== */
const mc = $("mip"), mx = mc.getContext("2d");

function drawMIP() {
  if (!vol) return;
  const lo = +F.value, hi = +C.value, ig = 100 / +G.value;
  /* Deux calques : le signal seul, et les couleurs d'annotation avec leur
     opacite. Separes, ils permettent de poser le signal de la dalle par-dessus
     le champ en gardant le plus clair des deux — la dalle n'echantillonne qu'un
     plan sur deux en profondeur, sa projection est plus sombre, et l'interieur
     du carre paraissait noirci. */
  const img = mx.createImageData(BOX, BOX);
  const ovl = mx.createImageData(BOX, BOX);
  const bg = rgbOf(css("--stagebg")).map(x => x * 255);
  const mk = rgbOf(css("--mark")).map(x => x * 255);
  const ad = rgbOf(css("--added")).map(x => x * 255);
  const ot = rgbOf(css("--other")).map(x => x * 255);
  const red = [235, 56, 46];
  const cutRgb = [1, 3, 5].map(i => parseInt(CUT_COLOR.slice(i, i + 2), 16));
  const border = [];
  for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    let best = 0, fill = null, anyRemoved = false, anyCut = false, anyOther = false;
    for (let z = 0; z < BOX; z++) {
      const o = ((z * BOX + y) * BOX + x) * 4;
      if (vol[o] > best) best = vol[o];
      if (othersOn && vol[o + 2] > 115) anyOther = true;
      if (!overlay) continue;
      const st = vol[o + 3];
      if (st === ST_REMOVED) { anyRemoved = true; continue; }
      if (st === ST_CUT) { anyCut = true; continue; }
      if (fill !== null) continue;
      if (st === ST_ADDED) fill = ad;
      else if (splitOn && st >= ADDED_PART_BASE)
        fill = PART_RGB[Math.min((st - ADDED_PART_BASE) / ADDED_PART_STEP | 0, PART_RGB.length - 1)];
      else if (splitOn) {
        if (st >= PART_BASE) fill = PART_RGB[Math.min((st - PART_BASE) / PART_STEP | 0, PART_RGB.length - 1)];
      } else if (vol[o + 1] > 115) fill = mk;
    }
    const tv = Math.min(1, Math.max(0, (best - lo) / Math.max(hi - lo, 1)));
    const g = Math.pow(tv, ig) * 255;
    const k = ((BOX - 1 - y) * BOX + x) * 4;
    const paint = fill || (anyCut ? cutRgb : anyRemoved ? red : anyOther ? ot : null);
    /* Les autres formes se lisent en marron franc : a 30 %, sur un signal en
       niveaux de gris, on ne les distinguait pas du signal lui-meme. */
    const strength = fill ? 0.72 : (anyCut || anyRemoved) ? 0.72 : 0.55;
    for (let c = 0; c < 3; c++) {
      img.data[k + c] = bg[c] + (255 - bg[c]) * g / 255;
      if (paint) ovl.data[k + c] = paint[c];
    }
    img.data[k + 3] = 255;
    ovl.data[k + 3] = paint ? Math.round(strength * 255) : 0;
    if (fill && (anyCut || anyRemoved)) border.push([x, BOX - 1 - y, anyCut ? cutRgb : red]);
  }
  const box = $("vmip").getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  mc.width = Math.max(1, Math.round(box.width * dpr));
  mc.height = Math.max(1, Math.round(box.height * dpr));
  const off = document.createElement("canvas");
  off.width = BOX; off.height = BOX;
  off.getContext("2d").putImageData(img, 0, 0);
  const offOvl = document.createElement("canvas");
  offOvl.width = BOX; offOvl.height = BOX;
  offOvl.getContext("2d").putImageData(ovl, 0, 0);

  const t = mipTransform(mc.width, mc.height);
  mipView = t;
  mx.fillStyle = css("--stagebg"); mx.fillRect(0, 0, mc.width, mc.height);
  /* 1. le champ entier, en contexte */
  const fp = fieldPaint();
  if (fp) {
    mx.imageSmoothingEnabled = t.s < 2.5;
    mx.drawImage(fp, (0 - t.wx0) * t.s, (t.wy1 - field.h) * t.s, field.w * t.s, field.h * t.s);
  }
  /* 2. la dalle, a sa place exacte : c'est elle qui porte la forme a juger,
        les ajouts, les retraits et les coupes */
  mx.imageSmoothingEnabled = false;
  /* Le contexte ayant desormais la profondeur de la dalle, l'interieur du carre
     montre la projection nette de la dalle elle-meme, sans melange. */
  mx.drawImage(off, t.px0, t.py0, t.sideW, t.sideH);
  mx.drawImage(offOvl, t.px0, t.py0, t.sideW, t.sideH);
  if (border.length) {
    const cell = t.sideW / BOX;
    mx.lineWidth = Math.max(1, cell * 0.18);
    for (const [bx, by, col] of border) {
      mx.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      mx.strokeRect(t.px0 + bx * cell + mx.lineWidth / 2, t.py0 + by * cell + mx.lineWidth / 2,
                    cell - mx.lineWidth, cell - mx.lineWidth);
    }
  }
  /* 3. le carre de la vue 3D, fixe : on dezoome autour, on ne le deplace pas */
  if (fp && t.zoomedOut) {
    mx.lineWidth = Math.max(1.5, dpr * 1.2);
    mx.strokeStyle = css("--accent");
    mx.strokeRect(t.px0 - mx.lineWidth / 2, t.py0 - mx.lineWidth / 2,
                  t.sideW + mx.lineWidth, t.sideH + mx.lineWidth);
  }
  drawHaloOnMip(t, dpr);
  $("h-mipz").textContent = "×" + (t.s / t.sDefault).toFixed(2);
}

/* ---- Contexte : la projection du champ entier -----------------------------
   Le carre de la dalle se place dans le champ par `origin_xyz` et `step_xyz`.
   Le zoom va de « le carre remplit la vue » (defaut) a « le champ entier
   remplit la vue » ; jamais au-dela, et la fenetre reste toujours dans le
   champ : il n'apparait donc jamais de bande noire. */
let field = null, mipView = null;
const fieldCache = new Map();
const bandCache = new Map();
/* Contexte de la projection. Deux sources, par ordre de preference :

   - la pile de tranches de profondeur du volume (`field_bands`) : la page n'en
     garde que les tranches qui couvrent la fenetre de la dalle affichee, si bien
     que le contexte a la meme profondeur que ce qu'il y a dans le carre. Sans
     cela, un vaisseau profond apparaissait dans le carre et nulle part autour ;
   - a defaut, la projection d'une bande fixe autour de la peau (`fields`). */
async function loadField(volumeName) {
  /* 1. Le contexte propre a la dalle, sur sa fenetre de profondeur exacte :
        aucune couture possible au bord du carre. */
  if (COH.context && slab && slab.ctx_pack) {
    if (!bandCache.has(slab.ctx_pack)) bandCache.set(slab.ctx_pack, await loadImage(dataUrl(slab.ctx_pack)));
    const img = bandCache.get(slab.ctx_pack);
    const key = "ctx|" + slab.slab_id;
    if (!fieldCache.has(key)) {
      const [hx, hy] = COH.context.image_xy;
      const c = document.createElement("canvas");
      c.width = hx; c.height = hy;
      c.getContext("2d").drawImage(img, 0, slab.ctx_slot * hy, hx, hy, 0, 0, hx, hy);
      fieldCache.set(key, { src: c, w: COH.context.shape_xy[0], h: COH.context.shape_xy[1], paint: null, key: "" });
    }
    field = fieldCache.get(key);
    while (fieldCache.size > 40) fieldCache.delete(fieldCache.keys().next().value);
    while (bandCache.size > 6) bandCache.delete(bandCache.keys().next().value);
    return;
  }
  const bands = COH.field_bands && COH.field_bands[volumeName];
  if (bands && slab) {
    if (!bandCache.has(volumeName)) bandCache.set(volumeName, await loadImage(dataUrl(bands.file)));
    const img = bandCache.get(volumeName);
    const z0 = slab.origin_xyz[2], z1 = z0 + BOX * slab.step_xyz[2];
    const k0 = Math.max(bands.first_band, Math.floor(z0 / bands.band_planes));
    const k1 = Math.min(bands.first_band + bands.count - 1, Math.floor((z1 - 1) / bands.band_planes));
    const key = `${volumeName}|${k0}|${k1}`;
    if (!fieldCache.has(key)) fieldCache.set(key, composeBands(img, bands, k0, k1));
    field = fieldCache.get(key);
    return;
  }
  const info = COH.fields && COH.fields[volumeName];
  if (!info) { field = null; return; }
  const key = volumeName;
  if (!fieldCache.has(key)) {
    const img = await loadImage(dataUrl(info.file));
    fieldCache.set(key, { src: img, w: info.shape_xy[0], h: info.shape_xy[1], paint: null, key: "" });
  }
  field = fieldCache.get(key);
}
/* Maximum des tranches k0..k1 pour le signal, OU pour la presence d'une autre forme. */
function composeBands(img, bands, k0, k1) {
  const [hx, hy] = bands.image_xy;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const all = g.getImageData(0, 0, c.width, c.height).data;
  const out = new ImageData(hx, hy), px = out.data;
  for (let k = k0; k <= k1; k++) {
    const base = (k - bands.first_band) * hy * hx * 4;
    for (let i = 0; i < hx * hy * 4; i += 4) {
      if (all[base + i] > px[i]) px[i] = all[base + i];
      if (all[base + i + 1] > px[i + 1]) px[i + 1] = all[base + i + 1];
    }
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const src = document.createElement("canvas");
  src.width = hx; src.height = hy;
  src.getContext("2d").putImageData(out, 0, 0);
  return { src, w: bands.shape_xy[0], h: bands.shape_xy[1], paint: null, key: "" };
}
function fieldPaint() {
  if (!field) return null;
  const key = [F.value, C.value, G.value, othersOn, css("--stagebg")].join("|");
  if (field.paint && field.key === key) return field.paint;
  const w = field.src.naturalWidth || field.src.width, h = field.src.naturalHeight || field.src.height;
  const c = field.paint || document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(field.src, 0, 0);
  const im = g.getImageData(0, 0, w, h), px = im.data;
  const bg = rgbOf(css("--stagebg")).map(v => v * 255);
  const ot = rgbOf(css("--other")).map(v => v * 255);
  const lo = +F.value, hi = +C.value, ig = 100 / +G.value;
  for (let i = 0; i < px.length; i += 4) {
    const tv = Math.min(1, Math.max(0, (px[i] - lo) / Math.max(hi - lo, 1)));
    const v = Math.pow(tv, ig) * 255;
    const other = othersOn && px[i + 1] > 115;
    for (let k = 0; k < 3; k++) {
      let out = bg[k] + (255 - bg[k]) * v / 255;
      if (other) out = out * 0.45 + ot[k] * 0.55;
      px[i + k] = out;
    }
    px[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  field.paint = c; field.key = key;
  return c;
}
function mipTransform(W, H) {
  const st = slab.step_xyz, o = slab.origin_xyz;
  const sideX = BOX * st[0], sideY = BOX * st[1];
  const sDefault = Math.min(W / sideX, H / sideY) * 0.94;
  /* Dezoom borne : la fenetre ne depasse jamais le champ, sur aucun axe. */
  const sMin = field ? Math.max(W / field.w, H / field.h) : sDefault;
  const zMin = Math.min(1, sMin / sDefault);
  mipZoom = Math.max(zMin, Math.min(8, mipZoom));
  const s = sDefault * mipZoom;
  const ww = W / s, wh = H / s;
  let wx0 = o[0] + sideX / 2 - ww / 2, wy0 = o[1] + sideY / 2 - wh / 2;
  if (field) {
    wx0 = Math.max(0, Math.min(field.w - ww, wx0));
    wy0 = Math.max(0, Math.min(field.h - wh, wy0));
  }
  const wy1 = wy0 + wh;
  return {
    s, sDefault, zMin, wx0, wy1, sideX, sideY,
    px0: (o[0] - wx0) * s, py0: (wy1 - (o[1] + sideY)) * s,
    sideW: sideX * s, sideH: sideY * s,
    zoomedOut: mipZoom < 0.999,
  };
}
/* Le cadre de la projection prend l'aspect du champ. Sa hauteur se calcule sur
   ce qui reste de la colonne une fois les reglages d'affichage poses dessous :
   la cellule prend alors exactement la hauteur du cadre, et les reglages le
   suivent au lieu d'etre repousses en bas de colonne. */
function fitMipFrame() {
  const col = document.querySelector(".midcol"), cell = $("mipcell"), view = $("vmip");
  if (!col || !cell || !view) return;
  const aspect = field ? field.w / field.h : 1;
  const narrow = matchMedia("(max-width:820px)").matches;
  const width = col.clientWidth;
  let height = width / aspect;
  if (!narrow) {
    let others = 0;
    for (const child of col.children) if (child !== cell) others += child.offsetHeight;
    const gaps = 8 * (col.children.length - 1);
    const available = col.clientHeight - others - gaps;
    if (available > 80) height = Math.min(height, available);
  }
  const w = Math.min(width, height * aspect);
  cell.style.flex = "none";
  cell.style.height = Math.floor(height) + "px";
  view.style.width = Math.floor(w) + "px";
  view.style.height = Math.floor(height) + "px";
  view.style.left = Math.floor((width - w) / 2) + "px";
  view.style.top = "0px";
}
/* ===========================================================================
   Edition du support
   ---------------------------------------------------------------------------
   Deux tableaux paralleles, et la distinction entre eux est le cœur du modele.

   `edit`    porte l'INTENTION du lecteur : rien, ajoute, retire, coupe. C'est
             la donnee. Elle est exportee voxel par voxel, parce qu'un contour
             corrige EST la mesure : n'en garder que le nombre reviendrait a
             jeter ce qu'on est venu chercher.
   `partLab` porte ce que la connexite a fait des coupes.
   Le canal alpha de la texture se RECALCULE a partir des deux. Il n'est jamais
   la source : une etiquette de partie ecrasait autrefois la trace d'un ajout,
   ce qui obligeait, en retirant un mode, a deviner l'origine de chaque voxel.
   ======================================================================== */
const lin = (x, y, z) => (z * BOX + y) * BOX + x;
const inBox = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < BOX && y < BOX && z < BOX;
const isCand = i => vol[i * 4 + 1] > 115;

function solidNow(i) {
  const e = edit[i];
  if (e === E_REM || e === E_CUT) return false;
  return isCand(i) || isAdded(e);
}
function syncAlpha() {
  const n = BOX * BOX * BOX;
  for (let i = 0; i < n; i++) {
    const e = edit[i];
    let a = ST_NEUTRAL;
    /* Un voxel ajoute que la coupe range dans une partie reste jaune en face —
       le lecteur voit ce qu'il a ajoute — et prend la couleur de sa partie en
       aretes (en 3D) et dans la projection. Mode trace : la couleur de la
       partie seule, chaque poil trace ayant la sienne. */
    const k = splitOn && partLab && partLab[i] >= 0 ? Math.min(partLab[i], PART_MAX - 1) : -1;
    if (e === E_CUT) a = ST_CUT;
    else if (e === E_REM) a = ST_REMOVED;
    else if (isTrace() && !overlay && isAdded(e)) a = ST_NEUTRAL;
    else if (isAdded(e) && k >= 0) a = isTrace() ? PART_BASE + k * PART_STEP : ADDED_PART_BASE + k * ADDED_PART_STEP;
    else if (isAdded(e)) a = ST_ADDED;
    else if (k >= 0) a = PART_BASE + k * PART_STEP;
    vol[i * 4 + 3] = a;
  }
}
function brushAt(seed, size) {
  const out = [];
  const offs = size === 1 ? [[0,0,0]]
    : [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [dx, dy, dz] of offs) {
    const a = seed.x + dx, b = seed.y + dy, c = seed.z + dz;
    if (inBox(a, b, c)) out.push(lin(a, b, c));
  }
  return out;
}
function setEdits(indices, want) {
  const changed = [];
  for (const i of indices) if (edit[i] !== want) { changed.push([i, edit[i]]); edit[i] = want; }
  if (!changed.length) return;
  undoStack.push(changed);
  if (undoStack.length > 90) undoStack.shift();
  commitEdit();
}
function commitEdit() {
  if (hasHalo() && halo) syncHaloFromWindow();
  if (splitOn) recomputeParts();
  syncAlpha();
  upload(); drawGL(); drawMIP(); paintCounts();
  if (splitOn) { buildParts(); saveParts(); buildOpts(); }
  if (draft) captureEdits(draft);
  pickerPersist();
  /* Le bouton de confirmation depend des modifications (pont manquant, parties
     sans nature) : il se repeint a chaque changement, pas seulement au choix
     d'une nature. */
  if (slab) paintProgress();
}
function undoEdit() {
  const last = undoStack.pop();
  if (!last) return;
  for (const [i, before] of last) edit[i] = before;
  if (last.trace) {
    traceLastH = last.trace.lastH; traceGreyH = last.trace.greyH;
    if (draft && last.trace.seeds) draft.attached_seeds = last.trace.seeds;
    paintTraceState();
  }
  commitEdit();
}
function clearEdits() {
  if (!edit) return;
  for (let i = 0; i < edit.length; i++) if (isAdded(edit[i]) || edit[i] === E_REM) edit[i] = E_NONE;
  endHair();
  undoStack = []; commitEdit();
}
function clearCuts() {
  if (!edit) return;
  for (let i = 0; i < edit.length; i++) if (edit[i] === E_CUT) edit[i] = E_NONE;
  undoStack = []; commitEdit();
}
function countEdit(w) {
  let n = 0;
  if (edit) for (let i = 0; i < edit.length; i++) if (edit[i] === w) n++;
  return n;
}
function paintCounts() {
  const bw = $("t-bridge");
  if (bw) { const need = needsBridge(); bw.hidden = !need; bw.textContent = need ? S().bridgeWarn : ""; }
  const el = $("add-count");
  if (el) el.textContent = "+" + (countEdit(E_ADD) + countEdit(E_FILL)) + " / \u2212" + countEdit(E_REM);
  const pc = $("part-count");
  if (pc) pc.textContent = String(Math.max(parts.length, 1));
}
/* Index lineaire dans la grille d'AFFICHAGE : i = (z * BOX + y) * BOX + x.
   Le voxel natif se retrouve par origin_xyz + (x, y, z) * step_xyz, tous deux
   consignes dans la cohorte pour cette dalle. */
function captureEdits(v) {
  if (isArbitrate()) return;                    /* les voxels montres sont ceux d'une reponse, pas une retouche */
  /* Seconde lecture : les voxels montres sont ceux de l'auteur ; ils ne
     deviennent une reponse que si le lecteur choisit de les retoucher. */
  if (isSecond() && v.outline !== "fixed") return;
  if (isSecondTrace()) return;                  /* les traces montrees sont celles de l'auteur */
  if (hasHalo() && halo) { captureHaloEdits(v); return; }
  const added = [], removed = [], cut = [], filled = [];
  for (let i = 0; i < edit.length; i++) {
    const e = edit[i];
    if (e === E_ADD) added.push(i);
    else if (e === E_REM) removed.push(i);
    else if (e === E_CUT) cut.push(i);
    else if (e === E_FILL) filled.push(i);
  }
  v.added_voxels = added.length;
  v.removed_voxels = removed.length;
  v.filled_voxels = filled.length;
  v.added_index = added;
  v.removed_index = removed;
  v.cut_index = cut;
  v.filled_index = filled;
}
/* Mode trace : la reponse s'ecrit en index de MARGE, i = (z*S + y)*S + x ;
   voxel natif = halo_origin_xyz + (x, y, z) * step_xyz. */
function captureHaloEdits(v) {
  syncHaloFromWindow();
  const added = [], removed = [], cut = [], filled = [], attached = [];
  for (let h = 0; h < halo.edit.length; h++) {
    const e = halo.edit[h];
    if (e === E_ADD) added.push(h); else if (e === E_REM) removed.push(h);
    else if (e === E_CUT) cut.push(h); else if (e === E_FILL) filled.push(h);
    else if (e === E_ATT) attached.push(h);
  }
  const base = byId.get(halo.tile);
  /* `attached_index` : voxels du registre rattaches a un poil trace. Ils
     serviront a croiser, au depouillement, avec les verdicts de l'annotateur
     sur les memes composantes. */
  Object.assign(v, { added_voxels: added.length, removed_voxels: removed.length, filled_voxels: filled.length,
    attached_voxels: attached.length, attached_index: attached,
    added_index: added, removed_index: removed, cut_index: cut, filled_index: filled,
    index_space: "halo", halo_origin_xyz: base.halo_origin_xyz, halo_size: base.halo_size,
    window_xy: base.window_xy, step_xyz: base.step_xyz });
}
/* Completion : les coupes et retraits de l'etape 1 sont des separations
   voulues. La region les montre vides ; combler ne doit ni les remplir ni
   passer par eux (9 oct. : <dalle> ressoude par le comblement). Index de
   region, d'apres `completion.step1_blocked` (index de la boite). */
function stepOneBlocked() {
  if (!isComplete() || !halo) return null;
  if (halo.blocked1 !== undefined) return halo.blocked1;
  const base = byId.get(halo.tile) || {}, idx = (base.completion || {}).step1_blocked || [];
  const S = halo.size, [kx, ky] = base.window_xy || [0, 0], set = new Set();
  for (const i of idx) {
    const x = i % BOX, y = ((i / BOX) | 0) % BOX, z = (i / (BOX * BOX)) | 0;
    set.add((z * S + y + ky) * S + x + kx);
  }
  return (halo.blocked1 = set.size ? set : null);
}
function restoreEdits(v) {
  if (hasHalo() && halo) {
    halo.edit.fill(E_NONE); halo.lab = null;
    for (const h of v.added_index || []) halo.edit[h] = E_ADD;
    for (const h of v.removed_index || []) halo.edit[h] = E_REM;
    for (const h of v.cut_index || []) halo.edit[h] = E_CUT;
    /* un voxel comble sur une coupe ou un retrait de l'etape 1 n'est jamais valide */
    const blk = stepOneBlocked();
    for (const h of v.filled_index || []) if (!blk || !blk.has(h)) halo.edit[h] = E_FILL;
    syncWindowFromHalo();
    return;
  }
  edit.fill(E_NONE);
  for (const i of v.added_index || []) edit[i] = E_ADD;
  for (const i of v.removed_index || []) edit[i] = E_REM;
  for (const i of v.cut_index || []) edit[i] = E_CUT;
  for (const i of v.filled_index || []) edit[i] = E_FILL;
}

/* ---- Pose de voxels contre une face, comme dans un jeu de blocs -----------
   Tout ce qui n'est pas le candidat (ni un ajout) est du vide. Le rayon
   traverse la grille, s'arrete au premier voxel solide, et le nouveau voxel se
   pose sur la case vide qui precede — donc sur la face regardee. C'est la seule
   construction ou la profondeur n'est ni visee ni devinee. */
function ray3DVoxel(ev) {
  const r = cv.getBoundingClientRect();
  const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
  const ny = 1 - ((ev.clientY - r.top) / r.height) * 2;
  const aspect = cv.width / cv.height, extent = 1.3 / zoom;
  const u = nx * aspect * extent + panX, v = ny * extent + panY;
  const m = rotMat();
  const ro = [m[0]*u + m[3]*v + m[6]*3, m[1]*u + m[4]*v + m[7]*3, m[2]*u + m[5]*v + m[8]*3];
  const rd = [-m[6], -m[7], -m[8]];
  const h = halfExtent();
  const o = [(ro[0] / (2*h[0]) + 0.5) * BOX, (ro[1] / (2*h[1]) + 0.5) * BOX,
             (0.5 - ro[2] / (2*h[2])) * BOX];
  const d = [rd[0] / (2*h[0]) * BOX, rd[1] / (2*h[1]) * BOX, -rd[2] / (2*h[2]) * BOX];
  return { o, d };
}
function pickPlacement(ev) {
  const { o, d } = ray3DVoxel(ev);
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < 0 || o[k] > BOX) return null; continue; }
    const ta = (0 - o[k]) / d[k], tb = (BOX - o[k]) / d[k];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t1 <= t0) return null;
  const len = Math.hypot(d[0], d[1], d[2]);
  const dt = 0.2 / len;
  let empty = null;
  for (let tt = t0 + dt * 0.5; tt <= t1; tt += dt) {
    const x = Math.floor(o[0] + d[0] * tt);
    const y = Math.floor(o[1] + d[1] * tt);
    const z = Math.floor(o[2] + d[2] * tt);
    if (!inBox(x, y, z)) continue;
    if (solidNow(lin(x, y, z))) return { place: empty, hit: [x, y, z] };
    if (!empty || empty[0] !== x || empty[1] !== y || empty[2] !== z) empty = [x, y, z];
  }
  return null;
}
/* Reposer un voxel du candidat le rend NEUTRE, pas « ajoute » : il etait propose
   au depart, et « ajoute » ne doit designer que ce qui ne l'etait pas. Sans
   cette regle, defaire une suppression gonflerait le compte d'ajouts. */
function placeAt(ev) {
  if (tool === "trace") {
    if (ev.button === 2 || ev.altKey) { endHair(); return; }
    const changes = [];
    traceClick(rayCandidates(ev), changes);
    if (changes.length) { undoStack.push(changes); if (undoStack.length > 90) undoStack.shift(); }
    commitEdit();
    return;
  }
  if (tool === "fill") {
    const changes = [];
    bucketFrom(pickOther(ev), changes);
    if (changes.length) { undoStack.push(changes); commitEdit(); }
    return;
  }
  const pick = pickPlacement(ev);
  if (!pick) return;
  if (tool === "del" || ev.altKey || ev.button === 2) {
    const i = lin(...pick.hit);
    setEdits([i], isAdded(edit[i]) ? E_NONE : E_REM);
    return;
  }
  if (!pick.place) return;
  const keys = brushAt({ x: pick.place[0], y: pick.place[1], z: pick.place[2] },
                       tool === "b1" ? 1 : 7);
  const changed = [];
  for (const i of keys) {
    const want = isCand(i) ? E_NONE : E_ADD;
    if (edit[i] !== want) { changed.push([i, edit[i]]); edit[i] = want; }
  }
  if (!changed.length) return;
  undoStack.push(changed);
  if (undoStack.length > 90) undoStack.shift();
  commitEdit();
}

/* ---- Separation d'une composante fusionnee ------------------------------
   Connexite 6, celle du registre CC6 : separer avec une autre connexite
   mesurerait autre chose que la methode. */
const cutting = () => tool === "c1" || tool === "c7";
function recomputeParts() {
  if (isTrace() && halo) { recomputeHaloParts(); return; }
  if (isComplete() && halo) { recomputeCompleteParts(); return; }
  const n = BOX * BOX * BOX;
  const oldLab = partLab && partLab.length === n ? partLab.slice() : null;
  if (!partLab || partLab.length !== n) partLab = new Int16Array(n);
  partLab.fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (partLab[i] >= 0 || !solidNow(i)) continue;
    const id = sizes.length;
    partLab[i] = id; stack.length = 0; stack.push(i);
    let count = 0;
    while (stack.length) {
      const j = stack.pop(); count++;
      const z = (j / (BOX * BOX)) | 0, y = ((j / BOX) | 0) % BOX, x = j % BOX;
      for (const [dx, dy, dz] of SIX) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (!inBox(a, b, c)) continue;
        const k = lin(a, b, c);
        if (partLab[k] < 0 && solidNow(k)) { partLab[k] = id; stack.push(k); }
      }
    }
    sizes.push(count);
  }
  const merged = sizes.slice(0, PART_MAX - 1);
  if (sizes.length >= PART_MAX) merged.push(sizes.slice(PART_MAX - 1).reduce((a, b) => a + b, 0));
  /* La nature d'une partie suit ses voxels : elle passe a la nouvelle partie qui
     herite le plus de voxels de l'ancienne, et a elle seule. Suivre le rang
     echangeait les natures des qu'une partie nouvelle s'intercalait ; tout
     heriter donnerait aux deux moities d'une coupe la meme nature, et le lecteur
     ne serait plus force de nommer la partie qu'il vient de separer. */
  const before = parts;
  const heir = merged.map(() => new Map());
  if (oldLab) for (let i = 0; i < n; i++) {
    const a = partLab[i], b = oldLab[i];
    if (a >= 0 && b >= 0) { const id = Math.min(a, merged.length - 1); heir[id].set(b, (heir[id].get(b) || 0) + 1); }
  }
  const winner = new Map();                     /* ancienne partie -> [nouvelle, voxels] */
  heir.forEach((m, i) => { for (const [b, c] of m) if (!winner.has(b) || c > winner.get(b)[1]) winner.set(b, [i, c]); });
  const given = new Map();
  for (const [b, [i]] of winner) if (before[b] && (before[b].nature || before[b].doubt)) given.set(i, before[b]);
  parts = merged.map((v, i) => {
    const from = oldLab ? given.get(i) : before[i];
    return { voxels: v, nature: (from && from.nature) || (isTrace() ? "hair" : null), doubt: !!(from && from.doubt) };
  });
  selectedPart = Math.min(selectedPart, Math.max(parts.length - 1, 0));
}
/* Completion (8 octobre) : la separation de l'etape 1, sur toute la region. Le
   solide est l'etiquette proposee (canal G de la region) plus les ajouts, moins
   les retraits et les coupes ; une partie garde sa nature d'une fenetre a l'autre. */
function recomputeCompleteParts() {
  syncHaloFromWindow();
  const size = halo.size, n = size * size * BOX;
  const solidH = h => { const e = halo.edit[h]; return e !== E_REM && e !== E_CUT && (halo.G[h] > 115 || isAdded(e)); };
  const old = halo.lab ? halo.lab.slice() : null;
  const lab = halo.lab || (halo.lab = new Int16Array(n));
  lab.fill(-1);
  const sizes = [], stack = [];
  for (let i = 0; i < n; i++) {
    if (lab[i] >= 0 || !solidH(i)) continue;
    const id = sizes.length;
    lab[i] = id; stack.push(i);
    let count = 0;
    while (stack.length) {
      const j = stack.pop(); count++;
      const x = j % size, y = ((j / size) | 0) % size, z = (j / (size * size)) | 0;
      for (const [dx, dy, dz] of SIX) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (a < 0 || b < 0 || c < 0 || a >= size || b >= size || c >= BOX) continue;
        const k = (c * size + b) * size + a;
        if (lab[k] < 0 && solidH(k)) { lab[k] = id; stack.push(k); }
      }
    }
    sizes.push(count);
  }
  const cap = PART_MAX - 1;
  const merged = sizes.slice(0, cap);
  if (sizes.length > cap) merged.push(sizes.slice(cap).reduce((a, b) => a + b, 0));
  const before = parts, heir = merged.map(() => new Map());
  if (old) for (let i = 0; i < n; i++) {
    const a = lab[i], b = old[i];
    if (a >= 0 && b >= 0) { const id = Math.min(a, cap); const k = Math.min(b, cap); heir[id].set(k, (heir[id].get(k) || 0) + 1); }
  }
  const winner = new Map();
  heir.forEach((m, i) => { for (const [b, c] of m) if (!winner.has(b) || c > winner.get(b)[1]) winner.set(b, [i, c]); });
  const given = new Map();
  for (const [b, [i]] of winner) if (before[b] && (before[b].nature || before[b].doubt)) given.set(i, before[b]);
  parts = merged.map((v, i) => {
    const from = old ? given.get(i) : before[i];
    return { voxels: v, nature: (from && from.nature) || null, doubt: !!(from && from.doubt) };
  });
  if (!partLab || partLab.length !== BOX * BOX * BOX) partLab = new Int16Array(BOX * BOX * BOX);
  for (let i = 0; i < partLab.length; i++) { const l = lab[winToHalo(i)]; partLab[i] = l < 0 ? -1 : Math.min(l, cap); }
  selectedPart = Math.min(selectedPart, Math.max(parts.length - 1, 0));
}
function cutAt(ev) {
  const pick = pickPlacement(ev);
  if (!pick) return;
  const keys = brushAt({ x: pick.hit[0], y: pick.hit[1], z: pick.hit[2] },
                       tool === "c1" ? 1 : 7)
    .filter(i => edit[i] !== E_REM && (isCand(i) || isAdded(edit[i]) || edit[i] === E_CUT));
  setEdits(keys, ev.altKey || ev.button === 2 ? E_NONE : E_CUT);
}
function mipCell(ev) {
  if (!mipView) return null;
  const r = mc.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (mc.width / r.width);
  const py = (ev.clientY - r.top) * (mc.height / r.height);
  const fx = (px - mipView.px0) / mipView.sideW, fy = (py - mipView.py0) / mipView.sideH;
  /* Hors du carre, on est dans le contexte : on ne coupe rien. */
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * BOX), y: BOX - 1 - Math.floor(fy * BOX) };
}
/* La meme conversion sans borne : hors du carre, des colonnes « virtuelles ». */
function mipCellRaw(ev) {
  if (!mipView) return null;
  const r = mc.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (mc.width / r.width);
  const py = (ev.clientY - r.top) * (mc.height / r.height);
  const fx = (px - mipView.px0) / mipView.sideW, fy = (py - mipView.py0) / mipView.sideH;
  return { x: Math.floor(fx * BOX), y: BOX - 1 - Math.floor(fy * BOX) };
}
/* ---- Outils de colonne, sur la projection ---------------------------------
   Une colonne de la projection est une ligne de visee complete a travers la
   dalle. La projection applique l'outil courant a la colonne entiere, au clic
   ou en glissant :

     Erase      retire tout ce qui est solide dans la colonne — le geste qui
                rogne en quelques traits les bords qui ne suivent pas le signal ;
     1 vx, 7 vx ajoute, dans la colonne, le voxel de plus fort signal qui touche
                la composante en connexite 6 ; recliquer ajoute le suivant ;
     Cut        coupe la colonne de part en part.

   Le clic droit defait l'action sur la colonne. Un trait glisse compte pour un
   seul pas d'annulation. C'est la correction « en 2D », qu'on fait d'abord,
   avant de reprendre la 3D. */
const LATERAL_CROSS = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
function touchesSolid(x, y, z) {
  for (const [dx, dy, dz] of SIX) {
    const a = x + dx, b = y + dy, c = z + dz;
    if (inBox(a, b, c) && solidNow(lin(a, b, c))) return true;
  }
  return false;
}
function setOne(i, want, changes) {
  if (edit[i] === want) return;
  changes.push([i, edit[i]]);
  edit[i] = want;
}
function columnAction(x, y, action, inverse, changes) {
  if (x < 0 || y < 0 || x >= BOX || y >= BOX) return;
  if (action === "cut") {
    for (let z = 0; z < BOX; z++) {
      const i = lin(x, y, z);
      if (edit[i] === E_REM) continue;
      if (isCand(i) || isAdded(edit[i]) || edit[i] === E_CUT) setOne(i, inverse ? E_NONE : E_CUT, changes);
    }
  } else if (action === "erase") {
    for (let z = 0; z < BOX; z++) {
      const i = lin(x, y, z);
      if (inverse) { if (edit[i] === E_REM) setOne(i, E_NONE, changes); }
      else if (solidNow(i)) setOne(i, isCand(i) ? E_REM : E_NONE, changes);
    }
  } else if (action === "bucket") {
    if (inverse) return;
    let best = -1, bi = -1;
    for (let z = 0; z < BOX; z++) {
      const i = lin(x, y, z);
      if (isOther(i) && !solidNow(i) && vol[i * 4] > best) { best = vol[i * 4]; bi = i; }
    }
    bucketFrom(bi, changes);
  } else if (action === "add") {
    if (inverse) {
      for (let z = 0; z < BOX; z++) { const i = lin(x, y, z); if (isAdded(edit[i])) setOne(i, E_NONE, changes); }
      return;
    }
    let best = -1, bz = -1;
    for (let z = 0; z < BOX; z++) {
      const i = lin(x, y, z);
      if (solidNow(i) || !touchesSolid(x, y, z)) continue;
      if (vol[i * 4] > best) { best = vol[i * 4]; bz = z; }
    }
    if (bz < 0) { addDiagonal(x, y, changes); return; }
    const i = lin(x, y, bz);
    /* Un voxel du candidat qu'on avait retire redevient candidat, pas « ajoute ». */
    setOne(i, isCand(i) ? E_NONE : E_ADD, changes);
  }
}
/* Pas en diagonale. Un poil oblique avance souvent d'une case en x ET en y : la
   colonne visee ne touche alors la forme que par une arete ou un coin, et
   l'ajout restait sans effet un clic sur deux. On prend le voxel le plus
   brillant de la colonne qui touche la forme en connexite 26, plus le ou les
   voxels de liaison les plus brillants, pour garder la forme d'un seul tenant
   en connexite 6 (celle du registre). */
function bridgeTo(x, y, z, dx, dy, dz) {
  const axes = [[dx, 0, 0], [0, dy, 0], [0, 0, dz]].filter(a => a[0] || a[1] || a[2]);
  const orders = axes.length === 2 ? [[0, 1], [1, 0]]
    : [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let best = null, bestSig = -1;
  for (const order of orders) {
    const path = [];
    let p = [x, y, z], ok = true, low = Infinity;
    for (const k of order.slice(0, -1)) {
      p = [p[0] + axes[k][0], p[1] + axes[k][1], p[2] + axes[k][2]];
      const i = lin(...p);
      if (!inBox(...p) || isOther(i) || edit[i] === E_REM || edit[i] === E_CUT) { ok = false; break; }
      path.push(i); low = Math.min(low, vol[i * 4]);
    }
    if (ok && low > bestSig) { bestSig = low; best = path; }
  }
  return best;
}
function addDiagonal(x, y, changes) {
  let best = -1, bi = -1, link = null;
  for (let z = 0; z < BOX; z++) {
    const i = lin(x, y, z);
    if (solidNow(i) || isOther(i) || edit[i] === E_CUT || vol[i * 4] <= best) continue;
    let br = null, brSig = -1;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx !== 0) + (dy !== 0) + (dz !== 0) < 2) continue;
      if (!inBox(x + dx, y + dy, z + dz) || !solidNow(lin(x + dx, y + dy, z + dz))) continue;
      const path = bridgeTo(x, y, z, dx, dy, dz);
      if (!path) continue;
      const s = Math.min(...path.map(k => vol[k * 4]));
      if (s > brSig) { brSig = s; br = path; }
    }
    if (br) { best = vol[i * 4]; bi = i; link = br; }
  }
  if (bi < 0) return;
  for (const k of link.concat(bi)) if (!solidNow(k)) setOne(k, isCand(k) ? E_NONE : E_ADD, changes);
}
/* ---- Trace : suivre un poil de clic en clic -------------------------------
   Le trace d'une tuile vit dans le repere de sa MARGE (96 x 96 x 48 : la tuile
   plus 1,27 mm de chaque cote) ; la vue 3D n'en montre qu'une FENETRE 48^3.
   Recentrer la fenetre — clic dans la projection hors du carre, dans le cadre
   pointille — ne touche pas au trace : un poil reste un seul objet d'une
   fenetre a l'autre, et la reponse s'ecrit en index de marge.

   Un clic designe une LIGNE de voxels : la colonne de la projection, ou le
   rayon de la vue 3D.
   - Si le plus brillant de la ligne est gris, le clic vise la forme grise : le
     trace va au plus court jusqu'a elle (ou en part), sans jamais l'ajouter.
     Le poil est alors marque comme rattache au registre.
   - Sinon, les candidats sont les voxels non gris de la ligne qui valent au
     moins la moitie du plus brillant. Quand un poil est en cours, l'ancre est
     celui que l'on ATTEINT au moindre cout depuis l'ancre precedente (Dijkstra
     multi-cible, cout 1 / (0,02 + signal), 6-voisinage) : un bruit brillant a
     une autre profondeur, separe par du fond sombre, ne vole plus l'ancre.
     Sans poil en cours, l'ancre est le plus brillant.
   Le chemin est ensuite elargi aux voisins au-dessus de la moitie du maximum
   local, a deux voxels au plus. Un voxel retire ou coupe est infranchissable ;
   traverser une autre forme grise coute vingt fois plus cher. */
let halo = null;             /* {tile, size, R, B, skin, edit, lab} : la tuile courante */
let traceLastH = -1;         /* ancre precedente, en index de marge */
let traceGreyH = null;       /* forme grise de depart ou d'arrivee, en index de marge */
const sigOf = i => { const r = vol[i * 4] / 255; return r * r; };   /* R encode la racine du signal */
const xyzOf = i => [i % BOX, ((i / BOX) | 0) % BOX, (i / (BOX * BOX)) | 0];
const traceable = i => !isOther(i) && edit[i] !== E_REM && edit[i] !== E_CUT;
const winXY = () => (slab && slab.window_xy) || [0, 0];
const answerId = () => slab && (slab.window_of || slab.slab_id);
const hlin = (x, y, z) => (z * halo.size + y) * halo.size + x;
function winToHalo(i) {
  if (!halo) return i;                  /* etape 1 : pas de marge, la boite sert de repere */
  const [x, y, z] = xyzOf(i), [wx, wy] = winXY(); return hlin(x + wx, y + wy, z);
}
function haloToWin(h) {
  if (h < 0) return -1;
  if (!halo) return h;
  const size = halo.size, [wx, wy] = winXY();
  const x = h % size - wx, y = ((h / size) | 0) % size - wy, z = (h / (size * size)) | 0;
  return inBox(x, y, z) ? lin(x, y, z) : -1;
}
/* Une region en planches : 8 colonnes de tranches size x size, la peau en case 48. */
function decodeRegion(sheet, slot, size) {
  const W = sheet.width, px = sheet.data, n = size * size * BOX;
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n), skin = new Uint8Array(size * size * 4);
  const top = slot * ROWS * size;
  for (let z = 0; z < BOX; z++) {
    const r = (z / COLS) | 0, c = z % COLS;
    for (let y = 0; y < size; y++) {
      let s = ((top + r * size + y) * W + c * size) * 4;
      const d = (z * size + y) * size;
      for (let x = 0; x < size; x++, s += 4) { R[d + x] = px[s]; G[d + x] = px[s + 1]; B[d + x] = px[s + 2]; }
    }
  }
  const sr = (SKIN_SLOT / COLS) | 0, sc = SKIN_SLOT % COLS;
  for (let y = 0; y < size; y++) {
    let s = ((top + sr * size + y) * W + sc * size) * 4;
    for (let x = 0; x < size; x++, s += 4) {
      const d = (y * size + x) * 4;
      skin[d] = px[s]; skin[d + 1] = px[s + 1]; skin[d + 2] = px[s + 2] === 255 ? 255 : 0; skin[d + 3] = 255;
    }
  }
  return { R, G, B, skin };
}
function windowData(wx, wy) {
  const size = halo.size, out = new Uint8Array(BOX * BOX * BOX * 4), skin = new Uint8Array(BOX * BOX * 4);
  for (let z = 0; z < BOX; z++) for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    const h = (z * size + y + wy) * size + x + wx, d = lin(x, y, z) * 4;
    out[d] = halo.R[h]; out[d + 1] = halo.G[h]; out[d + 2] = halo.B[h]; out[d + 3] = ST_NEUTRAL;
  }
  for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    const s = ((y + wy) * size + x + wx) * 4, d = (y * BOX + x) * 4;
    for (let k = 0; k < 4; k++) skin[d + k] = halo.skin[s + k];
  }
  return { vol: out, skin };
}
function syncHaloFromWindow() {
  if (!halo || !edit) return;
  for (let i = 0; i < edit.length; i++) halo.edit[winToHalo(i)] = edit[i];
}
function syncWindowFromHalo() {
  if (!halo || !edit) return;
  for (let i = 0; i < edit.length; i++) edit[i] = halo.edit[winToHalo(i)];
}
/* Parties d'une tuile : les amas 6-connexes du trace dans la MARGE entiere. Un
   poil a cheval sur deux fenetres reste une seule partie, avec une seule nature. */
function recomputeHaloParts() {
  const size = halo.size, n = size * size * BOX;
  /* Rattachement : une forme deja detectee que le lecteur a visee (clic sur
     elle) ET que son trace touche rejoint le poil — elle en prend la couleur et
     la nature. Visee sans contact (chemin efface), elle redevient brune. */
  const nb6 = (j, f) => { const x = j % size, y = ((j / size) | 0) % size, z = (j / (size * size)) | 0;
    for (const [dx, dy, dz] of SIX) { const a = x + dx, b = y + dy, c = z + dz;
      if (a >= 0 && b >= 0 && c >= 0 && a < size && b < size && c < BOX) f((c * size + b) * size + a); } };
  for (let h = 0; h < n; h++) if (halo.edit[h] === E_ATT) halo.edit[h] = E_NONE;
  for (const s0 of (draft && draft.attached_seeds) || []) {
    if (!(halo.B[s0] > 115) || halo.edit[s0] !== E_NONE) continue;
    const comp = [s0], seen = new Set(comp);
    let touching = false;
    for (let q = 0; q < comp.length; q++) nb6(comp[q], k => {
      const e = halo.edit[k];
      if (e === E_ADD || e === E_FILL) touching = true;
      else if (!seen.has(k) && halo.B[k] > 115 && e === E_NONE) { seen.add(k); comp.push(k); }
    });
    if (touching) for (const h of comp) halo.edit[h] = E_ATT;
  }
  const old = halo.lab ? halo.lab.slice() : null;
  const lab = halo.lab || (halo.lab = new Int16Array(n));
  lab.fill(-1);
  const sizes = [], touch = [], stack = [];
  for (let i = 0; i < n; i++) {
    if (lab[i] >= 0 || !isAdded(halo.edit[i])) continue;
    const id = sizes.length;
    lab[i] = id; stack.push(i);
    let count = 0, t = false;
    while (stack.length) {
      const j = stack.pop(); count++;
      if (halo.edit[j] === E_ATT) t = true;
      const x = j % size, y = ((j / size) | 0) % size, z = (j / (size * size)) | 0;
      for (const [dx, dy, dz] of SIX) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (a < 0 || b < 0 || c < 0 || a >= size || b >= size || c >= BOX) continue;
        const k = (c * size + b) * size + a;
        if (halo.B[k] > 115) t = true;
        if (lab[k] < 0 && isAdded(halo.edit[k])) { lab[k] = id; stack.push(k); }
      }
    }
    sizes.push(count); touch.push(t);
  }
  const cap = PART_MAX - 1;
  const merged = sizes.slice(0, cap), mtouch = touch.slice(0, cap);
  if (sizes.length > cap) {
    merged.push(sizes.slice(cap).reduce((a, b) => a + b, 0));
    mtouch.push(touch.slice(cap).some(Boolean));
  }
  const before = parts, heir = merged.map(() => new Map());
  if (old) for (let i = 0; i < n; i++) {
    const a = lab[i], b = old[i];
    if (a >= 0 && b >= 0) { const id = Math.min(a, cap); const k = Math.min(b, cap); heir[id].set(k, (heir[id].get(k) || 0) + 1); }
  }
  const winner = new Map();
  heir.forEach((m, i) => { for (const [b, c] of m) if (!winner.has(b) || c > winner.get(b)[1]) winner.set(b, [i, c]); });
  const given = new Map();
  for (const [b, [i]] of winner) if (before[b] && (before[b].nature || before[b].doubt)) given.set(i, before[b]);
  parts = merged.map((v, i) => {
    const from = old ? given.get(i) : before[i];
    return { voxels: v, touches_registry: mtouch[i], nature: "hair", doubt: !!(from && from.doubt) };
  });
  if (!partLab || partLab.length !== BOX * BOX * BOX) partLab = new Int16Array(BOX * BOX * BOX);
  for (let i = 0; i < partLab.length; i++) { const l = lab[winToHalo(i)]; partLab[i] = l < 0 ? -1 : Math.min(l, cap); }
  selectedPart = Math.min(selectedPart, Math.max(parts.length - 1, 0));
  syncWindowFromHalo();                        /* la fenetre voit les rattachements */
}
/* Lignes de voxels designees par un clic. */
function columnCandidates(x, y) {
  const out = [];
  if (x < 0 || y < 0 || x >= BOX || y >= BOX) return out;
  for (let z = 0; z < BOX; z++) out.push(lin(x, y, z));
  return out;
}
function rayCandidates(ev) {
  const { o, d } = ray3DVoxel(ev), out = [];
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < 0 || o[k] > BOX) return out; continue; }
    const ta = (0 - o[k]) / d[k], tb = (BOX - o[k]) / d[k];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  const dt = 0.2 / Math.hypot(d[0], d[1], d[2]);
  let last = -1;
  for (let tt = t0 + dt * 0.5; tt <= t1; tt += dt) {
    const x = Math.floor(o[0] + d[0] * tt), y = Math.floor(o[1] + d[1] * tt), z = Math.floor(o[2] + d[2] * tt);
    if (!inBox(x, y, z)) continue;
    const i = lin(x, y, z);
    if (i !== last) { out.push(i); last = i; }
  }
  return out;
}
function readClick(line) {
  let bt = -1, rt = -1, bg = -1, rg = -1;
  for (const i of line) {
    const r = vol[i * 4];
    if (isOther(i)) { if (r > rg) { rg = r; bg = i; } }
    else if (traceable(i) && r > rt) { rt = r; bt = i; }
  }
  if (bg >= 0 && rg >= rt) return { grey: bg };
  if (bt < 0) return null;
  const floor = 0.5 * sigOf(bt);
  return { targets: line.filter(i => traceable(i) && sigOf(i) >= floor), best: bt };
}
function greyComponent(seed) {
  const out = [seed], seen = new Set(out);
  for (let h = 0; h < out.length; h++) {
    const [x, y, z] = xyzOf(out[h]);
    for (const [dx, dy, dz] of SIX) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (!inBox(a, b, c)) continue;
      const k = lin(a, b, c);
      if (!seen.has(k) && isOther(k)) { seen.add(k); out.push(k); }
    }
  }
  return out;
}
function traceSources() {
  const src = [];
  if (traceGreyH) for (const h of traceGreyH) { const w = haloToWin(h); if (w >= 0) src.push(w); }
  const l = haloToWin(traceLastH);
  if (l >= 0) src.push(l);
  return src;
}
/* Plus court chemin (cout du signal) d'une source quelconque a la premiere cible atteinte. */
function tracePathSet(sources, targets) {
  const tset = new Set(targets), sset = new Set(sources), all = sources.concat(targets), M = 6;
  let x0 = BOX, y0 = BOX, z0 = BOX, x1 = 0, y1 = 0, z1 = 0;
  for (const i of all) { const [x, y, z] = xyzOf(i);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
  x0 = Math.max(0, x0 - M); y0 = Math.max(0, y0 - M); z0 = Math.max(0, z0 - M);
  x1 = Math.min(BOX - 1, x1 + M); y1 = Math.min(BOX - 1, y1 + M); z1 = Math.min(BOX - 1, z1 + M);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, n = W * H * (z1 - z0 + 1);
  const loc = (x, y, z) => ((z - z0) * H + (y - y0)) * W + (x - x0);
  const glob = v => lin(x0 + v % W, y0 + ((v / W) | 0) % H, z0 + ((v / (W * H)) | 0));
  /* Float64 : en Float32, une distance arrondie vers le bas faisait sauter son noeud
     au depilement (du > dist[u]) et la recherche s'eteignait sans chemin (8 octobre). */
  const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const hp = [], hn = [];
  const push = (p, v) => {
    let k = hp.length; hp.push(p); hn.push(v);
    while (k > 0) { const up = (k - 1) >> 1; if (hp[up] <= hp[k]) break;
      [hp[up], hp[k]] = [hp[k], hp[up]]; [hn[up], hn[k]] = [hn[k], hn[up]]; k = up; }
  };
  const pop = () => {
    const p = hp[0], v = hn[0], lp = hp.pop(), lv = hn.pop();
    if (hp.length) { hp[0] = lp; hn[0] = lv; let k = 0;
      for (;;) { const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < hp.length && hp[l] < hp[m]) m = l;
        if (r < hp.length && hp[r] < hp[m]) m = r;
        if (m === k) break;
        [hp[m], hp[k]] = [hp[k], hp[m]]; [hn[m], hn[k]] = [hn[k], hn[m]]; k = m; } }
    return [p, v];
  };
  for (const s of sources) { const [x, y, z] = xyzOf(s); const v = loc(x, y, z); dist[v] = 0; push(0, v); }
  while (hp.length) {
    const [du, u] = pop();
    if (du > dist[u]) continue;
    const g = glob(u);
    if (tset.has(g)) {
      const path = [];
      for (let v = u; v >= 0; v = prev[v]) path.push(glob(v));
      return path.reverse();
    }
    const ux = x0 + u % W, uy = y0 + ((u / W) | 0) % H, uz = z0 + ((u / (W * H)) | 0);
    for (const [dx, dy, dz] of SIX) {
      const x = ux + dx, y = uy + dy, z = uz + dz;
      if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) continue;
      const k = lin(x, y, z);
      if (edit[k] === E_REM || edit[k] === E_CUT) continue;
      const grey = isOther(k) && !tset.has(k) && !sset.has(k);
      const v = loc(x, y, z), nd = du + (grey ? 20 : 1) / (0.02 + sigOf(k));
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  return null;
}
function traceExpand(path) {
  const out = new Set(path);
  const local = path.map((_, k) => {
    let m = 0;
    for (let j = Math.max(0, k - 3); j <= Math.min(path.length - 1, k + 3); j++) m = Math.max(m, sigOf(path[j]));
    return m;
  });
  const stack = path.map((p, k) => [p, p, local[k]]);
  while (stack.length) {
    const [v, origin, m] = stack.pop();
    const [vx, vy, vz] = xyzOf(v), [ox, oy, oz] = xyzOf(origin);
    for (const [dx, dy, dz] of SIX) {
      const x = vx + dx, y = vy + dy, z = vz + dz;
      if (!inBox(x, y, z)) continue;
      if (Math.max(Math.abs(x - ox), Math.abs(y - oy), Math.abs(z - oz)) > 2) continue;
      const k = lin(x, y, z);
      if (out.has(k) || !traceable(k) || sigOf(k) < 0.5 * m) continue;
      out.add(k); stack.push([k, origin, m]);
    }
  }
  return out;
}
function addTrace(path, changes) {
  if (!path.length) return;
  for (const i of traceExpand(path)) if (traceable(i) && !isAdded(edit[i])) setOne(i, isCand(i) ? E_NONE : E_ADD, changes);
}
function traceClick(line, changes) {
  const hit = readClick(line);
  if (!hit) return;
  const prev = { lastH: traceLastH, greyH: traceGreyH, seeds: isTrace() ? ((draft && draft.attached_seeds) || []).slice() : null };
  const src = traceSources();
  if (hit.grey !== undefined) {
    const comp = greyComponent(hit.grey);
    /* Etape 1 et completion : le trace va jusqu'a la forme grise sans la
       rattacher (le rattachement de la marge n'existe qu'en recherche ; pour
       rattacher, le seau). */
    if (isTrace()) {
      const seed = winToHalo(hit.grey);
      draft.attached_seeds = draft.attached_seeds || [];
      if (!draft.attached_seeds.includes(seed)) draft.attached_seeds.push(seed);
    }
    const path = src.length ? tracePathSet(src, comp) : null;
    if (path) addTrace(path.filter(i => !isOther(i)), changes);
    traceLastH = winToHalo(path ? path[path.length - 1] : hit.grey);
    traceGreyH = comp.map(winToHalo);
  } else {
    const path = (src.length && tracePathSet(src, hit.targets)) || [hit.best];
    addTrace(path.filter(i => !isOther(i)), changes);
    traceLastH = winToHalo(path[path.length - 1]);
    traceGreyH = null;
  }
  changes.trace = prev;
  /* Etape 1 : la reponse garde la trace de l'usage du traceur (publie le 7 octobre),
     pour comparer a la fin les dalles lues avec et sans lui. */
  if ((isStep1() || isComplete()) && draft && changes.length) draft.trace_clicks = (draft.trace_clicks || 0) + 1;
  paintTraceState();
}
function endHair() { traceLastH = -1; traceGreyH = null; paintTraceState(); }
function paintTraceState(flash) {
  const el = $("t-trace");
  if (!el) return;
  el.hidden = !(isTrace() || isStep1() || isComplete()) || tool !== "trace";
  el.textContent = flash || (traceLastH >= 0 ? S().trContinue : S().trStart);
  if (flash) setTimeout(() => paintTraceState(), 3200);
}
/* Supprimer un poil trace : tous ses voxels, dans la marge entiere. */
function deletePart(index) {
  if (!halo || !halo.lab) return;
  syncHaloFromWindow();
  let n = 0;
  for (let h = 0; h < halo.lab.length; h++)
    if (halo.lab[h] >= 0 && Math.min(halo.lab[h], PART_MAX - 1) === index && isAdded(halo.edit[h])) { halo.edit[h] = E_NONE; n++; }
  if (!n) return;
  syncWindowFromHalo();
  undoStack = []; endHair();
  commitEdit();
}
/* ---- Fenetres : recentrer la vue dans la marge ---------------------------- */
function windowSlab(tileId, wx, wy) {
  const base = byId.get(tileId);
  if (wx === base.window_xy[0] && wy === base.window_xy[1]) return base;
  const id = `${tileId}@${wx},${wy}`;
  if (!byId.has(id)) {
    const [hx, hy] = base.halo_origin_xyz;
    byId.set(id, { ...base, slab_id: id, window_of: tileId, window_xy: [wx, wy],
                   origin_xyz: [hx + wx * base.step_xyz[0], hy + wy * base.step_xyz[1], base.origin_xyz[2]] });
  }
  return byId.get(id);
}
async function openWindow(wx, wy, record = true) {
  const tileId = answerId();
  syncHaloFromWindow();
  const w = windowSlab(tileId, wx, wy);
  if (w.window_of && record) {
    draft.windows = draft.windows || [];
    if (!draft.windows.some(([a, b]) => a === wx && b === wy)) draft.windows.push([wx, wy]);
  }
  await openSlab(w.slab_id, practice);
}
/* Clic dans la projection hors du carre : une fenetre centree sur le clic, et
   le trace en cours s'y poursuit. */
async function traceOutside(raw, moveOnly) {
  const size = halo.size, [wx, wy] = winXY();
  const hx = wx + raw.x, hy = wy + raw.y;
  if (hx < 0 || hy < 0 || hx >= size || hy >= size) { paintTraceState(S().trOutside); return; }
  const nx = Math.max(0, Math.min(size - BOX, hx - BOX / 2)), ny = Math.max(0, Math.min(size - BOX, hy - BOX / 2));
  await openWindow(nx, ny);
  if (moveOnly) return;
  const changes = [];
  traceClick(columnCandidates(hx - nx, hy - ny), changes);
  if (changes.length) undoStack.push(changes);
  commitEdit();
}
/* Glisser la vue, bouton de la molette enfonce : dans la projection (plan
   exact) ou en 3D (vers la droite de l'ecran, et vers le fond). Le contenu suit
   la souris, comme une carte ; seule la position finale est retenue. */
let winDrag = null;
function startWinDrag(e, surface) {
  if (!hasHalo() || !halo || e.button !== 1) return false;
  e.preventDefault();
  winDrag = { x: e.clientX, y: e.clientY, start: winXY().slice(), surface, busy: false, target: null };
  try { surface.setPointerCapture(e.pointerId); } catch {}
  return true;
}
async function applyWinDrag(e) {
  if (!winDrag || !halo) return;
  const dxp = e.clientX - winDrag.x, dyp = e.clientY - winDrag.y;
  let dvx, dvy;
  if (winDrag.surface === mc) {
    const r = mc.getBoundingClientRect(), perVox = (mipView.sideW / BOX) * (r.width / mc.width);
    dvx = -dxp / perVox; dvy = dyp / perVox;
  } else {
    const r = cv.getBoundingClientRect(), perVox = r.height * zoom / (1.3 * BOX);
    const sx = dxp / perVox, sy = dyp / perVox, c = Math.cos(yaw), s = Math.sin(yaw);
    dvx = -sx * c - sy * s; dvy = -sx * s + sy * c;
  }
  const size = halo.size;
  winDrag.target = [Math.max(0, Math.min(size - BOX, Math.round(winDrag.start[0] + dvx))),
                    Math.max(0, Math.min(size - BOX, Math.round(winDrag.start[1] + dvy)))];
  if (winDrag.busy) return;
  winDrag.busy = true;
  for (let t = winDrag.target; t && (t[0] !== winXY()[0] || t[1] !== winXY()[1]); t = winDrag && winDrag.target)
    await openWindow(t[0], t[1], false);
  if (winDrag) winDrag.busy = false;
}
function endWinDrag() {
  if (!winDrag) return false;
  winDrag = null;
  if (slab && slab.window_of && draft) {
    const [wx, wy] = winXY();
    draft.windows = draft.windows || [];
    if (!draft.windows.some(([a, b]) => a === wx && b === wy)) draft.windows.push([wx, wy]);
    paintWindows();
  }
  return true;
}
/* Deplacer la vue d'un quart de bloc, sans tracer. */
async function moveWindow(dx, dy) {
  if (!halo) return;
  const size = halo.size, [wx, wy] = winXY(), step = BOX / 4;
  const nx = Math.max(0, Math.min(size - BOX, wx + dx * step)), ny = Math.max(0, Math.min(size - BOX, wy + dy * step));
  if (nx !== wx || ny !== wy) await openWindow(nx, ny);
}
function paintWindows() {
  const box = $("t-windows");
  if (!box) return;
  box.hidden = !hasHalo() || !halo || !draft;
  box.replaceChildren();
  if (box.hidden) return;
  const base = byId.get(answerId()), [bx, by] = base.window_xy, sp = base.native_spacing_mm, cur = winXY();
  const list = (draft.windows || []).slice(-4);
  for (const [wx, wy] of [[bx, by], ...list]) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip";
    const dx = (wx - bx) * sp[0] * base.step_xyz[0], dy = (wy - by) * sp[1] * base.step_xyz[1];
    b.textContent = wx === bx && wy === by ? S().trBase
      : `${dx >= 0 ? "→" : "←"}${Math.abs(dx).toFixed(1)} ${dy >= 0 ? "↑" : "↓"}${Math.abs(dy).toFixed(1)} mm`;
    b.setAttribute("aria-pressed", String(wx === cur[0] && wy === cur[1]));
    b.onclick = () => openWindow(wx, wy);
    box.appendChild(b);
  }
}
/* Dans la projection, le trace de la tuile hors de la fenetre, et le cadre de la marge. */
function drawHaloOnMip(t, dpr) {
  if (!hasHalo() || !halo || !slab || !slab.halo_origin_xyz) return;
  const base = byId.get(halo.tile), [hx, hy] = base.halo_origin_xyz, st = slab.step_xyz, size = halo.size;
  const [wx, wy] = winXY(), cell = st[0] * t.s;
  if (overlay) {
    mx.fillStyle = "rgba(127,212,245,.55)";
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (x >= wx && x < wx + BOX && y >= wy && y < wy + BOX) continue;
      let on = false;
      for (let z = 0; z < BOX && !on; z++) {
        const h = (z * size + y) * size + x, e = halo.edit[h];
        /* Completion : l'etiquette proposee compte aussi, sauf la ou le lecteur l'a retiree. */
        if (isAdded(e) || (isComplete() && halo.G[h] > 115 && e !== E_REM && e !== E_CUT)) on = true;
      }
      if (on) mx.fillRect((hx + x * st[0] - t.wx0) * t.s, (t.wy1 - (hy + (y + 1) * st[1])) * t.s, cell, st[1] * t.s);
    }
  }
  mx.save();
  mx.setLineDash([6 * dpr, 4 * dpr]);
  mx.lineWidth = Math.max(1, dpr);
  mx.strokeStyle = css("--muted");
  mx.strokeRect((hx - t.wx0) * t.s, (t.wy1 - (hy + size * st[1])) * t.s, size * st[0] * t.s, size * st[1] * t.s);
  /* Seconde lecture : les points du lecteur, numerotes. */
  if (isSecondTrace() && draft && (draft.points || []).length) {
    mx.setLineDash([]); mx.lineWidth = Math.max(2, 2 * dpr);
    mx.strokeStyle = "#ffffff"; mx.fillStyle = "#ffffff";
    mx.font = `600 ${Math.round(11 * dpr)}px IBM Plex Mono, monospace`;
    draft.points.forEach((q, i) => {
      const cx = (hx + (q.x + 0.5) * st[0] - t.wx0) * t.s, cy = (t.wy1 - (hy + (q.y + 0.5) * st[1])) * t.s;
      const r = Math.max(6 * dpr, 1.8 * cell);
      mx.beginPath(); mx.arc(cx, cy, r, 0, 2 * Math.PI); mx.stroke();
      mx.fillText(String(i + 1), cx + r + 2 * dpr, cy - r);
    });
  }
  /* Revue des tuiles : les points des volontaires sans trace correspondant. */
  if (isTileReview() && slab) {
    const pts = ((byId.get(answerId()) || {}).review || {}).points || [];
    mx.setLineDash([]); mx.lineWidth = Math.max(2, 2 * dpr);
    mx.strokeStyle = "#ffb020"; mx.fillStyle = "#ffb020";
    mx.font = `600 ${Math.round(11 * dpr)}px IBM Plex Mono, monospace`;
    pts.forEach((q, i) => {
      const cx = (hx + (q.x + 0.5) * st[0] - t.wx0) * t.s, cy = (t.wy1 - (hy + (q.y + 0.5) * st[1])) * t.s;
      const r = Math.max(6 * dpr, 1.8 * cell);
      mx.beginPath(); mx.arc(cx, cy, r, 0, 2 * Math.PI); mx.stroke();
      mx.fillText(String(i + 1), cx + r + 2 * dpr, cy - r);
    });
  }
  /* Le bloc a fouiller reste marque en rouge, ou que soit la vue : on ne
     cherche que la ; la marge sert a finir un poil qui en sort. */
  const [ox, oy] = base.origin_xyz;
  mx.setLineDash([]);
  mx.lineWidth = Math.max(2, 2 * dpr);
  mx.strokeStyle = css("--target");
  mx.strokeRect((ox - t.wx0) * t.s, (t.wy1 - (oy + BOX * st[1])) * t.s, BOX * st[0] * t.s, BOX * st[1] * t.s);
  mx.restore();
}

/* ---- Seau : ajouter une autre forme detectee, en entier -------------------
   Cas typique : un petit vaisseau detecte a part, que le lecteur rattache a son
   grand vaisseau voisin. Le clic designe une autre forme (canal « autres »),
   et toute la partie de cette forme contenue dans la dalle est ajoutee, par
   remplissage en connexite 6. Si elle ne touche pas la forme jugee, il faut un
   pont : la confirmation reste bloquee tant que l'ensemble n'est pas d'un
   seul tenant (hors mode fusion, ou les parties separees sont voulues). */
const isOther = i => vol[i * 4 + 2] > 115;
/* Le voxel vise par le seau est garde (`bucket_seeds`) : il designe la forme du
   registre que le lecteur a rattachee. L'etiquette reprend ensuite cette forme
   ENTIERE, y compris hors de la dalle, et la dalle entre dans la liste des
   rattachements a completer (tools/annotation_web/completion_lists.py). Un
   germe dont le voxel n'est plus ajoute (annule, efface) ne compte pas. */
function bucketFrom(i0, changes) {
  if (i0 < 0 || !isOther(i0) || solidNow(i0)) return;
  if (draft && !isTrace()) {
    draft.bucket_seeds = draft.bucket_seeds || [];
    if (!draft.bucket_seeds.includes(i0)) draft.bucket_seeds.push(i0);
  }
  const stack = [i0], seen = new Uint8Array(BOX * BOX * BOX);
  seen[i0] = 1;
  while (stack.length) {
    const j = stack.pop();
    setOne(j, isCand(j) ? E_NONE : E_ADD, changes);
    const z = (j / (BOX * BOX)) | 0, y = ((j / BOX) | 0) % BOX, x = j % BOX;
    for (const [dx, dy, dz] of SIX) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (!inBox(a, b, c)) continue;
      const k = lin(a, b, c);
      if (!seen[k] && isOther(k) && !solidNow(k) && edit[k] !== E_REM && edit[k] !== E_CUT) {
        seen[k] = 1; stack.push(k);
      }
    }
  }
}
/* Premier voxel d'une autre forme le long du rayon : le seau vise ce qu'il voit. */
function pickOther(ev) {
  const { o, d } = ray3DVoxel(ev);
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-9) { if (o[k] < 0 || o[k] > BOX) return -1; continue; }
    const ta = (0 - o[k]) / d[k], tb = (BOX - o[k]) / d[k];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  if (t1 <= t0) return -1;
  const dt = 0.2 / Math.hypot(d[0], d[1], d[2]);
  for (let tt = t0 + dt * 0.5; tt <= t1; tt += dt) {
    const x = Math.floor(o[0] + d[0] * tt), y = Math.floor(o[1] + d[1] * tt), z = Math.floor(o[2] + d[2] * tt);
    if (!inBox(x, y, z)) continue;
    const i = lin(x, y, z);
    if (isOther(i) && !solidNow(i)) return i;
  }
  return -1;
}
/* Nombre de morceaux d'un seul tenant de la forme, en connexite 6. */
function solidPieces() {
  const n = BOX * BOX * BOX, seen = new Uint8Array(n);
  let pieces = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i] || !solidNow(i)) continue;
    pieces++;
    const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      const z = (j / (BOX * BOX)) | 0, y = ((j / BOX) | 0) % BOX, x = j % BOX;
      for (const [dx, dy, dz] of SIX) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (!inBox(a, b, c)) continue;
        const k = lin(a, b, c);
        if (!seen[k] && solidNow(k)) { seen[k] = 1; stack.push(k); }
      }
    }
  }
  return pieces;
}
/* Une forme ajoutee au seau doit etre reliee, quel que soit le mode : meme en
   fusion, ou des parties separees sont voulues, une forme qui flotte seule
   n'a pas ete separee par le lecteur. Hors fusion, tout morceau detache bloque. */
function needsBridge() {
  /* En mode trace, tout trace « flotte » par construction : pas de pont. */
  if (!edit || hasHalo() || isArbitrate() || isSecond()) return false;
  if (floatingAddition()) return true;
  const sup = (draft && draft.support) || [];
  return sup.includes("incorrect") && !sup.includes("merged") && solidPieces() > 1;
}
/* ---- Combler : refermer les trous d'un voxel et remplir les cavites --------
   « Un voxel, un vide, un voxel » le long de X, de Y ou de Z devient continu.
   Puis les cavites que le vide exterieur n'atteint pas sont remplies. Rien
   n'est ajoute la ou le lecteur a retire ou coupe : l'outil complete, il ne
   contredit pas. */
/* Comblement interdit dalle par dalle, a la demande de l'auteur. <dalle> :
   trois poils fusionnes passent a un voxel l'un de l'autre, et combler les
   pontait (30 septembre). Le recalcul final du comblement les exclut aussi. */
const NO_FILL = new Set(["<dalle>"]);
function fillGaps() {
  if (!edit || NO_FILL.has(answerId())) return 0;
  const n = BOX * BOX * BOX;
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = solidNow(i) ? 1 : 0;
  /* Trou d'un voxel : un vide encadre par deux voxels pleins le long de X, de Y
     ou de Z (pas en diagonale) — la regle qui convient a une forme fine comme un
     poil. L'ancienne fermeture morphologique (voisinage en croix) ne comblait un
     vide que si ses six voisins touchaient la forme : sur un poil d'un ou deux
     voxels de large, elle ne comblait presque rien (constat de l'auteur, 27 sept.). */
  const closed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (solid[i]) { closed[i] = 1; continue; }
    const z = (i / (BOX * BOX)) | 0, y = ((i / BOX) | 0) % BOX, x = i % BOX;
    const at = (a, b, c) => inBox(a, b, c) && solid[lin(a, b, c)] === 1;
    if ((at(x - 1, y, z) && at(x + 1, y, z)) || (at(x, y - 1, z) && at(x, y + 1, z)) ||
        (at(x, y, z - 1) && at(x, y, z + 1))) closed[i] = 1;
  }
  // cavites : ce que le vide exterieur n'atteint pas
  const outside = new Uint8Array(n), stack = [];
  for (let z = 0; z < BOX; z++) for (let y = 0; y < BOX; y++) for (let x = 0; x < BOX; x++) {
    if (x && y && z && x < BOX - 1 && y < BOX - 1 && z < BOX - 1) continue;
    const i = lin(x, y, z);
    if (!closed[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
  }
  while (stack.length) {
    const j = stack.pop();
    const z = (j / (BOX * BOX)) | 0, y = ((j / BOX) | 0) % BOX, x = j % BOX;
    for (const [dx, dy, dz] of SIX) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (!inBox(a, b, c)) continue;
      const k = lin(a, b, c);
      if (!outside[k] && !closed[k]) { outside[k] = 1; stack.push(k); }
    }
  }
  const blk1 = stepOneBlocked(), held = new Uint8Array(n);
  if (blk1) for (let i = 0; i < n; i++) if (blk1.has(winToHalo(i))) held[i] = 1;
  const want = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (solid[i] || edit[i] === E_REM || edit[i] === E_CUT || held[i]) continue;
    if (isTrace() && isOther(i)) continue;
    if (closed[i] || !outside[i]) want[i] = 1;
  }
  /* Combler ne doit pas contourner une separation voulue. Deux morceaux relies
     par des voxels coupes ou retires ont ete separes par le lecteur ; un amas
     de comblement qui toucherait les deux les ressouderait par le bord de la
     coupe. Un amas qui relie deux morceaux sans lien voulu comble un vrai trou,
     et reste. */
  const piece = labelComponents(i => solid[i] === 1);
  const joined = labelComponents(i => solid[i] === 1 || edit[i] === E_CUT || edit[i] === E_REM || held[i] === 1);
  const group = labelComponents(i => want[i] === 1);
  const rejected = new Set(), seenPiece = new Map();
  for (let i = 0; i < n; i++) {
    if (!want[i] || rejected.has(group[i])) continue;
    const z = (i / (BOX * BOX)) | 0, y = ((i / BOX) | 0) % BOX, x = i % BOX;
    for (const [dx, dy, dz] of SIX) {
      const a = x + dx, b = y + dy, c = z + dz;
      if (!inBox(a, b, c)) continue;
      const k = lin(a, b, c);
      if (!solid[k]) continue;
      const key = group[i] + ":" + joined[k];
      const other = seenPiece.get(key);
      if (other === undefined) seenPiece.set(key, piece[k]);
      else if (other !== piece[k]) { rejected.add(group[i]); break; }
    }
  }
  const changes = [];
  for (let i = 0; i < n; i++) if (want[i] && !rejected.has(group[i])) setOne(i, E_FILL, changes);
  if (!changes.length) return 0;
  undoStack.push(changes);
  if (undoStack.length > 90) undoStack.shift();
  commitEdit();
  return changes.length;
}
/* Etiquettes des amas 6-connexes des voxels qui verifient `inside` (-1 ailleurs). */
function labelComponents(inside) {
  const n = BOX * BOX * BOX, lab = new Int32Array(n).fill(-1), stack = [];
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (lab[i] >= 0 || !inside(i)) continue;
    lab[i] = next; stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      const z = (j / (BOX * BOX)) | 0, y = ((j / BOX) | 0) % BOX, x = j % BOX;
      for (const [dx, dy, dz] of SIX) {
        const a = x + dx, b = y + dy, c = z + dz;
        if (!inBox(a, b, c)) continue;
        const k = lin(a, b, c);
        if (lab[k] < 0 && inside(k)) { lab[k] = next; stack.push(k); }
      }
    }
    next++;
  }
  return lab;
}
/* Une forme ajoutee (seau) qui ne touche rien : un amas du solide, coupes
   comprises, sans aucun voxel de la forme proposee. */
/* Arbitrage : un morceau de l'etat de depart est legitime, meme isole dans la
   boite. Une completion peut le relier a la forme hors du bloc (15 oct.,
   <dalle>). Seul un nouvel ajout isole reste bloque. */
let arbStartCache = { id: null, set: null };
function arbStartSolid() {
  const id = answerId();
  if (arbStartCache.id !== id) {
    const st = ((byId.get(id) || {}).arbitration || {}).start || {};
    arbStartCache = { id, set: new Set([...(st.added_index || []), ...(st.filled_index || [])]) };
  }
  return arbStartCache.set;
}
function floatingAddition() {
  if (!edit) return false;
  const lab = labelComponents(i => solidNow(i) || edit[i] === E_CUT);
  const depart = isArbEdit() ? arbStartSolid() : null;
  const anchored = new Set();
  let any = false;
  for (let i = 0; i < lab.length; i++) {
    if (lab[i] < 0) continue;
    any = true;
    if (isCand(i) || (depart && depart.has(i))) anchored.add(lab[i]);
  }
  if (!any) return false;
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0 && !anchored.has(lab[i])) return true;
  return false;
}

function mipAction() {
  if (splitOn && cutting()) return "cut";
  if ($("editor").hidden) return null;
  if (tool === "trace") return "trace";
  if (tool === "del") return "erase";
  if (tool === "fill") return "bucket";
  if (tool === "b1" || tool === "b7") return "add";
  return null;
}
let mipStroke = null;
function applyMipStroke(ev) {
  const c = mipCell(ev);
  if (!c || !mipStroke) return;
  const key = c.x + "," + c.y;
  /* Dans un meme trait, une colonne n'est traitee qu'une fois ; recliquer
     plus tard au meme endroit la traite de nouveau — c'est ce qui permet
     d'ajouter le voxel suivant. */
  if (mipStroke.action === "trace") {
    /* Un clic, une ancre : glisser ne trace pas (le chemin se calcule entre ancres). */
    if (mipStroke.done) return;
    mipStroke.done = true;
    if (mipStroke.inverse) { endHair(); return; }
    traceClick(columnCandidates(c.x, c.y), mipStroke.changes);
    commitEdit();
    return;
  }
  if (mipStroke.seen.has(key)) return;
  mipStroke.seen.add(key);
  const wide = tool === "b7" || tool === "c7";
  for (const [dx, dy] of (wide ? LATERAL_CROSS : [[0, 0]]))
    columnAction(c.x + dx, c.y + dy, mipStroke.action, mipStroke.inverse, mipStroke.changes);
  commitEdit();
}

/* ===========================================================================
   Verdict
   ---------------------------------------------------------------------------
   `nature` est exclusive, `support` ne l'est pas : une composante peut etre a
   la fois mal detouree ET fusionner deux objets. `ok` reste exclusif des deux
   autres. Quand la composante a ete scindee, la nature n'est plus une propriete
   de la composante : `nature_scope` dit lequel des deux champs fait foi.
   ======================================================================== */
const F = $("c-floor"), C = $("c-ceil"), G = $("c-gamma"), O = $("c-opacity");

function blankVerdict() {
  if (isSecondTrace()) return { slab_id: answerId(), reader_id: reader.id, mode: "second_trace", points: [], none: false,
                                stage: "open", support: [], parts: [] };
  if (isSecond()) return { slab_id: answerId(), reader_id: reader.id, mode: "second", nature: null, several: null,
                           doubt: false, stage: "open" };
  if (isArbitrate()) return { slab_id: answerId(), reader_id: reader.id, mode: "arbitrate", choice: null,
                              nature: null, doubt: false, viewed: [] };
  /* En mode trace, les outils d'ajout (incorrect) et la liste des parties
     (merged) sont ouverts d'office : chaque poil trace est une partie. */
  return { slab_id: answerId(), reader_id: reader.id, nature: null, doubt: false,
           support: isTrace() ? ["incorrect", "merged"] : ["ok"],
           nature_scope: isTrace() ? "per_part" : "component", parts: [], added_voxels: 0, removed_voxels: 0 };
}
function stamp(v) {
  v.at = new Date().toISOString();
  v.lang = lang;
  v.overlay = overlay;
  v.deviated_display = deviated;
  v.display = { floor: +F.value, ceil: +C.value, gamma: +G.value, opacity: +O.value };
  captureEdits(v);
  v.seconds = Math.round((performance.now() - slabShownAt) / 1000);
  v.anchor = !!slab.anchor;
  v.contained = slab.contained !== false;
  v.factor = slab.factor;
  if (isTrace()) v.step1 = reader.step1 || null;
  if (isTileReview()) {
    const r = byId.get(answerId()).review || {};
    v.review = { reasons: r.reasons || [], points: r.points || [], wrong: r.wrong || 0,
                 readings_at: r.readings_at || null, built_at: COH.built_at || null };
  }
  if (isArbEdit()) {
    /* ce que la page montrait : le decompte, les verdicts de contour, la date
       de la derniere lecture (une lecture plus recente rouvre la dalle) */
    const a = byId.get(answerId()).arbitration || {};
    v.mode = "arbitrate_edit";
    v.arbitration = { reasons: a.reasons || [], state: a.state || null, votes: a.votes || [],
                      outline: a.outline || null, readings_at: a.readings_at || null, built_at: COH.built_at || null };
  }
  if (isArbitrate()) {
    const a = byId.get(answerId()).arbitration || {};
    v.viewed = [...arbSeen]; v.rule = a.rule; v.n_answers = (a.answers || []).length;
    const pick = (a.answers || []).find(x => x.label === v.choice);
    /* ce que la reponse retenue disait, pour lire la decision sans la cle */
    v.chosen = pick ? { nature: pick.nature || null, parts: (pick.parts || []).map(q => q.nature) } : null;
  }
  if (isComplete()) {
    const c = byId.get(answerId()).completion || {};
    v.mode = "complete";
    if (splitOn && parts.length > 1) saveParts();
    v.nature_scope = splitOn && parts.length > 1 ? "per_part" : "outside_box";
    v.completion = { lists: c.lists, attached: (c.attached || []).map(a => a.component_id), faces: c.faces || null,
                     step1_answered_at: c.step1 && c.step1.answered_at };
  }
  return v;
}
function setVerdict(field, value) {
  const id = slab.slab_id;
  const v = draft || (draft = blankVerdict());
  if (isSecond() && (v.stage || "open") !== "open" && (field === "nature" || field === "doubt")) return;   /* verrouillee */
  if (field === "nature") { v.nature = value; if (isArbitrate()) v.choice = "none"; if (isSecond()) v.several = null; }
  else if (field === "support" && isArbitrate()) return;
  else if (field === "support" && isComplete() && (value === "ok" || value === "skip")) v.support = [value];
  else if (field === "support" && isComplete()) {
    /* Retoucher et separer se combinent, comme a l'etape 1 ; garder et s'arreter sont exclusifs. */
    const s = new Set((v.support || []).filter(x => x === "incorrect" || x === "merged"));
    s.has(value) ? s.delete(value) : s.add(value);
    v.support = s.size ? [...s] : ["ok"];
  }
  else if (field === "doubt") v.doubt = !v.doubt;
  else {
    const s = new Set(v.support || ["ok"]);
    if (value === "ok") { s.clear(); s.add("ok"); }
    else {
      s.delete("ok");
      s.has(value) ? s.delete(value) : s.add(value);
      if (!s.size) s.add("ok");
    }
    v.support = [...s];
  }
  buildOpts(); syncEditor(); paintProgress();
}
function saveParts() {
  const v = draft;
  if (!v) return;
  v.parts = parts.map((pt, i) => ({ index: i, label: PART_LETTERS[i] || "?",
                                    voxels: pt.voxels, nature: pt.nature, doubt: !!pt.doubt,
                                    ...(isTrace() ? { touches_registry: !!pt.touches_registry } : {}) }));
  /* Sans cette clef, un lecteur d'analyse ne saurait pas s'il doit croire
     `nature` ou `parts` : une composante scindee n'a plus de nature unique. */
  v.nature_scope = parts.length > 1 || isTrace() ? "per_part" : "component";
}
/* La nature est obligatoire, parmi celles de la liste ; « Not sure » s'y ajoute
   sans jamais la remplacer. Un ancien « unsure » n'est plus une nature. */
const natureIds = () => S().nature.map(n => n[0]);
function verdictComplete() {
  const v = draft;
  if (needsBridge()) return false;
  if (!v) return false;
  const ok = natureIds();
  if (isArbitrate()) return !!v.choice && (v.choice !== "none" || ok.includes(v.nature));
  if (isSecondTrace()) {
    if (sec2Stage() === "open") return !!v.none || (v.points || []).length > 0;
    const st = sec2State();
    if (st === "loading") return false;
    if (st !== "compare") return true;
    return sec2Match().matched.every(k => v.valid && k in v.valid);
  }
  if (isSecond()) {
    if ((v.stage || "open") === "open") return ok.includes(v.nature) || !!(v.several && v.several.length);
    const st = secState();
    return st === "none" || st === "differ" || st === "na" || (st === "check" && !!v.outline);
  }
  /* Completion : s'arreter a la boite n'appelle pas de nature. */
  if (isComplete()) {
    if ((v.support || []).includes("skip")) return true;
    if (splitOn && parts.length > 1) return parts.every(p => ok.includes(p.nature));
    return ok.includes(v.nature);
  }
  /* Tuile sans poil trace : « rien de manque ici » est une reponse complete. */
  if (isTrace()) return parts.every(p => ok.includes(p.nature));
  if (v.nature_scope === "per_part" && parts.length > 1)
    return parts.every(p => ok.includes(p.nature));
  return ok.includes(v.nature);
}
function toggleDoubt() {
  if (!slab) return;
  if (splitOn && (parts.length > 1 || isTrace()) && parts[selectedPart]) {
    parts[selectedPart].doubt = !parts[selectedPart].doubt;
    saveParts(); buildParts(); buildOpts(); paintProgress();
  } else if (!isTrace()) setVerdict("doubt");
}

function buildOpts() {
  if (!slab) return;
  if (isArbEdit()) paintArbEdit();
  if (isTileReview()) paintTileReview();
  if (isSecondTrace()) {
    $("opts-nature").closest(".grp").hidden = true;
    $("opts-support").closest(".grp").hidden = true;
    paintSecond2(); return;
  }
  if (isSecond()) {
    $("opts-nature").closest(".grp").hidden = true;
    $("opts-support").closest(".grp").hidden = true;
    paintSecond(); return;
  }
  if (isArbitrate()) {
    $("opts-nature").closest(".grp").hidden = true;
    $("opts-support").closest(".grp").hidden = true;
    paintArb(); return;
  }
  const L = S(), cur = draft || {};
  const split = parts.length > 1 || (isTrace() && parts.length > 0);
  $("opts-support").closest(".grp").hidden = isTrace();

  const nat = $("opts-nature"), leg = $("natlegend");
  nat.replaceChildren();
  nat.hidden = split || isTrace();
  leg.hidden = !split;
  if (split) {
    leg.replaceChildren();
    const row = document.createElement("div");
    row.className = "legend";
    for (const [id, label] of isTrace() ? [] : L.nature) {
      const chip = document.createElement("span");
      const dot = document.createElement("i");
      dot.style.background = NAT_COLOR[id];
      chip.append(dot, document.createTextNode(label));
      row.appendChild(chip);
    }
    const dq = document.createElement("span");
    const q = document.createElement("b"); q.className = "dq-mark"; q.textContent = "?";
    dq.append(q, document.createTextNode(L.doubtLegend));
    row.appendChild(dq);
    leg.appendChild(row);
  } else {
    for (const [id, label, cls, key] of L.nature) {
      const b = document.createElement("button");
      b.className = "opt " + cls; b.type = "button";
      b.setAttribute("aria-pressed", String(cur.nature === id));
      const sw = document.createElement("span"); sw.className = "sw";
      const tx = document.createElement("span"); tx.textContent = label;
      const kk = document.createElement("span"); kk.className = "key"; kk.textContent = key;
      b.append(sw, tx, kk);
      b.onclick = () => setVerdict("nature", id);
      nat.appendChild(b);
    }
    /* « Not sure » : une case a part, qui s'ajoute a la nature choisie. */
    const d = document.createElement("button");
    d.className = "opt n-unsure doubt"; d.type = "button"; d.title = L.doubtTip;
    d.setAttribute("aria-pressed", String(!!cur.doubt));
    const box = document.createElement("span"); box.className = "tick";
    const dt = document.createElement("span"); dt.textContent = L.doubtLabel;
    const dk = document.createElement("span"); dk.className = "key"; dk.textContent = "4";
    d.append(box, dt, dk);
    d.onclick = () => setVerdict("doubt");
    nat.appendChild(d);
  }
  buildParts();

  /* Cliquer le NOM active le mode et ouvre son panneau ; le rouvrir n'efface
     rien. Seule la CROIX le retire, et elle previent d'abord. */
  const sup = $("opts-support");
  sup.replaceChildren();
  for (const [id, label, cls, key] of L.support) {
    const on = (cur.support || []).includes(id);
    /* Arbitrage : « Leave as is » ne rend pas la forme d'origine, il ne change que
       l'etiquette, et retire « Several objects » d'une dalle decoupee (15 oct.).
       Montre seulement s'il est deja le reglage de la dalle. */
    if (isArbEdit() && id === "ok" && !on) continue;
    const b = document.createElement("button");
    b.className = "opt " + cls; b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    const sw = document.createElement("span"); sw.className = "sw";
    const tx = document.createElement("span"); tx.textContent = label;
    b.append(sw, tx);
    const using = on && MODE_TOOLS[id] && MODE_TOOLS[id].includes(tool);
    if (using) b.classList.add("using");
    if (MODE_TOOLS[id] && on) {
      const dot = document.createElement("i");
      dot.className = "usedot"; dot.title = L.inUse;
      dot.setAttribute("aria-pressed", String(using));
      b.appendChild(dot);
      const kill = document.createElement("button");
      kill.className = "kill"; kill.type = "button";
      kill.textContent = "×"; kill.title = L.dropMode;
      kill.onclick = e => { e.stopPropagation(); askConfirm(L.dropWarn, () => dropMode(id)); };
      b.appendChild(kill);
    }
    const k = document.createElement("span");
    k.className = "key"; k.textContent = key;
    b.appendChild(k);
    b.onclick = () => enterMode(id);
    sup.appendChild(b);
  }
}
function buildParts() {
  const box = $("partlist");
  if (!box) return;
  box.replaceChildren();
  /* Une seule partie : la nature se choisit avec les boutons habituels. Afficher
     aussi la liste des parties faisait choisir la nature deux fois, parfois de
     facon contradictoire, et sans legende pour dire quelle pastille est quoi. */
  if (parts.length < 2 && !isTrace()) return;
  const nat = S().nature;
  parts.forEach((pt, i) => {
    const row = document.createElement("div");
    row.className = "part" + (i === selectedPart ? " sel" : "");
    row.onclick = () => { selectedPart = i; buildParts(); };
    const sw = document.createElement("i");
    sw.style.background = PART_COLORS[Math.min(i, PART_COLORS.length - 1)];
    const lbl = document.createElement("span");
    lbl.textContent = (PART_LETTERS[i] || "?") + " · " + pt.voxels + " vx";
    row.append(sw, lbl);
    for (const [id, label] of isTrace() ? [] : nat) {
      const b = document.createElement("button");
      b.type = "button"; b.title = label;
      b.style.color = NAT_COLOR[id];
      b.style.borderColor = "currentColor";
      b.style.background = pt.nature === id ? "currentColor" : "transparent";
      b.setAttribute("aria-pressed", String(pt.nature === id));
      b.onclick = e => {
        e.stopPropagation(); selectedPart = i; pt.nature = id;
        saveParts(); buildParts(); buildOpts(); paintProgress();
      };
      row.appendChild(b);
    }
    const dq = document.createElement("button");
    dq.type = "button"; dq.className = "dq"; dq.textContent = "?"; dq.title = S().doubtTip;
    dq.setAttribute("aria-pressed", String(!!pt.doubt));
    dq.onclick = e => {
      e.stopPropagation(); selectedPart = i; pt.doubt = !pt.doubt;
      saveParts(); buildParts(); buildOpts(); paintProgress();
    };
    row.appendChild(dq);
    if (isTrace()) {
      const del = document.createElement("button");
      del.type = "button"; del.className = "kill"; del.textContent = "\u00d7";
      del.title = S().trDelete;
      del.onclick = e => { e.stopPropagation(); deletePart(i); };
      row.appendChild(del);
    }
    box.appendChild(row);
  });
}
function enterMode(id) {
  const cur = draft || {};
  const on = (cur.support || []).includes(id);
  if (isArbEdit() && id === "ok" && !on) return;     /* voir buildOpts */
  /* Completion : quitter « Fix the outline » pour un autre choix jette les
     retouches, dans toute la region, et le dit d'abord. */
  if (isComplete() && (id === "ok" || id === "skip")) {
    if (on) return;
    const pending = haloEditCount() > 0;
    const go = () => { parts = []; splitOn = false; partLab = null; setVerdict("support", id); };
    if (pending) askConfirm(S().dropWarn, () => { dropHaloEdits(); go(); });
    else go();
    return;
  }
  if (id === "ok") { if (!on) setVerdict("support", "ok"); return; }
  if (!on) setVerdict("support", id);
  if (MODE_TOOLS[id]) setTool(MODE_TOOLS[id][0]);
}
/* Retirer un mode efface ce que ce mode a produit, et rien d'autre. Comme
   l'intention du lecteur vit dans `edit`, il n'y a plus a deviner l'origine
   d'un voxel : un ajout est un ajout, meme s'il portait une etiquette de partie. */
/* Retouches de toute la region (mode completion). */
function haloEditCount() {
  if (!halo) return 0;
  syncHaloFromWindow();
  let n = 0;
  for (let h = 0; h < halo.edit.length; h++) if (halo.edit[h] !== E_NONE) n++;
  return n;
}
function dropHaloEdits() {
  if (!halo) return;
  halo.edit.fill(E_NONE);
  if (draft) delete draft.bucket_seeds;
  syncWindowFromHalo();
  undoStack = [];
  commitEdit();
}
function dropMode(id) {
  if (isComplete() && halo) {
    syncHaloFromWindow();
    for (let h = 0; h < halo.edit.length; h++) {
      const e = halo.edit[h];
      if (id === "incorrect" ? (isAdded(e) || e === E_REM) : e === E_CUT) halo.edit[h] = E_NONE;
    }
    if (id === "incorrect" && draft) delete draft.bucket_seeds;
    if (id === "merged") { parts = []; splitOn = false; partLab = null; }
    syncWindowFromHalo(); undoStack = [];
    setVerdict("support", id); commitEdit(); return;
  }
  if (id === "incorrect") {
    for (let i = 0; i < edit.length; i++)
      if (isAdded(edit[i]) || edit[i] === E_REM) edit[i] = E_NONE;
    if (draft) delete draft.bucket_seeds;
  } else {
    for (let i = 0; i < edit.length; i++) if (edit[i] === E_CUT) edit[i] = E_NONE;
    parts = []; splitOn = false; partLab = null;
  }
  undoStack = [];
  setVerdict("support", id);
  commitEdit();
}

let confirmAction = null;
function askConfirm(msg, onYes, okLabel) {
  confirmAction = onYes;
  $("modal-msg").textContent = msg;
  $("modal-ok").textContent = okLabel || S().discard;
  $("modal").hidden = false;
  $("modal-ok").focus();
}
$("modal-cancel").onclick = () => { confirmAction = null; $("modal").hidden = true; };
$("modal-ok").onclick = () => {
  const f = confirmAction; confirmAction = null;
  $("modal").hidden = true;
  if (f) f();
};

let renderBeforeEdit = null, syncing = false;
function syncEditor() {
  if (syncing || !slab) return;
  /* Arbitrage : rien a editer, et les parties suivent la reponse montree. */
  if (isArbitrate()) { $("editor").hidden = true; $("splitter").hidden = true; return; }
  /* Seconde lecture : les outils ne s'ouvrent que pour retoucher le contour de l'auteur. */
  if (isSecond()) {
    const fixing = !!draft && draft.outline === "fixed";
    $("editor").hidden = !fixing; $("splitter").hidden = true;
    mc.classList.toggle("cutting", fixing);
    if (fixing && render !== "blocks") { renderBeforeEdit = render; setRender("blocks"); }
    else if (!fixing && renderBeforeEdit) { setRender(renderBeforeEdit); renderBeforeEdit = null; }
    paintCounts();
    return;
  }
  syncing = true;
  const v = draft;
  const sup = (v && v.support) || [];
  const edit = sup.includes("incorrect"), split = sup.includes("merged");
  const on = edit || split;
  if (cutting() && !split) { tool = "b1"; setToolUI(); }
  else if (!cutting() && !edit && split) { tool = "c1"; setToolUI(); }
  /* Un seul panneau a la fois : ils se substituent selon le mode dont les
     outils sont actifs. Les deux modes peuvent etre coches ensemble, mais
     afficher les deux panneaux obligeait a faire defiler la colonne. */
  const onSplit = split && (cutting() || !edit);
  const onEdit = edit && !onSplit;
  $("editor").hidden = !onEdit;
  $("splitter").hidden = !onSplit;
  mc.classList.toggle("cutting", onSplit || onEdit);
  if (split !== splitOn) {
    splitOn = split;
    if (split) recomputeParts(); else { partLab = null; parts = []; }
    buildParts(); commitEdit();
  }
  /* Pour tracer, on lit le signal : pas de bascule en Blocs en mode trace. */
  if (on && render !== "blocks" && !isTrace()) { renderBeforeEdit = render; setRender("blocks"); }
  else if (!on && renderBeforeEdit) { setRender(renderBeforeEdit); renderBeforeEdit = null; }
  paintCounts();
  if (!on) face = null;
  syncing = false;
}
function setToolUI() {
  for (const [id, val] of [["tl-b1","b1"],["tl-b7","b7"],["tl-del","del"],["tl-fill","fill"],["tl-trace","trace"],["ct-1","c1"],["ct-7","c7"]])
    $(id).setAttribute("aria-pressed", String(tool === val));
  if (slab) buildOpts();
}
function setTool(k) { if (k !== "trace" && traceLastH >= 0) endHair(); tool = k; setToolUI(); if (slab) syncEditor(); paintTraceState(); }

/* ===========================================================================
   File de lecture
   ---------------------------------------------------------------------------
   Les dalles d'ancrage sont lues par tout le monde : elles donnent l'accord
   entre lecteurs, donc le profil de chacun. Elles sont intercalees une fois sur
   trois plutot que groupees en tete — un lecteur qui s'arrete au bout de trente
   dalles en a quand meme lu une dizaine.

   Les autres sont servies par nombre de lectures croissant, puis dans un ordre
   aleatoire PROPRE A CHAQUE LECTEUR (cle tiree de la graine de la cohorte et de
   l'identifiant, donc reproductible). Avec un ordre commun, deux collegues qui
   commencent le meme apres-midi liraient exactement les memes dalles ; hors
   base, un lecteur exterieur suit un tirage purement au hasard, independant
   des autres. Chaque ordre est uniforme et ignore le contenu des dalles : ce
   qui a ete lu reste un tirage aleatoire a l'interieur de chaque strate, et
   une campagne interrompue en cours de route reste analysable.
   ======================================================================== */
/* Plusieurs sessions d'une meme personne (alice-1, alice-2...) : une dalle
   deja lue par l'une n'est resservie aux autres qu'en dernier. Sans cela,
   chaque session relirait les dalles d'ancrage, et une meme personne
   compterait pour deux lecteurs independants. Connu en base partagee seulement. */
const person = id => String(id || "").toLowerCase().replace(/-\d+$/, "");
const AUTHOR = CONFIG.author;       /* l'auteur, toutes sessions confondues */
const RETIRED = [];    /* identifiants de test abandonnes (sans suffixe) */
function readBySelf() {
  const me = person(reader && reader.id), out = new Set();
  for (const [rid, done] of Object.entries(store.peers || {}))
    if (reader && rid !== reader.id && person(rid) === me) for (const id of done) out.add(id);
  return out;
}
function readerKey(id) {
  const s = `${COH.seed}|${reader ? reader.id : ""}|${id}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  /* melange final : FNV seul laisse correlees les cles de chaines voisines */
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/* L'auteur lit pour de vrai les objets d'exercice — dalles d'exercice de
   l'etape 1, tuile <tuile> de la recherche (tiree avec pi = 0,98 : la
   retirer fausserait l'estimation). Faits pendant l'exercice, ils comptent ;
   sinon ils ouvrent sa file, meme s'il a saute le tutoriel. Recherche : page 1
   seulement, la tuile etant la meme sur les trois pages. */
const authorPractice = () => !!reader && person(reader.id) === AUTHOR && (!isTrace() || (COH.page || 1) === 1);
const counted = s => s && (!s.tutorial || authorPractice());
function buildQueue() {
  if (isComplete() || isArbitrate() || isArbEdit() || isTileReview()) { queue = COH.slabs.slice().sort((a, b) => a.rank - b.rank).map(s => s.slab_id); return; }
  let measured = COH.slabs.filter(s => !s.tutorial);
  /* Seconde lecture : seules les dalles que l'auteur a lues ont une reconstruction a valider. */
  if (isSecond() && store.mode === "shared") {
    const byAuthor = new Set(Object.entries(store.peers || {}).filter(([r]) => person(r) === AUTHOR).flatMap(([, d]) => d));
    measured = measured.filter(s => byAuthor.has(s.slab_id));
  }
  const anchors = measured.filter(s => s.anchor).sort((a, b) => a.rank - b.rank);
  const key = new Map(measured.map(s => [s.slab_id, readerKey(s.slab_id)]));
  const rest = measured.filter(s => !s.anchor)
    .sort((a, b) => ((counts[a.slab_id] || 0) - (counts[b.slab_id] || 0)) ||
                    (key.get(a.slab_id) - key.get(b.slab_id)));
  const out = [];
  let ai = 0, ri = 0, k = 0;
  while (ai < anchors.length || ri < rest.length) {
    const wantAnchor = k % 3 === 0 && ai < anchors.length;
    if (wantAnchor) out.push(anchors[ai++].slab_id);
    else if (ri < rest.length) out.push(rest[ri++].slab_id);
    else out.push(anchors[ai++].slab_id);
    k++;
  }
  /* Etape 2, second lecteur : les tuiles deja lues par l'auteur d'abord (tri stable). */
  if (isSecondTrace() && store.mode === "shared") {
    const byAuthor = new Set(Object.entries(store.peers || {}).filter(([r]) => person(r) === AUTHOR).flatMap(([, d]) => d));
    out.sort((a, b) => (byAuthor.has(a) ? 0 : 1) - (byAuthor.has(b) ? 0 : 1));
  }
  const self = readBySelf();
  queue = out.filter(id => !self.has(id)).concat(out.filter(id => self.has(id)));
  if (authorPractice()) queue.unshift(...COH.slabs.filter(s => s.tutorial).map(s => s.slab_id));
}
/* Les comptes de lectures se relisent en cours de session, au plus toutes les
   30 s et sans bloquer : lus une seule fois a l'ouverture, ils ignoreraient ce
   que les autres lecteurs font pendant ce temps. */
let peersAt = 0;
function refreshPeers() {
  if (store.mode !== "shared" || performance.now() - peersAt < 30000) return;
  peersAt = performance.now();
  store.pullPeers().then(buildQueue).catch(() => {});
}
/* La prochaine dalle neuve : la premiere de la file que le lecteur n'a pas
   encore confirmee. Rien d'autre ne fait avancer la frontiere. */
function nextFrontier() {
  /* Seconde lecture : une dalle verrouillee mais pas finie revient en premier. */
  for (const id of queue) if (!mine[id] || ((isSecond() || isSecondTrace()) && mine[id].stage !== "done")
                             || ((isArbEdit() || isTileReview()) && arbStale(id))) return id;
  return null;
}
function rebuildHistory() {
  history = Object.values(mine)
    .filter(v => v && v.slab_id && counted(byId.get(v.slab_id)))
    .sort((a, b) => String(a.confirmed_at || a.at || "").localeCompare(String(b.confirmed_at || b.at || "")))
    .map(v => v.slab_id);
  hi = history.length;
}
function doneCount() { return Object.keys(mine).filter(id => !byId.get(id)?.tutorial).length; }
function anchorsDone() {
  return COH.slabs.filter(s => s.anchor && mine[s.slab_id]).length;
}
function paintProgress() {
  const L = S();
  paintRevue();
  pickerPersist();
  const confirmBtn = $("w-confirm"), back = $("w-back"), fwd = $("w-fwd"), state = $("p-state");
  back.textContent = L.back;
  fwd.textContent = L.forward;
  if (isSecondTrace()) {
    const stage = sec2Stage(), ready = verdictComplete(), st = sec2State();
    if (practice) {
      $("p-fill").style.width = Math.round(100 * (practiceIdx + 1) / practiceList.length) + "%";
      $("p-text").textContent = L.tuPracticeTag;
      back.disabled = practiceIdx === 0; fwd.disabled = practiceIdx >= practiceList.length - 1;
    } else {
      const done = doneCount();
      $("p-fill").style.width = Math.min(100, Math.round(100 * done / goalCount())) + "%";
      $("p-text").textContent = L.progressTxt(done, goalCount());
      back.disabled = hi === 0; fwd.disabled = !revisiting();
    }
    $("p-step2").hidden = true;
    state.hidden = !revisiting();
    if (revisiting()) state.textContent = L.alreadyAnswered;
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = stage === "open" ? (ready ? L.lockAnswer : L.needNature)
      : st === "loading" ? L.secLoading
      : ready ? (practice && practiceIdx === practiceList.length - 1 ? L.tuFinish : L.next) : L.secNeedOutline;
    return;
  }
  if (isSecond()) {
    const stage = (draft && draft.stage) || "open", ready = verdictComplete(), st = secState();
    if (practice) {
      $("p-step2").hidden = true;
      $("p-fill").style.width = Math.round(100 * (practiceIdx + 1) / practiceList.length) + "%";
      $("p-text").textContent = L.tuPracticeTag;
      back.disabled = practiceIdx === 0; fwd.disabled = practiceIdx >= practiceList.length - 1;
    } else {
      const done = doneCount();
      $("p-fill").style.width = Math.min(100, Math.round(100 * done / goalCount())) + "%";
      $("p-text").textContent = L.progressTxt(done, goalCount());
      paintStep2($("p-step2"), done >= GOAL);
      back.disabled = hi === 0; fwd.disabled = !revisiting();
    }
    state.hidden = !revisiting();
    if (revisiting()) state.textContent = L.alreadyAnswered;
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = stage === "open"
      ? (ready ? L.lockAnswer : (draft && draft.several ? L.severalNeed : L.needNature))
      : st === "loading" ? L.secLoading
      : ready ? (practice && practiceIdx === practiceList.length - 1 ? L.tuFinish : L.next) : L.secNeedOutline;
    return;
  }
  if (practice) {
    $("p-step2").hidden = true;
    $("p-fill").style.width = Math.round(100 * (practiceIdx + 1) / practiceList.length) + "%";
    $("p-text").textContent = isPicker() ? `${practiceIdx + 1} / ${practiceList.length}` : L.tuPracticeTag;
    if (isPicker()) {
      state.hidden = true;
      confirmBtn.disabled = practiceIdx >= practiceList.length - 1;
      confirmBtn.textContent = L.forward;
      back.disabled = practiceIdx === 0;
      fwd.disabled = practiceIdx >= practiceList.length - 1;
      return;
    }
    /* L'exercice bloque comme la vraie session : une reponse incomplete n'est
       pas enregistree, on ne doit donc pas pouvoir la valider sans le voir. */
    const bridge = needsBridge(), ready = verdictComplete();
    state.hidden = true;
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = ready ? (practiceIdx === practiceList.length - 1 ? L.tuFinish : L.next)
      : bridge ? L.needBridge : (parts.length > 1 ? L.progressParts : L.needNature);
    back.disabled = practiceIdx === 0;
    fwd.disabled = practiceIdx >= practiceList.length - 1;
    return;
  }
  const done = doneCount();
  $("p-fill").style.width = Math.min(100, Math.round(100 * done / goalCount())) + "%";
  $("p-text").textContent = L.progressTxt(done, goalCount());
  paintStep2($("p-step2"), isStep1() && !isArbEdit() && done >= GOAL);
  const ready = verdictComplete();
  if (revisiting() && mine[answerId()] && mine[answerId()].needs_nature) {
    state.hidden = false;
    state.textContent = L.needNatureFix;
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = ready ? L.saveChange : (parts.length > 1 ? L.progressParts : L.needNature);
  } else if (revisiting()) {
    const dirty = changed();
    state.hidden = false;
    state.textContent = L.alreadyAnswered;
    confirmBtn.disabled = !dirty || !ready;
    confirmBtn.textContent = dirty ? L.saveChange : L.noChange;
  } else {
    state.hidden = true;
    const bridge = needsBridge();
    confirmBtn.disabled = !ready;
    confirmBtn.textContent = ready ? (isTrace() && !parts.length ? L.trNone : L.next)
      : bridge ? L.needBridge
      : (parts.length > 1 ? L.progressParts : L.needNature);
  }
  back.disabled = hi === 0;
  fwd.disabled = !revisiting();
}

/* ===========================================================================
   Ecrans
   ======================================================================== */
const SCREENS = ["gate", "tutorial", "work", "menu", "done"];
function show(name) {
  for (const s of SCREENS) $(s).hidden = s !== name;
  if (name === "work") requestAnimationFrame(() => { drawGL(); drawMIP(); });
}

/* Tant qu'une dalle charge, la page sait deja qu'elle est passee a la suivante
   (`slab`) mais tient encore la reponse de la precedente (`draft`). Un second
   clic pendant cet instant enregistrait cette reponse sous le numero de la
   nouvelle dalle : le 27 septembre, deux reponses d'exercice ont ete ecrasees
   ainsi par un double clic sur « Next ». Rien ne s'enregistre ni ne change de
   dalle pendant un chargement. */
let loadingSlabs = 0;
const slabBusy = () => loadingSlabs > 0;
async function openSlab(id, isPractice) {
  loadingSlabs++;
  try { return await openSlabNow(id, isPractice); } finally { loadingSlabs--; }
}
async function openSlabNow(id, isPractice) {
  practice = !!isPractice;
  const prevTile = slab && (slab.window_of || slab.slab_id);
  slab = byId.get(id);
  if (!slab) return;
  /* Mode trace : rouvrir une autre fenetre de la meme tuile ne change ni la
     reponse, ni le trace, ni l'orientation de la vue. */
  const switching = hasHalo() && !!draft && prevTile === (slab.window_of || slab.slab_id);
  const got = await fetchSlab(id);
  if (slab.slab_id === id) await loadField(slab.volume);
  if (slab.slab_id !== id) return;          /* le lecteur est deja passe ailleurs */
  fitMipFrame();
  vol = got.vol; skinTex = got.skin;
  edit = new Uint8Array(BOX * BOX * BOX);
  partLab = null;
  undoStack = []; face = null;
  if (!switching) {
    parts = []; splitOn = false; selectedPart = 0;
    /* La projection s'ouvre cadree sur le bloc (le carre rouge en mode trace) :
       on dezoome a la molette quand une structure semble en sortir. */
    yaw = VIEW0.yaw; pitch = VIEW0.pitch; zoom = 1.0; panX = 0; panY = 0; mipZoom = 1.0;
    slabShownAt = performance.now();
    todoDone = new Set(); paintTodo();
  }
  /* Le brouillon part de la reponse confirmee s'il y en a une, d'un brouillon
     laisse en route sinon, et d'une reponse vierge en dernier recours. On
     travaille toujours sur une COPIE : rien ne touche `mine` avant le clic. */
  const key = slab.window_of || id;
  if (!switching) {
    const base = isPicker() ? (picks()[key]?.answer || null)
      : (drafts[key] || ((isArbEdit() || isTileReview()) && arbStale(key) ? null : mine[key])
         || (isArbEdit() ? arbSeed(key) : isTileReview() ? tileSeed(key) : null));
    draft = base ? JSON.parse(JSON.stringify(base)) : blankVerdict();
  }
  const v = draft;
  if (v && edit) { if (switching) syncWindowFromHalo(); else restoreEdits(v); }
  if (v && v.support && v.support.includes("merged")) {
    splitOn = true;
    recomputeParts();
    /* Les natures par partie sont rechargees dans l'ordre ou elles ont ete
       posees : la connexite est deterministe, donc la partie A reste la partie A. */
    if (!switching) (v.parts || []).forEach((pt, i) => {
      if (parts[i]) { parts[i].nature = pt.nature; parts[i].doubt = !!pt.doubt; }
    });
  }
  if (isTrace()) {
    if (!switching) { traceLastH = -1; traceGreyH = null; }
    if (!["trace", "b1", "b7", "del"].includes(tool)) { tool = "trace"; setToolUI(); }
    /* Le doute de chaque poil trace revient avec la reponse (ordre de connexite
       deterministe, comme a l'etape 1). */
    if (!switching && v) (v.parts || []).forEach((pt, i) => { if (parts[i]) parts[i].doubt = !!pt.doubt; });
    paintWindows(); paintTraceState();
  }
  if ((isStep1() || isComplete()) && !switching) { traceLastH = -1; traceGreyH = null; paintTraceState(); }
  if (isComplete()) {
    if (!["b1", "b7", "del", "fill", "trace", "c1", "c7"].includes(tool)) { tool = "b1"; setToolUI(); }
    paintWindows();
  }
  if (isArbitrate()) { arbSeen = new Set(draft.viewed || []); showArbAnswer(-1, true); }
  if (isSecond()) secOpen(id);
  if (isSecondTrace()) sec2Open(id, switching);
  paintCompletion();
  syncAlpha();
  upload(); uploadSkin();
  $("m-practice").hidden = !practice;
  $("m-practice").textContent = practice ? S().tuPracticeTag : "";
  const cut = slab.contained === false;
  /* Mode trace, vue deplacee : la 3D ne montre plus le bloc a fouiller, et le dit. */
  const moved = hasHalo() && !!slab.window_of;
  $("b-cut").hidden = !cut && !moved;
  $("b-cut").textContent = cut ? S().cutWarn : moved ? S().trMovedView : "";
  paintSkinBadge();
  paintMeta(); buildOpts(); syncEditor(); drawGL(); drawMIP(); paintProgress();
  paintPicker();
  prefetch(2);
}
/* Arbitrage : montrer une reponse telle que son lecteur l'a laissee — ses
   ajouts, retraits, coupes et parties —, en lecture seule. -1 : la forme seule. */
let arbShown = -1, arbSeen = new Set();
const arbAnswers = () => { const s = slab && byId.get(answerId()); return (s && s.arbitration && s.arbitration.answers) || []; };
function showArbAnswer(i, quiet) {
  if (!isArbitrate() || !edit) return;
  const answers = arbAnswers();
  arbShown = i >= 0 && i < answers.length ? i : -1;
  const a = arbShown >= 0 ? answers[arbShown] : null;
  edit.fill(E_NONE);
  if (a) {
    for (const x of a.added_index || []) edit[x] = E_ADD;
    for (const x of a.removed_index || []) edit[x] = E_REM;
    for (const x of a.cut_index || []) edit[x] = E_CUT;
    for (const x of a.filled_index || []) edit[x] = E_FILL;
    arbSeen.add(a.label);
    if (draft) draft.viewed = [...arbSeen];
  }
  splitOn = !!(a && (a.support || []).includes("merged")); partLab = null; parts = [];
  if (splitOn) {
    recomputeParts();
    (a.parts || []).forEach((q, k) => { if (parts[k]) { parts[k].nature = q.nature; parts[k].doubt = !!q.doubt; } });
  }
  if (quiet) return;
  syncAlpha(); upload(); drawGL(); drawMIP(); paintArb();
}
function paintArb() {
  const box = $("arb-panel");
  if (!box) return;
  box.hidden = !isArbitrate() || !slab;
  if (box.hidden) return;
  const L = S(), answers = arbAnswers(), v = draft || {};
  $("arb-h").textContent = L.arbH; $("arb-dh").textContent = L.arbDH; $("arb-note").textContent = L.arbNote;
  const mk = (label, pressed, onclick, cls) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "opt " + (cls || "");
    b.setAttribute("aria-pressed", String(pressed));
    const sw = document.createElement("span"); sw.className = "sw";
    const tx = document.createElement("span"); tx.textContent = label;
    b.append(sw, tx); b.onclick = onclick;
    return b;
  };
  const list = $("arb-answers");
  list.replaceChildren(mk(L.arbShape, arbShown === -1, () => showArbAnswer(-1), "s-ok"));
  answers.forEach((a, i) => list.appendChild(mk(L.arbAnswer(a.label), arbShown === i, () => showArbAnswer(i), "s-inc")));
  $("arb-desc").textContent = arbShown >= 0 ? `${answers[arbShown].label} — ${L.arbDesc(answers[arbShown])}` : "";
  const dec = $("arb-decide");
  dec.replaceChildren();
  answers.forEach(a => dec.appendChild(mk(L.arbPick(a.label), v.choice === a.label, () => {
    draft.choice = a.label; draft.nature = null; paintArb(); paintProgress();
  }, "s-inc")));
  dec.appendChild(mk(L.arbNone, v.choice === "none", () => { draft.choice = "none"; paintArb(); paintProgress(); }, "s-mrg"));
  if (v.choice === "none")
    for (const [id, label, cls, key] of L.nature) dec.appendChild(mk(`${label} (${key})`, v.nature === id, () => setVerdict("nature", id), cls));
  const d = mk(L.doubtLabel + " (4)", !!v.doubt, () => setVerdict("doubt"), "n-unsure doubt");
  dec.appendChild(d);
}
/* ---- Arbitrage dans l'outil complet ----------------------------------------
   La dalle s'ouvre sur l'etat final de l'auteur dans la boite (etape 1, ou
   completion), natures et doutes effaces : rien ne montre ce qu'il avait dit.
   Une lecture arrivee apres sa decision rouvre la dalle, de nouveau a blanc. */
function arbSeed(id) {
  const a = (byId.get(id) || {}).arbitration || {};
  const v = Object.assign(blankVerdict(), JSON.parse(JSON.stringify(a.start || {})));
  v.nature = null; v.doubt = false;
  v.parts = (v.parts || []).map(p => ({ ...p, nature: null, doubt: false }));
  v.mode = "arbitrate_edit";
  return v;
}
function tileSeed(id) {
  const r = (byId.get(id) || {}).review || {};
  return Object.assign(blankVerdict(), JSON.parse(JSON.stringify(r.start || {})), { slab_id: id });
}
function arbStale(id) {
  const s = byId.get(id) || {}, v = mine[id], at = (s.arbitration || s.review || {}).readings_at;
  if (!v || !at) return false;
  return String(v.revised_at || v.confirmed_at || v.at || "") < at;
}
function paintArbEdit() {
  const box = $("arb-panel");
  if (!box) return;
  box.hidden = !slab;
  if (!slab) return;
  const L = S(), a = byId.get(answerId()).arbitration || {};
  const name = id => (L.nature.find(n => n[0] === id) || [id, id])[1];
  const groups = new Map();
  for (const x of a.votes || []) {
    const set = (x.set || []).map(name);
    const k = x.several ? L.arbSeveral(set) : (set[0] || "?");
    const g = groups.get(k) || { n: 0, doubt: 0 };
    g.n++; if (x.doubt) g.doubt++;
    groups.set(k, g);
  }
  $("arb-h").textContent = L.arbVotesH;
  const list = $("arb-answers");
  list.replaceChildren();
  for (const [k, g] of [...groups.entries()].sort((p, q) => q[1].n - p[1].n)) {
    const chip = document.createElement("span");
    chip.className = "opt"; chip.style.cursor = "default";
    chip.textContent = `${k} \u00d7${g.n}` + (g.doubt ? ` (${L.doubtLabel.toLowerCase()} \u00d7${g.doubt})` : "");
    list.appendChild(chip);
  }
  const o = a.outline || {}, lines = [];
  if ((o.ok || 0) + (o.rejected || 0) + (o.fixed || 0)) lines.push(L.arbOutline(o));
  for (const n of a.notes || []) lines.push(`\u201c${n}\u201d`);
  $("arb-desc").textContent = lines.join(" \u00b7 ");
  $("arb-dh").hidden = true; $("arb-decide").hidden = true;
  $("arb-note").textContent = arbStale(answerId()) ? L.arbReopened : L.arbEditNote;
}
function paintTileReview() {
  const box = $("arb-panel");
  if (!box) return;
  box.hidden = !slab;
  if (!slab) return;
  const L = S(), r = byId.get(answerId()).review || {};
  $("arb-h").textContent = L.trvH;
  const list = $("arb-answers");
  list.replaceChildren();
  const chip = text => { const c = document.createElement("span"); c.className = "opt"; c.style.cursor = "default"; c.textContent = text; list.appendChild(c); };
  if ((r.points || []).length) chip(L.trvPoints((r.points || []).length, r.n_readers || 1));
  if (r.wrong) chip(L.trvWrong(r.wrong));
  if (!r.author_read) chip(L.trvUnread);
  $("arb-desc").textContent = (r.notes || []).map(n => `\u201c${n}\u201d`).join(" \u00b7 ");
  $("arb-dh").hidden = true; $("arb-decide").hidden = true;
  $("arb-note").textContent = arbStale(answerId()) ? L.trvReopened : L.trvNote;
}
/* ---- Seconde lecture rapide (etape 1) --------------------------------------
   Trois temps par dalle : « open » (la forme automatique seule, le lecteur
   donne la nature), « locked » (nature verrouillee et deja enregistree ; la
   reconstruction de l'auteur apparait), « done ». La reponse de l'auteur n'est
   lue dans la base qu'apres le verrouillage : rien ne la montre avant. */
let secAuthor = { id: null, status: "none", answer: null };
function secSummary(v) {
  if (!v) return null;
  if (v.several && v.several.length) return { several: true, set: [...new Set(v.several)].sort() };
  let ps = v.parts || [];
  /* Les parties de moins de 0,75 mm sont des fragments : elles ne font pas « plusieurs
     objets » (decision de l'auteur du 9 oct., seuil de METRIQUES §8.13). Marquees
     sur la reponse de l'auteur par secShow. */
  if (ps.length > 1 && ps.some(q => q.fragment)) {
    const gros = ps.filter(q => !q.fragment);
    ps = gros.length ? gros : [ps.reduce((m, q) => ((q.voxels || 0) > (m.voxels || 0) ? q : m))];
    if (ps.length === 1) return { several: false, set: ps[0].nature ? [ps[0].nature] : [], fragments_ignored: true };
  }
  if (ps.length > 1) return { several: true, set: [...new Set(ps.map(q => q.nature).filter(Boolean))].sort() };
  return { several: false, set: v.nature ? [v.nature] : [] };
}
const FRAGMENT_MM = 0.75;
/* Plus grande arete de la boite englobante de chaque partie, en mm. */
function partExtentsMm() {
  const sp = (slab && slab.spacing_mm) || [1, 1, 1], lo = [], hi = [];
  for (let i = 0; i < (partLab ? partLab.length : 0); i++) {
    const k = partLab[i];
    if (k < 0) continue;
    const c = [i % BOX, ((i / BOX) | 0) % BOX, (i / (BOX * BOX)) | 0];
    if (!lo[k]) { lo[k] = c.slice(); hi[k] = c.slice(); continue; }
    for (let d = 0; d < 3; d++) { if (c[d] < lo[k][d]) lo[k][d] = c[d]; if (c[d] > hi[k][d]) hi[k][d] = c[d]; }
  }
  return lo.map((l, k) => (l ? Math.max(...[0, 1, 2].map(d => (hi[k][d] - l[d] + 1) * sp[d])) : 0));
}
function secState() {
  if (!draft || (draft.stage || "open") === "open") return "open";
  if (secAuthor.id !== answerId() || secAuthor.status === "loading") return "loading";
  if (secAuthor.status !== "ok") return "none";
  const a = secSummary(secAuthor.answer), b = secSummary(draft);
  if (!a || !b || a.several !== b.several || a.set.join() !== b.set.join()) return "differ";
  return a.set.includes("hair") ? "check" : "na";
}
const secMerged = () => !!(secAuthor.answer && (secAuthor.answer.support || []).includes("merged"));
/* Seconde lecture : l'objet de l'auteur APRES completion (contrat §19), fige par
   scripts/build_second_reading_reference.py dans ref_auteur.json. La page de
   l'annotateur ne lit pas la base des pages de completion. Charge a la premiere
   dalle verrouillee, jamais avant. */
let refAuteur;
/* Un appel qui ne repond jamais bloquait la page sur « Loading… » (12 oct.,
   essai de l'auteur en seconde lecture) : chaque appel a un delai, et l'etape
   qui manque est montree au lecteur, avec un bouton pour reessayer. */
function delai(p, ms, etape) {
  return Promise.race([p, new Promise((_, ko) => setTimeout(() => ko(new Error(etape + " : pas de reponse")), ms))]);
}
async function refAuteurDe(id) {
  if (refAuteur === undefined) {
    let r;
    try { r = await delai(fetch(dataUrl("ref_auteur.json")), 10000, "ref_auteur.json"); }
    catch (e) { throw new Error(e && e.message || "ref_auteur.json"); }
    if (!r.ok) refAuteur = null;              /* page sans reconstructions figees (recherche) */
    else {
      try { refAuteur = (await delai(r.json(), 10000, "ref_auteur.json (lecture)")).dalles || {}; }
      catch (e) {
        /* une reponse qui n'est pas du JSON : pas de fichier fige sur cette page */
        if (e && /pas de reponse/.test(e.message || "")) throw e;
        refAuteur = null;
      }
    }
  }
  return refAuteur && refAuteur[id] ? JSON.parse(JSON.stringify(refAuteur[id])) : null;
}
async function fetchAuthorAnswer(id) {
  const fige = await refAuteurDe(id);
  if (fige) return fige;
  if (!store.db || store.mode !== "shared") return null;
  const s = byId.get(id);
  if (!s) return null;
  const chunk = Math.floor(s.rank / CHUNK);
  const when = v => v.revised_at || v.confirmed_at || v.at || "";
  let best = null, bestRid = null;
  for (const rid of Object.keys(store.peers || {}).filter(r => person(r) === AUTHOR)) {
    const snap = await delai(store.db.doc(`verdicts/${rid}__${chunk}`).get(), 15000, `base : verdicts/${rid}__${chunk}`);
    if (!snap.exists) continue;
    const v = ((snap.data() || {}).answers || {})[id];
    if (v && v.slab_id === id && (!best || when(v) > when(best))) { best = v; bestRid = rid; }
  }
  if (!best) return null;
  const e = await delai(store.db.doc(`edits/${bestRid}__${id}`).get(), 15000, `base : edits/${bestRid}__${id}`);
  const raw = e.exists ? (e.data() || {}) : {};
  const ed = store.staleEdits(best, raw) ? {} : raw;
  return { ...best, reader_id: bestRid, added_index: ed.added_index || [], removed_index: ed.removed_index || [],
           cut_index: ed.cut_index || [], filled_index: ed.filled_index || [],
           /* etape 2 : la forme du registre rattachee au poil trace en fait partie */
           attached_index: ed.attached_index || [] };
}
function secOpen(id) {
  if (!draft) return;
  if ((draft.stage || "open") === "open") { edit.fill(E_NONE); splitOn = false; parts = []; partLab = null; return; }
  secLoad(id);
}
async function secLoad(id) {
  if (secAuthor.id === id && secAuthor.status === "ok") { secShow(); return; }
  secAuthor = { id, status: "loading", answer: null };
  paintSecond(); paintProgress();
  let a = null, erreur = null;
  try { a = await fetchAuthorAnswer(id); } catch (e) { a = null; erreur = (e && e.message) || String(e); }
  if (answerId() !== id) return;               /* le lecteur est deja passe ailleurs */
  secAuthor = { id, status: a ? "ok" : "none", answer: a, error: erreur };
  secShow();
}
/* Montre la reconstruction de l'auteur — ou, si le lecteur la retouche, la sienne. */
function secShow() {
  if (!edit) return;
  const own = draft && draft.outline === "fixed" && Array.isArray(draft.added_index);
  const a = own ? draft : (secAuthor.status === "ok" ? secAuthor.answer : null);
  edit.fill(E_NONE);
  if (a) {
    for (const x of a.added_index || []) edit[x] = E_ADD;
    for (const x of a.removed_index || []) edit[x] = E_REM;
    for (const x of a.cut_index || []) edit[x] = E_CUT;
    for (const x of a.filled_index || []) edit[x] = E_FILL;
  }
  splitOn = secMerged(); partLab = null; parts = [];
  const ap = (secAuthor.answer && secAuthor.answer.parts) || [];
  if (!own && ap.length > 1) {
    /* les fragments de l'auteur, mesures sur ses parties telles que la page les numerote */
    recomputeParts();
    const ext = partExtentsMm();
    ap.forEach((q, k) => { q.fragment = k < ext.length && ext[k] < FRAGMENT_MM; });
    if (!splitOn) { parts = []; partLab = null; }
  }
  if (splitOn) {
    if (!partLab) recomputeParts();
    ap.forEach((q, k) => { if (parts[k]) { parts[k].nature = q.nature; parts[k].doubt = !!q.doubt; } });
  }
  syncAlpha(); upload(); drawGL(); drawMIP(); syncEditor(); paintSecond(); paintProgress();
}
function secSeveral() {
  if (!isSecond() || !draft || (draft.stage || "open") !== "open") return;
  draft.several = draft.several ? null : [];
  if (draft.several) draft.nature = null;
  paintSecond(); paintProgress();
}
function secToggleSeveral(n) {
  if (!draft || !draft.several || (draft.stage || "open") !== "open") return;
  const s = new Set(draft.several);
  s.has(n) ? s.delete(n) : s.add(n);
  draft.several = [...s];
  paintSecond(); paintProgress();
}
function secSetOutline(c) {
  if (!draft || secState() !== "check" || (c === "fixed" && secMerged())) return;
  const was = draft.outline;
  draft.outline = c;
  if (c !== "rejected") delete draft.outline_note;
  if (c === "fixed") { if (was !== "fixed") { tool = "b1"; setToolUI(); undoStack = []; captureEdits(draft); } }
  else {
    for (const k of ["added_index", "removed_index", "cut_index", "filled_index", "added_voxels", "removed_voxels", "filled_voxels"]) delete draft[k];
    delete draft.support;
    if (was === "fixed") { secShow(); return; }
  }
  syncEditor(); paintSecond(); paintProgress();
}
async function secConfirm() {
  const id = answerId();
  if (!draft || !verdictComplete()) return;
  if ((draft.stage || "open") === "open") {
    /* Verrouillage : la nature part dans la base avant que l'auteur se montre. */
    draft.stage = "locked";
    draft.locked_at = new Date().toISOString();
    draft.seconds_nature = Math.round((performance.now() - slabShownAt) / 1000);
    stamp(draft);
    if (practice) draft.practice = true;
    draft.confirmed_at = draft.confirmed_at || draft.locked_at;
    await store.put(id, JSON.parse(JSON.stringify(draft)));
    paintSecond(); paintProgress();
    await secLoad(id);
    return;
  }
  const st = secState(), a = secAuthor.answer;
  draft.first_reader = a ? { reader_id: a.reader_id, at: a.revised_at || a.confirmed_at || a.at, summary: secSummary(a) } : null;
  draft.agreement = st === "differ" ? "differ" : st === "none" ? "unknown" : "agree";
  if (st !== "check") draft.outline = st === "na" ? "n/a" : null;
  if (draft.outline === "fixed") { draft.support = ["incorrect"]; autoFill(); }
  const wasDone = !!(mine[id] && mine[id].stage === "done");
  draft.stage = "done";
  stamp(draft);
  if (practice) draft.practice = true;
  if (wasDone) { draft.revisions = (mine[id].revisions || 0) + 1; draft.revised_at = new Date().toISOString(); }
  await store.put(id, draft);
  delete drafts[id];
  if (practice) { await practiceStep(1); return; }
  if (revisiting()) { hi += 1; await goTo(hi < history.length ? history[hi] : frontierId); return; }
  if (!history.includes(id)) history.push(id);
  hi = history.length;
  counts[id] = (counts[id] || 0) + 1;
  refreshPeers();
  frontierId = nextFrontier();
  await goTo(frontierId);
  paintSave();
  if (doneCount() >= GOAL && !reader.step2Offered) offerStep2();
}
function paintSecond() {
  const box = $("sec-panel");
  if (!box) return;
  box.hidden = !isSecond() || !slab;
  if (box.hidden) return;
  const L = S(), v = draft || {}, locked = (v.stage || "open") !== "open";
  const mk = (label, pressed, onclick, cls, key, disabled) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "opt " + (cls || "");
    b.setAttribute("aria-pressed", String(!!pressed)); b.disabled = !!disabled;
    const sw = document.createElement("span"); sw.className = "sw";
    const tx = document.createElement("span"); tx.textContent = label;
    b.append(sw, tx);
    if (key) { const k = document.createElement("span"); k.className = "key"; k.textContent = key; b.appendChild(k); }
    b.onclick = onclick;
    return b;
  };
  $("sec-h").textContent = L.hNature;
  const nat = $("sec-nature");
  nat.replaceChildren();
  for (const [id, label, cls, key] of L.nature) nat.appendChild(mk(label, v.nature === id, () => setVerdict("nature", id), cls, key, locked));
  nat.appendChild(mk(L.severalLabel, !!v.several, () => secSeveral(), "s-mrg", "5", locked));
  if (v.several) {
    const row = document.createElement("div");
    row.className = "chips"; row.style.cssText = "flex-wrap:wrap;margin:2px 0 4px 16px"; row.title = L.severalTip;
    for (const [id, label] of L.nature) {
      const c = document.createElement("button");
      c.type = "button"; c.className = "chip"; c.disabled = locked;
      c.setAttribute("aria-pressed", String(v.several.includes(id)));
      const i = document.createElement("i"), t = document.createElement("span"); t.textContent = label;
      c.append(i, t); c.onclick = () => secToggleSeveral(id);
      row.appendChild(c);
    }
    nat.appendChild(row);
  }
  nat.appendChild(mk(L.doubtLabel, !!v.doubt, () => setVerdict("doubt"), "n-unsure doubt", "4", locked));
  const chk = $("sec-check");
  chk.hidden = !locked;
  if (!locked) return;
  $("sec-locked").textContent = L.secLocked;
  const st = secState(), a = secAuthor.answer, out = $("sec-outline"), qh = $("sec-qh"), first = $("sec-first");
  out.replaceChildren(); qh.textContent = "";
  if (st === "loading") { first.textContent = L.secLoading; return; }
  if (st === "none") {
    first.textContent = L.secUnavailable + (secAuthor.error ? ` (${secAuthor.error})` : "");
    if (secAuthor.error) out.appendChild(mk(L.secRetry || "Retry", false, () => { const id = answerId(); secAuthor = { id: null, status: "none", answer: null }; secLoad(id); }, "s-ok"));
    return;
  }
  const ps = (a.parts || []).length > 1 ? a.parts.map(q => q.nature || "?") : [];
  first.textContent = `${L.secFirst}: ${L.secDesc({ nature: a.nature, parts: ps })}`;
  if (st === "differ") { qh.textContent = L.secDisagree; return; }
  if (st === "na") { qh.textContent = L.secNa; return; }
  qh.textContent = L.secAgreeQ;
  /* Ordre et ton voulus par l'auteur (12 oct.) : d'accord, pas d'accord, puis
     retoucher — en dernier et plus pale, puisque facultatif. */
  out.appendChild(mk(L.secOk, v.outline === "ok", () => secSetOutline("ok"), "s-ok"));
  out.appendChild(mk(L.secBad, v.outline === "rejected", () => secSetOutline("rejected"), "s-mrg"));
  if (v.outline === "rejected") out.appendChild(whyField(L.secWhy, "outline_note"));
  out.appendChild(mk(L.secFix, v.outline === "fixed", () => secSetOutline("fixed"), "s-inc optional", null, secMerged()));
}
/* Le court message d'un second lecteur qui juge un contour ou un trace faux. */
function whyField(placeholder, key) {
  const f = document.createElement("input");
  f.type = "text"; f.maxLength = 200; f.className = "pk-note"; f.placeholder = placeholder;
  f.value = (draft && draft[key]) || "";
  f.oninput = () => { if (!draft) return; const s = f.value.trim(); if (s) draft[key] = s; else delete draft[key]; };
  return f;
}
/* ---- Seconde lecture rapide (etape 2) ---------------------------------------
   Le lecteur voit la tuile comme l'auteur : rien. Il pointe d'un clic chaque
   poil manque, ou dit qu'il n'y en a aucun, et verrouille. Les traces de
   l'auteur, lues ensuite dans la base, sont comparees aux points (colonnes a
   deux voxels pres) : un trace pointe se valide ; un point sans trace, ou un
   trace sans point, devient une alerte pour l'auteur. */
let sec2Author = { id: null, status: "none", answer: null, hairs: null };
const sec2Stage = () => (draft && draft.stage) || "open";
function sec2Hairs(a) {
  const size = halo.size, n = size * size * BOX, mask = new Uint8Array(n), lab = new Int32Array(n).fill(-1), out = [];
  for (const k of ["added_index", "filled_index", "attached_index"]) for (const h of a[k] || []) mask[h] = 1;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const id = out.length, cols = new Set(), stack = [i];
    let count = 0;
    lab[i] = id;
    while (stack.length) {
      const j = stack.pop(); count++;
      const x = j % size, y = ((j / size) | 0) % size, z = (j / (size * size)) | 0;
      cols.add(y * size + x);
      for (const [dx, dy, dz] of SIX) {
        const a2 = x + dx, b = y + dy, c = z + dz;
        if (a2 < 0 || b < 0 || c < 0 || a2 >= size || b >= size || c >= BOX) continue;
        const k2 = (c * size + b) * size + a2;
        if (mask[k2] && lab[k2] < 0) { lab[k2] = id; stack.push(k2); }
      }
    }
    out.push({ voxels: count, cols });
  }
  return out;
}
function sec2Match() {
  const size = halo ? halo.size : 0, hairs = sec2Author.hairs || [], pts = draft && !draft.none ? draft.points || [] : [];
  const near = (q, h) => { for (const c of h.cols) if (Math.abs(c % size - q.x) <= 2 && Math.abs(((c / size) | 0) - q.y) <= 2) return true; return false; };
  const pointHair = pts.map(q => hairs.findIndex(h => near(q, h)));
  const matched = [...new Set(pointHair.filter(k => k >= 0))];
  return { pointHair, matched,
           unmatchedPoints: pointHair.map((k, i) => (k < 0 ? i : -1)).filter(i => i >= 0),
           unmatchedHairs: hairs.map((_, k) => k).filter(k => !matched.includes(k)) };
}
function sec2State() {
  if (sec2Stage() === "open") return "open";
  if (sec2Author.id !== answerId() || sec2Author.status === "loading") return "loading";
  if (sec2Author.status === "none") return "none";
  if (sec2Author.status === "unread") return "unread";
  const n = sec2Author.hairs.length, m = draft.none ? 0 : (draft.points || []).length;
  if (!n && !m) return "agree_empty";
  if (!n) return "reader_only";
  if (!m) return "author_only";
  return "compare";
}
function sec2Open(id, switching) {
  if (!draft || sec2Stage() === "open") return;
  if (switching) { paintSecond2(); return; }    /* autre fenetre de la meme tuile : la marge garde les traces */
  sec2Load(id);
}
async function sec2Load(id) {
  /* Sans base (lecteur en lecture seule), les traces figes de l'auteur suffisent (12 oct.). */
  const enBase = !!(store.db && store.mode === "shared");
  if (sec2Author.id === id && (sec2Author.status === "ok" || sec2Author.status === "unread")) { sec2Show(); return; }
  sec2Author = { id, status: "loading", answer: null, hairs: null };
  paintSecond2(); paintProgress();
  let a = null, erreur = null;
  try { a = await fetchAuthorAnswer(id); } catch (e) { a = null; erreur = (e && e.message) || String(e); }
  if (answerId() !== id) return;
  /* introuvable : non lue par l'auteur si la base repond ou si les traces figes existent */
  const absente = enBase || (refAuteur && Object.keys(refAuteur).length) ? "unread" : "none";
  sec2Author = erreur ? { id, status: "none", answer: null, hairs: null, error: erreur }
                      : { id, status: a ? "ok" : absente, answer: a, hairs: a && halo ? sec2Hairs(a) : [] };
  sec2Show();
}
function sec2Show() {
  if (!halo) return;
  halo.edit.fill(E_NONE);
  const a = sec2Author.status === "ok" ? sec2Author.answer : null;
  if (a) {
    for (const h of a.added_index || []) halo.edit[h] = E_ADD;
    for (const h of a.filled_index || []) halo.edit[h] = E_FILL;
  }
  syncWindowFromHalo(); syncAlpha(); upload(); drawGL(); drawMIP(); paintSecond2(); paintProgress();
}
function sec2AddPoint(x, y) {
  if (!draft || sec2Stage() !== "open") return;
  draft.points = (draft.points || []).concat([{ x, y }]);
  draft.none = false;
  drawMIP(); paintSecond2(); paintProgress();
}
function sec2RemoveNear(x, y) {
  if (!draft || sec2Stage() !== "open" || !(draft.points || []).length) return;
  let best = -1, bd = Infinity;
  draft.points.forEach((q, i) => { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = i; } });
  if (best >= 0 && bd <= 4) draft.points = draft.points.filter((_, i) => i !== best);
  drawMIP(); paintSecond2(); paintProgress();
}
function sec2ToggleNone() {
  if (!draft || sec2Stage() !== "open") return;
  draft.none = !draft.none;
  if (draft.none) draft.points = [];
  drawMIP(); paintSecond2(); paintProgress();
}
function sec2SetValid(k, ok) {
  if (!draft || sec2State() !== "compare") return;
  draft.valid = { ...(draft.valid || {}), [k]: ok };
  if (!Object.values(draft.valid).includes(false)) delete draft.valid_note;
  paintSecond2(); paintProgress();
}
async function sec2Confirm() {
  const id = answerId();
  if (!draft || !verdictComplete()) return;
  if (sec2Stage() === "open") {
    draft.stage = "locked";
    draft.locked_at = new Date().toISOString();
    draft.seconds_search = Math.round((performance.now() - slabShownAt) / 1000);
    stamp(draft);
    if (practice) draft.practice = true;
    draft.confirmed_at = draft.confirmed_at || draft.locked_at;
    await store.put(id, JSON.parse(JSON.stringify(draft)));
    paintSecond2(); paintProgress();
    await sec2Load(id);
    return;
  }
  const st = sec2State(), a = sec2Author.answer;
  draft.first_reader = a ? { reader_id: a.reader_id, at: a.revised_at || a.confirmed_at || a.at, hairs: (sec2Author.hairs || []).length } : null;
  draft.comparison = st;
  draft.matches = []; draft.alerts = [];
  if (st === "compare" || st === "reader_only" || st === "author_only") {
    const m = sec2Match();
    draft.matches = m.matched.map(k => ({ hair: k, voxels: sec2Author.hairs[k].voxels,
      points: m.pointHair.map((h, i) => (h === k ? i : -1)).filter(i => i >= 0), valid: draft.valid ? !!draft.valid[k] : null }));
    draft.alerts = [...m.unmatchedPoints.map(i => ({ type: "seen_by_second_only", point: draft.points[i] })),
                    ...m.unmatchedHairs.map(k => ({ type: "not_seen_by_second", hair: k, voxels: sec2Author.hairs[k].voxels }))];
  }
  const wasDone = !!(mine[id] && mine[id].stage === "done");
  draft.stage = "done";
  stamp(draft);
  if (practice) draft.practice = true;
  if (wasDone) { draft.revisions = (mine[id].revisions || 0) + 1; draft.revised_at = new Date().toISOString(); }
  await store.put(id, draft);
  delete drafts[id];
  if (practice) { await practiceStep(1); return; }
  if (revisiting()) { hi += 1; await goTo(hi < history.length ? history[hi] : frontierId); return; }
  if (!history.includes(id)) history.push(id);
  hi = history.length;
  counts[id] = (counts[id] || 0) + 1;
  refreshPeers();
  frontierId = nextFrontier();
  await goTo(frontierId);
  paintSave();
}
function paintSecond2() {
  const box = $("sec-panel");
  if (!box) return;
  box.hidden = !isSecondTrace() || !slab;
  if (box.hidden) return;
  const L = S(), v = draft || {}, locked = sec2Stage() !== "open";
  const mk = (label, pressed, onclick, cls, key, disabled) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "opt " + (cls || "");
    b.setAttribute("aria-pressed", String(!!pressed)); b.disabled = !!disabled;
    const sw = document.createElement("span"); sw.className = "sw";
    const tx = document.createElement("span"); tx.textContent = label;
    b.append(sw, tx);
    if (key) { const k = document.createElement("span"); k.className = "key"; k.textContent = key; b.appendChild(k); }
    b.onclick = onclick;
    return b;
  };
  const note = t => { const q = document.createElement("p"); q.className = "note"; q.textContent = t; return q; };
  $("sec-h").textContent = L.hNature;
  const top = $("sec-nature");
  top.replaceChildren(note(L.s2Instr), note(L.s2Count(v.none ? 0 : (v.points || []).length)));
  top.appendChild(mk(L.s2Undo, false, () => { if (v.points && v.points.length) { draft.points = v.points.slice(0, -1); drawMIP(); paintSecond2(); paintProgress(); } },
                     "s-inc", null, locked || !(v.points || []).length));
  top.appendChild(mk(L.s2None, !!v.none, () => sec2ToggleNone(), "s-ok", "0", locked));
  const chk = $("sec-check");
  chk.hidden = !locked;
  if (!locked) return;
  $("sec-locked").textContent = L.secLocked;
  const st = sec2State(), out = $("sec-outline"), qh = $("sec-qh"), first = $("sec-first");
  out.replaceChildren(); qh.textContent = "";
  if (st === "loading") { first.textContent = L.secLoading; return; }
  if (st === "none") {
    first.textContent = L.secUnavailable + (sec2Author.error ? ` (${sec2Author.error})` : "");
    if (sec2Author.error) out.appendChild(mk(L.secRetry || "Retry", false, () => { const id = answerId(); sec2Author = { id: null, status: "none", answer: null, hairs: null }; sec2Load(id); }, "s-ok"));
    return;
  }
  if (st === "unread") { first.textContent = L.s2Unread; return; }
  first.textContent = L.s2First((sec2Author.hairs || []).length);
  if (st === "agree_empty") { qh.textContent = L.s2AgreeEmpty; return; }
  if (st === "reader_only") { qh.textContent = L.s2ReaderOnly; return; }
  if (st === "author_only") { qh.textContent = L.s2AuthorOnly(sec2Author.hairs.length); return; }
  const m = sec2Match();
  qh.textContent = L.s2CheckQ;
  for (const k of m.matched) {
    const i = m.pointHair.indexOf(k) + 1;
    out.appendChild(note(L.s2Hair(i)));
    out.appendChild(mk(L.s2Right, v.valid && v.valid[k] === true, () => sec2SetValid(k, true), "s-ok"));
    out.appendChild(mk(L.s2Wrong, v.valid && v.valid[k] === false, () => sec2SetValid(k, false), "s-mrg"));
  }
  if (m.matched.some(k => v.valid && v.valid[k] === false)) out.appendChild(whyField(L.s2Why, "valid_note"));
  if (m.unmatchedPoints.length) out.appendChild(note(L.s2Unmatched(m.unmatchedPoints.length)));
  if (m.unmatchedHairs.length) out.appendChild(note(L.s2Missed(m.unmatchedHairs.length)));
}
/* Completion : ce qui continue hors de la boite, et pourquoi la dalle est la. */
function paintCompletion() {
  const box = $("cmp-info");
  if (!box) return;
  box.hidden = !isComplete() || !slab;
  if (box.hidden) return;
  const L = S(), c = byId.get(answerId()).completion || {}, lines = [];
  for (const a of c.attached || []) {
    lines.push(L.cmpListA(a));
    if (a.beyond_native) lines.push(L.cmpBeyond(a.beyond_native));
  }
  if (c.faces) lines.push(L.cmpListB(c.faces.faces));
  /* La nature de l'etape 1 n'est plus affichee (9 oct.) : la completion est la relecture a l'aveugle de l'auteur. */
  if (byId.get(answerId()).practice_slab) lines.push(L.cmpPractice);
  $("cmp-h").textContent = L.cmpH;
  const body = $("cmp-text");
  body.replaceChildren(...lines.map(t => { const p = document.createElement("p"); p.className = "note"; p.textContent = t; return p; }));
}
/* Quand la peau passe hors de la boite, la page n'en dessine aucune — plutot
   qu'une fausse. Le bandeau rend au lecteur son repere : de quel cote, et a
   quelle distance de la face la plus proche. */
function paintSkinBadge() {
  const b = $("b-skin"), L = S();
  const st = slab && slab.skin_state;
  const text = st === "above" ? L.skinAbove(slab.skin_gap_mm.toFixed(1))
    : st === "below" ? L.skinBelow(slab.skin_gap_mm.toFixed(1))
    : st === "none" ? L.skinNone : "";
  b.hidden = !text; b.textContent = text;
}
function paintMeta() {
  const L = S();
  const sp = slab.spacing_mm || [0, 0, 0];
  const mm = sp.map(x => (x * BOX).toFixed(1)).join(" × ") + " mm";
  /* Un second lecteur ne voit que les dalles deja lues par l'auteur. */
  const n = isSecond() && queue.length ? queue.filter(q => !byId.get(q)?.tutorial).length : COH.slabs.filter(x => !x.tutorial).length;
  const pos = practice ? practiceIdx + 1 : Math.min((revisiting() ? hi : history.length) + 1, n);
  const tot = practice ? practiceList.length : n;
  $("m-slab").replaceChildren();
  const b = document.createElement("b"); b.textContent = answerId() + (slab.window_of ? " \u2197" : "");
  $("m-slab").append(b, document.createTextNode(
    " · " + L.slabFmt(pos, tot, slab.voxels_sampled, mm)));
  $("h-3d").textContent = L.h3d;
  $("h-mip").textContent = L.hmip;
  $("h-zoom").textContent = "×" + zoom.toFixed(1);
}
function setSaving(on) { $("m-save").classList.toggle("busy", on); }
/* Hors base partagee, ce qui n'a pas ete exporte n'existe que dans ce
   navigateur. Le compte est garde par lecteur : un export contient toujours
   toutes les reponses, donc seul le nombre au dernier export compte. */
function exportedKey() { return `hcr:${reader.id}:exported`; }
function unexportedCount() {
  let done = 0;
  try { done = +(localStorage.getItem(exportedKey()) || 0); } catch {}
  return Math.max(0, Object.keys(mine).length - done);
}
function markExported() {
  try { localStorage.setItem(exportedKey(), String(Object.keys(mine).length)); } catch {}
  paintSave();
}
function paintSave() {
  const el = $("m-save"), L = S();
  const local = store.mode !== "shared";
  el.classList.toggle("local", local);
  const pending = local && reader ? unexportedCount() : 0;
  $("m-save-txt").textContent = local
    ? L.savedLocal + (pending ? " · " + L.unexported(pending) : "")
    : L.savedShared;
  el.style.cursor = local ? "pointer" : "";
  el.title = local
    ? (store.lastError ? L.saveErr(store.lastError) : L.saveTipLocal)
    : L.saveTipShared;
}

/* Empreinte d'une reponse : ce qui compte pour decider si le lecteur a change
   quelque chose. L'horodatage, le temps passe et le reglage d'affichage n'en
   font pas partie — les comparer rendrait « modifie » toute dalle revisitee. */
function answerKey(v) {
  if (!v) return "";
  return JSON.stringify([
    v.nature || null, !!v.doubt, v.choice || null, v.several || null, v.outline || null, v.stage || null,
    [...(v.bucket_seeds || [])].sort((a, b) => a - b),
    [...(v.support || [])].sort(),
    (v.parts || []).map(p => [p.nature || null, !!p.doubt]),
    v.added_index || [], v.removed_index || [], v.cut_index || [], v.filled_index || [],
  ]);
}
function revisiting() { return !practice && hi < history.length; }
function changed() {
  if (!draft) return false;
  captureEdits(draft);
  return answerKey(draft) !== answerKey(mine[answerId()]);
}

async function goTo(id) {
  if (!id) { openDone(); return; }
  await openSlab(id, false);
}
/* Le brouillon de la dalle quittee est garde en memoire tant qu'il n'est pas
   confirme : revenir dessus rend le travail la ou on l'a laisse. */
function parkDraft() {
  if (slabBusy() || !draft || !slab || isPicker()) return;
  if (draft.slab_id && draft.slab_id !== answerId()) return;
  captureEdits(draft);
  if (!mine[answerId()] || changed()) drafts[answerId()] = draft;
  else delete drafts[answerId()];
}

/* Combler passe de lui-meme a la confirmation, pour le lecteur qui l'aurait
   oublie, et seulement quand il a declare le contour a corriger. Les voxels
   poses gardent leur etat propre (filled_index) : on peut les retirer a
   l'analyse. */
function autoFill() {
  const sup = (draft && draft.support) || [];
  if (!sup.includes("incorrect") && !sup.includes("merged")) return;
  fillGaps();
}
/* Une action a la fois : confirmer, reculer, avancer. Un deuxieme clic arrive
   avant que la premiere action ait fini d'enregistrer ; sans verrou, il la
   rejouait (dalles d'exercice sautees). */
let acting = false;
const oneAtATime = f => async (...a) => {
  if (acting || slabBusy()) return;
  acting = true;
  try { return await f(...a); } finally { acting = false; }
};
const confirmAnswer = oneAtATime(confirmAnswerNow);
async function confirmAnswerNow() {
  if (draft && draft.slab_id && draft.slab_id !== answerId()) return;
  if (isSecond()) return secConfirm();
  if (isSecondTrace()) return sec2Confirm();
  if (practice) {
    if (!isPicker() && needsBridge()) return;
    if (!isPicker()) await savePractice();
    await practiceStep(1); return;
  }
  if (!verdictComplete()) return;
  autoFill();
  if (!verdictComplete()) return;
  if (isTrace()) { saveParts(); draft.nature = parts.length ? null : "none"; }
  const id = answerId();
  const first = !mine[id];
  if (!first && !changed() && !draft.needs_nature) return;
  delete draft.needs_nature;
  stamp(draft);
  const now = new Date().toISOString();
  if (first) { draft.confirmed_at = now; draft.revisions = 0; }
  else {
    draft.confirmed_at = mine[id].confirmed_at || mine[id].at || now;
    draft.seconds = mine[id].seconds;
    draft.revisions = (mine[id].revisions || 0) + 1;
    draft.revised_at = now;
  }
  await store.put(id, draft);
  delete drafts[id];
  if (first) {
    refreshPeers();
    counts[id] = (counts[id] || 0) + 1;
    history.push(id);
    hi = history.length;
    frontierId = nextFrontier();
    await goTo(frontierId);
    paintSave();
    /* Toutes les 20 reponses non exportees, la page propose l'export, sans
       jamais bloquer la lecture : un lecteur exterieur qui s'arrete en cours
       de route a deja un fichier a envoyer. */
    const pending = store.mode !== "shared" ? unexportedCount() : 0;
    if (isStep1() && doneCount() >= GOAL && !reader.step2Offered) offerStep2();
    else if (pending && pending % 20 === 0)
      askConfirm(S().exportNudge(pending), () => exportAnswers(null), S().exportNow);
  } else {
    const todo = toComplete();
    if (todo.length) { hi = history.indexOf(todo[0]); await goTo(todo[0]); return; }
    if (fixing) { fixing = false; hi = history.length; await goTo(frontierId); return; }
    hi += 1;
    await goTo(hi < history.length ? history[hi] : frontierId);
  }
}
/* Revue des tuiles lues avant les regles du 8 octobre (COH.revue) : pour
   l'auteur, une rangee de boutons qui rouvrent chaque tuile comme « Precedent ».
   Une tuile revisee depuis COH.revue_depuis porte une coche. */
function paintRevue() {
  let box = $("revue");
  const ids = (COH && COH.revue) || [];
  const on = ids.length && !practice && slab && reader && person(reader.id) === AUTHOR;
  if (!on) { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "revue"; box.className = "winnav"; box.style.margin = "4px 0 8px";
    $("w-confirm").parentNode.insertBefore(box, $("w-confirm"));
  }
  box.hidden = false;
  const cap = document.createElement("span");
  cap.className = "cap"; cap.style.width = "100%"; cap.textContent = COH.revue_titre || "Review";
  const since = COH.revue_depuis || "";
  box.replaceChildren(cap, ...ids.map(id => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip";
    b.textContent = id.replace(/^T/, "") + (mine[id] && (mine[id].revised_at || "") >= since ? " \u2713" : "");
    b.setAttribute("aria-pressed", String(answerId() === id));
    b.onclick = () => openRevue(id);
    return b;
  }));
}
async function openRevue(id) {
  if (!mine[id] || !history.includes(id) || answerId() === id) return;
  parkDraft(); hi = history.indexOf(id); await goTo(id);
}
/* Reponses a completer (ancien « unsure ») : on y passe avant la frontiere. */
let fixing = false;
const toComplete = () => history.filter(id => mine[id] && mine[id].needs_nature);
const goBack = oneAtATime(goBackNow);
async function goBackNow() {
  if (practice) { if (!isPicker()) { await savePractice(); parkDraft(); } await practiceStep(-1); return; }
  if (hi === 0) return;
  parkDraft();
  hi -= 1;
  await goTo(history[hi]);
}
/* Suivant ne fait que se deplacer dans ce qui a deja ete juge. S'il reste une
   modification non enregistree, on le dit avant de la jeter. */
const goForward = oneAtATime(goForwardNow);
async function goForwardNow() {
  if (practice) { if (!isPicker()) { await savePractice(); parkDraft(); } await practiceStep(1); return; }
  if (!revisiting()) return;
  const move = async () => {
    drafts[answerId()] = undefined; delete drafts[answerId()];
    hi += 1;
    await goTo(hi < history.length ? history[hi] : frontierId);
  };
  if (changed()) askConfirm(S().discardChange, move, S().discard);
  else await move();
}
/* Les reponses d'exercice sont gardees, marquees `practice` : elles ne comptent
   ni dans la progression ni dans l'ordre de service, et l'analyse decide de
   leur sort. Une reponse incomplete n'est pas enregistree — l'exercice se
   laisse parcourir sans repondre. */
async function savePractice() {
  if (slabBusy() || !draft || !verdictComplete()) return;
  if (draft.slab_id && draft.slab_id !== answerId()) return;
  autoFill();
  if (!verdictComplete()) return;
  if (isTrace()) { saveParts(); draft.nature = parts.length ? null : "none"; }
  const id = answerId(), prev = mine[id];
  if (prev && !changed() && !draft.needs_nature) return;
  delete draft.needs_nature;
  stamp(draft);
  draft.practice = true;
  const now = new Date().toISOString();
  draft.confirmed_at = (prev && prev.confirmed_at) || now;
  draft.revisions = prev ? (prev.revisions || 0) + 1 : 0;
  if (prev) draft.revised_at = now;
  await store.put(id, draft);
  delete drafts[id];
  paintSave();
}
async function practiceStep(dir) {
  practiceIdx += dir;
  if (isPicker()) practiceIdx = Math.max(0, Math.min(practiceList.length - 1, practiceIdx));
  if (practiceIdx >= practiceList.length) { finishPractice(); return; }
  if (practiceIdx < 0) practiceIdx = 0;
  await openSlab(practiceList[practiceIdx], true);
}

/* ===========================================================================
   Demarche — la liste des etapes, rappelee a cote de la vue
   ---------------------------------------------------------------------------
   Les coches sont un aide-memoire, pas une donnee : elles repartent de zero a
   chaque dalle et ne sont ni enregistrees ni exportees. Ouvert ou ferme, le
   panneau se souvient de l'etat choisi par le lecteur.
   ======================================================================== */
let todoDone = new Set();
function paintTodo() {
  const list = $("todo-body"), steps = S().todo;
  list.replaceChildren();
  steps.forEach((html, i) => {
    const li = document.createElement("li");
    li.className = todoDone.has(i) ? "done" : "";
    const span = document.createElement("span");
    span.innerHTML = html;          /* libelles statiques, jamais de donnee lecteur */
    li.appendChild(span);
    li.onclick = () => { todoDone.has(i) ? todoDone.delete(i) : todoDone.add(i); paintTodo(); };
    list.appendChild(li);
  });
  $("todo-count").textContent = `${todoDone.size}/${steps.length}`;
}
function setTodoOpen(open) {
  $("todo").dataset.open = String(open);
  $("todo-tab").setAttribute("aria-expanded", String(open));
  try { localStorage.setItem("hcr:todo", open ? "1" : "0"); } catch {}
}
$("todo-tab").onclick = () => setTodoOpen($("todo").dataset.open !== "true");

/* ===========================================================================
   Mode selection — un vivier d'illustrations que l'auteur parcourt et trie
   ---------------------------------------------------------------------------
   Active par le seul manifeste (`picker: true`). Rien n'est ecrit dans la base :
   les choix restent dans ce navigateur, et « Copier » les rend en JSON.
   ======================================================================== */
const isPicker = () => !!(COH && COH.picker);
function picks() {
  try { return JSON.parse(localStorage.getItem("hcr:picks") || "{}"); } catch { return {}; }
}
function savePicks(p) { try { localStorage.setItem("hcr:picks", JSON.stringify(p)); } catch {} }
function buildPickList() {
  const sel = $("pk-list"), p = picks();
  sel.replaceChildren();
  let group = null, og = null;
  COH.slabs.forEach((s, i) => {
    if (s.family !== group) {
      og = document.createElement("optgroup"); og.label = s.family; sel.appendChild(og); group = s.family;
    }
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${p[s.slab_id]?.use ? "★ " : ""}${s.slab_id}${s.in_cohort ? "  (in cohort)" : ""}`;
    og.appendChild(o);
  });
  const n = Object.values(p).filter(x => x.use).length;
  $("pk-count").textContent = `${n} picked`;
}
function paintPicker() {
  if (!isPicker() || !slab) return;
  const p = picks()[slab.slab_id] || {};
  $("pk-list").value = String(practiceIdx);
  $("pk-use").setAttribute("aria-pressed", String(!!p.use));
  $("pk-note").value = p.note || "";
  const info = $("pk-info");
  info.replaceChildren();
  const b = document.createElement("b"); b.textContent = slab.slab_id;
  info.append(b, document.createTextNode(
    ` · ${slab.family} · rule: ${slab.rule_decision} · ${slab.relation} · ×${slab.factor}`));
  if (slab.in_cohort) {
    const w = document.createElement("span"); w.className = "warn";
    w.textContent = " · in the measured cohort — picking it removes it from the measurement";
    info.append(w);
  }
  $("m-practice").textContent = slab.family;
}
/* En mode selection, l'auteur peut juger et corriger une dalle comme un
   lecteur : sa reponse est gardee avec ses choix et part dans « Copier ». C'est
   ainsi qu'une composante corrigee par lui sert a la fois d'illustration et de
   verite de terrain signee de sa seule main. */
function pickerPersist() {
  if (!isPicker() || !draft || !slab) return;
  captureEdits(draft);
  const p = picks();
  p[slab.slab_id] = { ...(p[slab.slab_id] || {}), answer: JSON.parse(JSON.stringify(draft)),
                      family: slab.family, in_cohort: !!slab.in_cohort };
  savePicks(p);
}
const answered = v => !!(v && (v.nature || (v.parts || []).some(x => x.nature) ||
  (v.added_index || []).length || (v.removed_index || []).length || (v.cut_index || []).length));
function setPick(patch) {
  const p = picks();
  p[slab.slab_id] = { ...(p[slab.slab_id] || {}), ...patch, family: slab.family, in_cohort: !!slab.in_cohort };
  savePicks(p); buildPickList(); paintPicker();
}
async function startPicker() {
  reader = { id: "picker", startedAt: new Date().toISOString(), tutorialDone: true };
  mine = {};
  practiceList = COH.slabs.map(s => s.slab_id);
  practiceIdx = 0;
  $("todo").hidden = true;
  $("picker").hidden = false;
  $("w-confirm").hidden = true;        /* Precedent / Suivant suffisent ici */
  buildPickList();
  show("work");
  await openSlab(practiceList[0], true);
}
$("pk-list").onchange = async () => {
  practiceIdx = +$("pk-list").value;
  await openSlab(practiceList[practiceIdx], true);
};
$("pk-use").onclick = () => setPick({ use: $("pk-use").getAttribute("aria-pressed") !== "true" });
$("pk-note").addEventListener("change", () => setPick({ note: $("pk-note").value.trim() }));
$("pk-copy").onclick = async () => {
  pickerPersist();
  const out = Object.entries(picks()).filter(([, v]) => v.use || v.note || answered(v.answer))
    .map(([id, v]) => ({ slab_id: id, ...v }));
  const text = JSON.stringify(out, null, 1);
  /* Le texte s'affiche d'abord : un presse-papier refuse ou qui ne repond pas
     ne doit jamais laisser l'auteur sans rien. */
  $("pk-dump").hidden = false; $("pk-dump").textContent = text;
  const ok = await copyText(text);
  $("pk-copy").textContent = ok ? "Copied" : "Copy the text below";
  setTimeout(() => { $("pk-copy").textContent = "Copy my picks"; }, 2200);
};

/* ===========================================================================
   Session, menu, export
   ======================================================================== */
function sessionStats() {
  const times = Object.values(mine).map(v => v.seconds).filter(x => x > 0).sort((a, b) => a - b);
  const median = times.length ? times[times.length >> 1] : 0;
  const elapsed = Math.round((Date.now() - Date.parse(reader.startedAt)) / 60000);
  return { read: doneCount(), anchors: anchorsDone(), median, elapsed };
}
function fillStats(el) {
  const L = S(), st = sessionStats();
  el.replaceChildren();
  const rows = [
    [L.mnReader, reader.id],
    [L.mnRead, String(st.read)],
    ...(isStep1() ? [[L.mnAnchors, `${st.anchors} / ${COH.slabs.filter(s => s.anchor).length}`]] : []),
    [L.mnStorage, store.mode === "shared" ? L.savedShared : L.savedLocal],
    [L.mnElapsed, st.elapsed + " min"],
    [L.mnPace, st.median ? st.median + " s" : L.none],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    el.append(dt, dd);
  }
}
/* Hors de la base partagee (lecteur exterieur a l'organisation, ou base
   injoignable), les reponses ne vivent que dans ce navigateur : le menu et
   l'ecran de fin le disent en toutes lettres, pas dans une infobulle. */
function paintSendNotes() {
  const L = S(), local = store.mode !== "shared";
  $("mn-note").textContent = local ? L.localLede : L.mnNote;
  $("dn-lede").textContent = local ? L.localLede : L.dnLede;
  $("dn-note").hidden = true;
}
function openMenu() {
  fillStats($("mn-stats"));
  paintSendNotes();
  const s2 = isStep1() && doneCount() >= GOAL;
  paintStep2($("mn-step2"), s2);
  $("mn-resume").classList.toggle("primary", !s2);
  show("menu");
  (async () => {
    const owner = await (store.user?.isOwner?.() ?? false);
    $("mn-owner").hidden = !owner;
  })().catch(() => {});
}
function openDone() {
  fillStats($("dn-stats"));
  paintSendNotes();
  paintStep2($("dn-step2"), isStep1());
  $("dn-export").classList.toggle("primary", !isStep1());
  /* Recherche : chaque lecteur a une page attribuee, mais toute page sert ses
     propres tuiles. Celui qui a fini la sienne se voit proposer les deux autres
     (13 oct. : deux volontaires bloques apres les 90 tuiles de la page 1). */
  const autres = isTrace() && !isPicker() && !isTileReview() && !frontierId
    ? PAGES.search.map((u, k) => [u, k + 1]).filter(([, n]) => n !== (COH.page || 1)) : [];
  const more = $("dn-more");
  more.replaceChildren();
  for (const [u, n] of autres) {
    const a = document.createElement("a");
    a.className = "act"; a.target = "_blank"; a.rel = "noopener";
    a.href = u + (reader ? `#rid-${reader.id}` : "");
    a.textContent = S().dnMorePage(n);
    more.appendChild(a);
  }
  more.hidden = !autres.length;
  $("dn-more-note").hidden = !autres.length;
  $("dn-more-note").textContent = autres.length ? S().dnMoreNote : "";
  show("done");
}

function exportPayload() {
  return {
    contract: "photoacoustic-annotation-answers.v1",
    reader_id: reader.id,
    started_at: reader.startedAt,
    step1: reader.step1 || null,
    exported_at: new Date().toISOString(),
    cohort_seed: COH.seed,
    cohort_built_at: COH.built_at,
    box: BOX,
    /* Les index sont lineaires dans la grille d'AFFICHAGE de la dalle. Le voxel
       natif se retrouve par origin_xyz + (x, y, z) * step_xyz, tous deux donnes
       par la cohorte pour cette dalle. Sans cette phrase, la liste de voxels
       serait ininterpretable dans six mois. */
    index_convention: "i = (z * box + y) * box + x, display grid; native = origin_xyz + (x,y,z) * step_xyz",
    storage_mode: store.mode,
    lang,
    answers: Object.values(mine),
  };
}
/* Presse-papier borne dans le temps : sans geste de l'utilisateur, ou avec une
   permission en suspens, `writeText` peut ne jamais repondre. */
function copyText(text, ms = 1500) {
  const attempt = (async () => {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  })();
  return Promise.race([attempt, new Promise(r => setTimeout(() => r(false), ms))]);
}
/* Le bac a sable du lecteur rend inerte tout telechargement lance par la page :
   un lien `download`, meme vers un blob, ne fait rien. La seule voie est la
   capacite `downloads`, et a defaut le presse-papier, et a defaut le texte a
   l'ecran. On descend les trois marches sans jamais laisser le lecteur devant
   un bouton qui ne produit rien. */
async function exportAnswers(button) {
  const L = S();
  const text = JSON.stringify(exportPayload(), null, 1);
  const name = `hcr_${reader.id}_${new Date().toISOString().slice(0, 10)}.json`;
  /* Sans bouton (export propose par la page), le retour s'affiche dans le temoin. */
  const say = m => {
    if (!button) { $("m-save-txt").textContent = m; setTimeout(paintSave, 2200); return; }
    button.textContent = m; setTimeout(() => { button.textContent = L.mnExport; }, 2200);
  };
  if (store.downloads) {
    try { await store.downloads.save({ filename: name, data: text }); markExported(); say(L.expOk); return; }
    catch { /* refus du lecteur ou capacite indisponible : on descend d'une marche */ }
  }
  /* Page autonome : un telechargement de fichier ordinaire. */
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    markExported(); say(L.expOk); return;
  } catch { /* navigateur sans telechargement : presse-papier */ }
  if (await copyText(text)) { markExported(); say(L.expCopied); return; }
  const pre = $("mn-dump");
  pre.hidden = false; pre.textContent = text;
  say(L.expFail);
}

/* Sauvegarde brute de la base, pour le proprietaire : chaque document tel qu'il
   est stocke, de quoi tout rebatir ailleurs si ce compte venait a manquer.
   Rien ne s'affiche, et il n'y a pas de repli vers l'ecran : l'auteur ne doit
   pas voir les reponses des volontaires avant d'avoir fini les siennes. */
const BACKUP_KEY = "hcr:backup";
const pageName = () => isTrace() ? `search${COH.page || 1}` : "annotator";
async function backupAll(button) {
  const L = S();
  const say = m => { button.textContent = m; setTimeout(() => { button.textContent = L.mnBackup; }, 2600); };
  if (!store.db || !store.downloads) { say(L.backupFail); return; }
  button.disabled = true;
  try {
    const collections = {};
    for (const name of ["readers", "verdicts", "edits"]) {
      const snap = await store.db.collection(name).get();
      collections[name] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    }
    const at = new Date().toISOString();
    const text = JSON.stringify({ saved_at: at, page: pageName(), cohort_seed: COH.seed,
      cohort_built_at: COH.built_at, collections });
    await store.downloads.save({ filename: `backup_${pageName()}_${at.slice(0, 16).replace(":", "")}.json`, data: text });
    try { localStorage.setItem(BACKUP_KEY, at); } catch {}
    paintBackup();
    say(L.backupOk);
  } catch { say(L.backupFail); }
  button.disabled = false;
}
function paintBackup() {
  let at = null;
  try { at = localStorage.getItem(BACKUP_KEY); } catch {}
  $("mn-backup-at").textContent = S().backupLast(at ? at.slice(0, 10) : null);
}

/* ===========================================================================
   Langue
   ======================================================================== */
function applyLang() {
  const L = S();
  document.documentElement.lang = lang === "ja" ? "ja" : "en";
  for (const id of ["lang-en", "g-lang-en", "t-lang-en"])
    $(id)?.setAttribute("aria-pressed", String(lang === "en"));
  for (const id of ["lang-ja", "g-lang-ja", "t-lang-ja"])
    $(id)?.setAttribute("aria-pressed", String(lang === "ja"));
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };

  /* Accueil de l'etape 1 : la consigne des seconds lecteurs, qui sont la plupart des visiteurs. */
  const secondGate = secondOn() && isStep1() && SECOND_STR && !(reader && (person(reader.id) === AUTHOR || isFullReader()));
  set("g-title", L.gTitle); set("g-lede", secondGate ? SECOND_STR[lang].gLede : L.gLede); set("g-label", L.gLabel);
  set("g-modes-cap", L.gModesCap); set("g-modes-note", L.gModesNote);
  set("g-mode-review-t", L.gModeReview); set("g-mode-review-d", L.gModeReviewD);
  set("g-mode-search-t", L.gModeSearch); set("g-mode-search-d", L.gModeSearchD);
  paintModes();
  $("dp-up").title = L.trUp; $("dp-down").title = L.trDown; $("dp-left").title = L.trLeft;
  $("dp-right").title = L.trRight; $("dp-home").title = L.trHome;
  set("g-hint", L.gHint); set("g-start", L.gStart); set("g-skip", L.gSkip);
  set("tu-title", L.tuTitle); set("tu-quit", L.tuQuit);
  set("tu-prev", L.tuPrev); set("tu-next", L.tuNext);
  set("w-title", L.wTitle); set("t-tag3d", L.tag3d); set("t-tagmip", L.tagmip);
  set("t-h-nature", L.hNature); set("t-h-support", L.hSupport);
  set("t-h-progress", L.hProgress); set("t-h-display", L.hDisplay);
  set("ov-on", L.showShape); set("ov-off", L.hideShape);
  set("rd-alpha", L.rdAlpha); set("rd-cloud", L.rdCloud); set("rd-blocks", L.rdBlocks);
  $("ov-on").title = L.tipShow; $("ov-off").title = L.tipHide;
  $("rd-alpha").title = L.tipAlpha; $("rd-cloud").title = L.tipCloud; $("rd-blocks").title = L.tipBlocks;
  $("sk-on").title = L.tipSkin; $("nb-on").title = L.tipOthers;
  set("t-floor", L.floor); set("t-ceil", L.ceil); set("t-gamma", L.gamma);
  set("t-opacity", L.opacity); set("reset", L.reset);
  set("t-h-edit", L.hEdit); set("tl-b1", L.b1); set("tl-b7", L.b7); set("tl-del", L.del_);
  set("t-added", L.added); set("undo", L.undo); set("clear", L.clear);
  set("tl-fill", L.bucket); set("fillgaps", L.fillGaps);
  set("t-h-split", L.hSplit); set("ct-1", L.cut1); set("ct-7", L.cut7);
  set("undo-s", L.undo); set("clear-s", L.clear); set("t-partcount", L.partCount);
  set("t-edithelp", tut().editHelp[lang]); set("t-splithelp", tut().splitHelp[lang]);
  set("tl-trace", L.trTool); set("newhair", L.trNewHair); paintTraceState();
  set("t-note", L.note);
  set("modal-cancel", L.cancel); set("modal-ok", L.discard);
  set("w-help", L.tutorialBtn);
  set("cap-shape", L.capShape); set("cap-render", L.capRender); set("cap-context", L.capContext);
  set("sk-lbl", L.skin); set("nb-lbl", L.others); set("t-keys", L.keysHint);
  set("todo-title", L.todoTitle);
  paintTodo();
  set("mn-title", L.mnTitle); set("mn-resume", L.mnResume); set("mn-tutorial", L.mnTutorial);
  set("mn-export", L.mnExport); set("mn-finish", L.mnFinish); set("mn-note", L.mnNote);
  set("mn-owner-h", L.mnOwnerH); set("mn-owner-note", L.mnOwnerNote); set("mn-collect", L.mnCollect);
  set("mn-backup", L.mnBackup); paintBackup();
  set("dn-title", L.dnTitle); set("dn-lede", L.dnLede); set("dn-export", L.mnExport);
  set("dn-back", L.dnBack); set("dn-note", L.dnNote);
  if (store && reader) paintSendNotes();
  checkDeviation(); paintSave();
  if (slab) { paintMeta(); buildOpts(); paintProgress(); paintSkinBadge(); }
  if (!$("tutorial").hidden) paintTutorial();
  if (!$("menu").hidden) fillStats($("mn-stats"));
}
function setLang(l) { lang = l; try { localStorage.setItem("hcr:lang", l); } catch {} applyLang(); }

/* ===========================================================================
   Tutoriel
   ======================================================================== */
let tuStep = 0;
/* D'ou le tutoriel a ete ouvert. Le quitter doit ramener le lecteur exactement
   ou il etait : le renvoyer au debut de la file lui ferait perdre sa place, et
   c'est ce qui est arrive la premiere fois. */
let tuFrom = "gate";
function paintTutorial() {
  const steps = tut().steps;
  const st = steps[tuStep];
  const L = S();
  $("tu-step").textContent = L.tuStep(tuStep + 1, steps.length);
  $("tu-h").textContent = st.h[lang];
  $("tu-p").innerHTML = st.body[lang];
  const fig = $("tu-figure");
  fig.innerHTML = st.figure(lang);
  /* Disposition de la figure selon ce qu'elle contient : un schema seul, ou un
     schema et n images reelles (voir .lay-n dans la feuille de style). */
  const nReal = fig.querySelectorAll(".fig-grid figure").length;
  /* 3 images : schema au-dessus, images en rangee (l'auteur prefere cette forme). */
  const side = nReal === 2 || nReal === 4;
  fig.className = "tut-figure" + (fig.querySelector(":scope > svg") && side ? " lay-" + nReal : "");
  $("tu-check").hidden = !st.note;
  if (st.note) $("tu-check").textContent = st.note[lang];
  const dots = $("tu-dots");
  dots.replaceChildren();
  steps.forEach((_, i) => {
    const d = document.createElement("i");
    d.className = i === tuStep ? "on" : (i < tuStep ? "done" : "");
    dots.appendChild(d);
  });
  $("tu-prev").disabled = tuStep === 0;
  $("tu-next").textContent = tuStep < steps.length - 1 ? L.tuNext
    : (tuFrom === "work" ? L.mnResume : COH.slabs.some(s => s.tutorial) ? L.tuStartPractice : L.tuFinish);
}
function openTutorial() {
  tuFrom = $("work").hidden ? "gate" : "work";
  tuStep = 0; paintTutorial(); show("tutorial");
}
function leaveTutorial() {
  if (tuFrom === "work") { show("work"); return; }
  reader.tutorialDone = true; saveReader(); startPractice();
}

/* Dalles d'exercice : un passage oblige, mais une seule fois chacune (demande de
   l'auteur, 12 oct.). On ne sert que celles que le lecteur n'a pas terminees :
   relancer le tutoriel ne ramene pas aux premieres, et sauter le tutoriel ne
   saute pas les exercices restants. Seconde lecture : terminee = etape « done ». */
const practiceDone = id => { const v = mine[id]; return !!v && (!v.stage || v.stage === "done"); };
async function startPractice() {
  applyLang();                  /* textes du mode du lecteur */
  /* les exercices faits sur un autre appareil ne sont connus qu'une fois la base lue */
  await Promise.race([storeReady, new Promise(r => setTimeout(r, 8000))]);
  practiceList = COH.slabs.filter(s => s.tutorial).map(s => s.slab_id).filter(id => !practiceDone(id));
  if (!practiceList.length) { await startWork(); return; }
  practiceIdx = 0;
  show("work");
  await openSlab(practiceList[0], true);
}
function finishPractice() {
  /* Les reponses d'exercice restent dans `mine` (marquees) ; seuls les
     brouillons non confirmes disparaissent. La progression ne les compte pas. */
  for (const s of practiceList) delete drafts[s];
  practice = false;
  reader.tutorialDone = true;
  saveReader();
  startWork();
}
async function startWork() {
  practice = false;
  applyLang();                  /* textes du mode du lecteur (seconde lecture, lecteur complet) */
  /* La file d'un second lecteur depend de ce que l'auteur a lu : on attend la base. */
  if (isSecond() || isSecondTrace()) await Promise.race([storeReady, new Promise(r => setTimeout(r, 8000))]);
  buildQueue();
  rebuildHistory();
  frontierId = nextFrontier();
  show("work");
  if (openWanted && mine[openWanted] && history.includes(openWanted)) {
    const id = openWanted; openWanted = null;
    hi = history.indexOf(id); await openSlab(id, false); return;
  }
  const todo = toComplete();
  if (todo.length) { fixing = true; hi = history.indexOf(todo[0]); await openSlab(todo[0], false); return; }
  const revue = ((COH && COH.revue) || []).filter(id => mine[id] && history.includes(id));
  if (!frontierId && revue.length && reader && person(reader.id) === AUTHOR) {
    hi = history.indexOf(revue[0]); await openSlab(revue[0], false); return;
  }
  if (!frontierId) { openDone(); return; }
  await openSlab(frontierId, false);
}

/* ===========================================================================
   Controles
   ======================================================================== */
function checkDeviation() {
  deviated = +F.value !== PRESET.floor || +C.value !== PRESET.ceil ||
             +G.value !== PRESET.gamma || +O.value !== PRESET.opacity;
  const w = $("t-warn");
  w.hidden = !deviated;
  w.textContent = deviated ? S().warn : "";
}
function bind(el, out, fmt, after) {
  const run = () => { out.textContent = fmt(+el.value); checkDeviation(); after(); };
  el.addEventListener("input", run); run();
}
bind(F, $("o-floor"), v => v, () => { drawGL(); drawMIP(); });
bind(C, $("o-ceil"), v => v, () => { drawGL(); drawMIP(); });
bind(G, $("o-gamma"), v => (v / 100).toFixed(1), () => { drawGL(); drawMIP(); });
bind(O, $("o-opacity"), v => (v / 100).toFixed(2).slice(1), drawGL);
document.querySelector(".midcol details")?.addEventListener("toggle", () => {
  fitMipFrame(); drawMIP();
});
$("reset").onclick = () => {
  F.value = PRESET.floor; C.value = PRESET.ceil; G.value = PRESET.gamma; O.value = PRESET.opacity;
  for (const el of [F, C, G, O]) el.dispatchEvent(new Event("input"));
};
function setOverlay(v) {
  overlay = v;
  $("ov-on").setAttribute("aria-pressed", String(v));
  $("ov-off").setAttribute("aria-pressed", String(!v));
  /* Mode trace : masquer le trace pour revoir le signal nu, en 3D et en projection. */
  if (isTrace() && edit) { syncAlpha(); upload(); }
  drawGL(); drawMIP();
}
function setSkin(v) { skinOn = v; $("sk-on").setAttribute("aria-pressed", String(v)); drawGL(); }
function setOthers(v) { othersOn = v; $("nb-on").setAttribute("aria-pressed", String(v)); drawGL(); drawMIP(); }
function setRender(k) {
  render = k;
  for (const r of RENDERS) $("rd-" + r).setAttribute("aria-pressed", String(k === r));
  drawGL();
}
$("ov-on").onclick = () => setOverlay(true);
$("ov-off").onclick = () => setOverlay(false);
$("sk-on").onclick = () => setSkin(!skinOn);
$("nb-on").onclick = () => setOthers(!othersOn);
for (const r of RENDERS) $("rd-" + r).onclick = () => setRender(r);
for (const id of ["lang-en", "g-lang-en", "t-lang-en"]) $(id).onclick = () => setLang("en");
for (const id of ["lang-ja", "g-lang-ja", "t-lang-ja"]) $(id).onclick = () => setLang("ja");
$("ct-1").onclick = () => setTool("c1");
$("ct-7").onclick = () => setTool("c7");
$("tl-b1").onclick = () => setTool("b1");
$("tl-b7").onclick = () => setTool("b7");
$("tl-del").onclick = () => setTool("del");
$("tl-fill").onclick = () => setTool("fill");
$("tl-trace").onclick = () => setTool("trace");
$("dp-up").onclick = () => moveWindow(0, 1);
$("dp-down").onclick = () => moveWindow(0, -1);
$("dp-left").onclick = () => moveWindow(-1, 0);
$("dp-right").onclick = () => moveWindow(1, 0);
$("dp-home").onclick = () => { if (halo) { const b = byId.get(halo.tile); openWindow(...b.window_xy); } };
$("newhair").onclick = () => endHair();
$("fillgaps").onclick = fillGaps;
$("undo").onclick = undoEdit;
$("clear").onclick = clearEdits;
$("undo-s").onclick = undoEdit;
$("clear-s").onclick = clearCuts;
$("w-confirm").onclick = confirmAnswer;
$("w-back").onclick = goBack;
$("w-fwd").onclick = goForward;
$("w-menu").onclick = openMenu;
$("mn-resume").onclick = () => show("work");
$("mn-tutorial").onclick = openTutorial;
$("mn-export").onclick = e => exportAnswers(e.currentTarget);
$("mn-finish").onclick = async () => {
  if (store.mode !== "shared" && unexportedCount()) await exportAnswers(null);
  openDone();
};
$("m-save").onclick = () => { if (store.mode !== "shared" && reader) exportAnswers(null); };
$("dn-export").onclick = e => exportAnswers(e.currentTarget);
$("dn-back").onclick = () => show("work");
$("tu-quit").onclick = leaveTutorial;
$("w-help").onclick = openTutorial;
$("tu-prev").onclick = () => { if (tuStep > 0) { tuStep--; paintTutorial(); } };
$("tu-next").onclick = () => {
  if (tuStep < tut().steps.length - 1) { tuStep++; paintTutorial(); }
  else if (tuFrom === "work") show("work");
  else startPractice();
};
$("mn-backup").onclick = e => backupAll(e.currentTarget);
$("mn-collect").onclick = async e => {
  const b = e.currentTarget, pre = $("mn-dump");
  b.disabled = true;
  try {
    const rows = await store.collectAll();
    pre.hidden = false;
    pre.textContent = JSON.stringify({ collected_at: new Date().toISOString(),
      readers: [...new Set((rows || []).map(r => r.reader_id))],
      answers: rows }, null, 1);
  } catch (err) {
    pre.hidden = false; pre.textContent = String(err);
  }
  b.disabled = false;
};

/* ---- souris et clavier -------------------------------------------------- */
const editingNow = () => splitOn || !$("editor").hidden;
/* Un clic dont la souris bouge de quelques pixels reste un clic : la vue ne
   tourne qu'au-dela de DRAG_PX depuis l'appui (seuil de glisser des systemes,
   4 a 8 px). Sinon, poser ou retirer un voxel faisait tourner la vue. */
const DRAG_PX = 6;
cv.addEventListener("pointerdown", e => {
  if (startWinDrag(e, cv)) return;
  dragMoved = false;
  drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pan: e.shiftKey || e.button === 2 };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener("click", e => {
  if (!editingNow() || dragMoved) return;
  cutting() ? cutAt(e) : placeAt(e);
});
cv.addEventListener("contextmenu", e => {
  e.preventDefault();
  if (!editingNow() || dragMoved) return;
  cutting() ? cutAt(e) : placeAt(e);
});
function updateFace(e) {
  if (!editingNow() || drag) { if (face) { face = null; drawGL(); } return; }
  const pick = pickPlacement(e);
  if (!pick || !pick.place) { if (face) { face = null; drawGL(); } return; }
  const cell = cutting() ? pick.hit : pick.place;
  const other = cutting() ? pick.place : pick.hit;
  const dir = [other[0] - cell[0], other[1] - cell[1], other[2] - cell[2]];
  if (face && face.cell.every((v, i) => v === cell[i]) && face.dir.every((v, i) => v === dir[i])) return;
  face = { cell, dir };
  drawGL();
}
cv.addEventListener("pointermove", updateFace);
cv.addEventListener("pointerleave", () => { if (face) { face = null; drawGL(); } });
cv.addEventListener("pointermove", e => {
  if (winDrag) { applyWinDrag(e); return; }
  if (!drag) return;
  if (!dragMoved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
  dragMoved = true;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (drag.pan) { panX -= dx * 0.004 / zoom; panY += dy * 0.004 / zoom; }
  else { yaw += dx * 0.009; pitch = Math.max(0, Math.min(Math.PI, pitch + dy * 0.009)); }
  drag.x = e.clientX; drag.y = e.clientY;
  drawGL();
});
for (const ev of ["pointerup", "pointercancel", "pointerleave"])
  cv.addEventListener(ev, () => { drag = null; if (ev !== "pointerleave") endWinDrag(); });
/* Le clic de molette ne doit pas declencher le defilement automatique du navigateur. */
for (const el of [cv, mc]) el.addEventListener("mousedown", e => { if (e.button === 1 && hasHalo()) e.preventDefault(); });
cv.addEventListener("wheel", e => {
  e.preventDefault();
  zoom = Math.max(0.6, Math.min(8, zoom * Math.exp(-e.deltaY * 0.0016)));
  $("h-zoom").textContent = "×" + zoom.toFixed(1);
  drawGL();
}, { passive: false });
mc.addEventListener("pointerdown", e => {
  if (startWinDrag(e, mc)) return;
  /* Etape 2, second lecteur : un clic pointe un poil (droit : retire le point le
     plus proche) ; Maj+clic ou clic hors de la fenetre deplace la vue. */
  if (isSecondTrace() && halo && slab) {
    const raw = mipCellRaw(e);
    if (!raw) return;
    e.preventDefault();
    const inside = raw.x >= 0 && raw.y >= 0 && raw.x < BOX && raw.y < BOX;
    if (e.shiftKey || !inside) { traceOutside(raw, true); return; }
    if (sec2Stage() !== "open") return;
    const [wx, wy] = winXY();
    if (e.button === 2) sec2RemoveNear(wx + raw.x, wy + raw.y); else sec2AddPoint(wx + raw.x, wy + raw.y);
    return;
  }
  /* Mode trace : Maj+clic deplace la vue la ou l'on clique, sans tracer ; un
     clic hors du carre la deplace aussi, et poursuit le poil s'il y en a un en
     cours. */
  if (hasHalo() && halo && e.button === 0 && (e.shiftKey || (isTrace() && tool === "trace" && !$("editor").hidden))) {
    const raw = mipCellRaw(e);
    const outside = raw && (raw.x < 0 || raw.y < 0 || raw.x >= BOX || raw.y >= BOX);
    if (raw && (e.shiftKey || outside)) { e.preventDefault(); traceOutside(raw, !isTrace() || e.shiftKey || traceLastH < 0); return; }
  }
  const action = mipAction();
  if (!action || !slab) return;
  e.preventDefault();
  mipStroke = { action, inverse: e.button === 2 || e.altKey, changes: [], seen: new Set() };
  mc.setPointerCapture(e.pointerId);
  applyMipStroke(e);
});
mc.addEventListener("pointermove", e => { if (winDrag) { applyWinDrag(e); return; } if (mipStroke) applyMipStroke(e); });
for (const ev of ["pointerup", "pointercancel"]) mc.addEventListener(ev, () => {
  if (endWinDrag()) return;
  if (!mipStroke) return;
  if (mipStroke.changes.length) {
    undoStack.push(mipStroke.changes);
    if (undoStack.length > 90) undoStack.shift();
  }
  mipStroke = null;
});
mc.addEventListener("contextmenu", e => { if (mipAction() || isSecondTrace()) e.preventDefault(); });
mc.addEventListener("wheel", e => {
  e.preventDefault();
  const zMin = mipView ? mipView.zMin : 1;
  mipZoom = Math.max(zMin, Math.min(8, mipZoom * Math.exp(-e.deltaY * 0.0016)));
  drawMIP();
}, { passive: false });

addEventListener("keydown", e => {
  if (e.target.matches("input, textarea")) return;
  if (!$("modal").hidden || !$("handoff").hidden) return;
  if (!$("gate").hidden) { if (e.key === "Enter") $("g-start").click(); return; }
  if (!$("tutorial").hidden) {
    if (e.key === "ArrowRight") { $("tu-next").click(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { $("tu-prev").click(); e.preventDefault(); }
    return;
  }
  if ($("work").hidden) return;
  const k = e.key.toLowerCase();
  if (isSecond() && k === "5") { secSeveral(); e.preventDefault(); return; }
  if (isSecondTrace() && /^[0-9]$/.test(k)) { if (k === "0") sec2ToggleNone(); e.preventDefault(); return; }
  const nat = (S().nature.find(n => n[3] === k) || [])[0];
  if (e.key === "Escape" && (isTrace() || ((isStep1() || isComplete()) && tool === "trace"))) { endHair(); e.preventDefault(); return; }
  if (isArbitrate() && (k === "0" || k === "a" || k === "b")) {
    showArbAnswer(k === "0" ? -1 : k.charCodeAt(0) - 97); e.preventDefault(); return;
  }
  const sup = isArbitrate() || isSecond() ? null
    : { q: "ok", w: "incorrect", e: isComplete() ? "skip" : "merged", ...(isComplete() ? { t: "merged" } : {}) }[k];
  if (nat && splitOn && (parts.length > 1 || isTrace()) && parts[selectedPart]) {
    parts[selectedPart].nature = nat; saveParts(); buildParts(); buildOpts(); paintProgress();
  }
  else if (nat) setVerdict("nature", nat);
  else if (k === "4") toggleDoubt();
  /* arbitrage : comme les boutons (Q ne rend pas la forme d'origine, voir buildOpts) */
  else if (sup) (isComplete() || isArbEdit()) ? enterMode(sup) : setVerdict("support", sup);
  else if (k === "c") setOverlay(!overlay);
  else if (k === "s") setSkin(!skinOn);
  else if (k === "o") setOthers(!othersOn);
  else if (k === "r") setRender(RENDERS[(RENDERS.indexOf(render) + 1) % RENDERS.length]);
  else if (k === "z" && (e.ctrlKey || e.metaKey)) undoEdit();
  else if (e.key === "Enter") { if (!$("w-confirm").disabled) confirmAnswer(); }
  else if (e.key === "ArrowLeft") goBack();
  else if (e.key === "ArrowRight") { if (!$("w-fwd").disabled) goForward(); }
  else return;
  e.preventDefault();
});

let raf = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { fitMipFrame(); drawGL(); drawMIP(); });
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawGL(); drawMIP(); });

/* ===========================================================================
   Demarrage
   ======================================================================== */
function saveReader() {
  try { localStorage.setItem("hcr:reader", JSON.stringify(reader)); } catch {}
}
function loadReader() {
  try { return JSON.parse(localStorage.getItem("hcr:reader") || "null"); } catch { return null; }
}

async function enter(id, skipTutorial) {
  const clean = id.trim();
  if (!clean) { showGateError(S().gErrEmpty); return; }
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(clean)) { showGateError(S().gErrChars); return; }
  /* Identifiant retire : ses anciennes reponses de test dorment encore dans ce
     navigateur et repartiraient dans la base. */
  if (RETIRED.includes(clean.toLowerCase())) { showGateError(S().gErrRetired); return; }
  reader = loadReader();
  if (!reader || reader.id !== clean)
    reader = { id: clean, startedAt: new Date().toISOString(), tutorialDone: false };
  saveReader();
  /* Etape 2 : on note, une fois pour toutes, dans quel etat le lecteur y
     arrive ; s'il n'a pas fini l'etape 1, on le lui fait confirmer. */
  if (isTrace() && !isTileReview() && !reader.step1) {
    const n = arrival && arrival.id === clean ? arrival.reviewed : null;
    const rec = { reviewed: n, entry: n == null ? "direct" : "from_step1", at: new Date().toISOString() };
    const go = () => { reader.step1 = rec; saveReader(); proceedEnter(skipTutorial); };
    if (n == null || n < GOAL) askConfirm(S().stepSkipAsk, go, S().stepSkipOk);
    else go();
    return;
  }
  proceedEnter(skipTutorial);
}
let storeReady = Promise.resolve();
async function proceedEnter(skipTutorial) {
  mine = cleanAnswers(store.localAll());
  storeReady = store.init().then(async () => {
    mine = cleanAnswers(mine); buildQueue();
    await applyRepairs();
    if (slab) paintProgress();
  }).catch(() => {});
  /* « Commencer le tutoriel » lance le tutoriel, toujours. L'ancienne version
     l'ignorait des qu'un meme identifiant l'avait deja vu, et l'on arrivait
     droit sur l'annotateur sans l'avoir demande. */
  if (isComplete() || isArbitrate() || isArbEdit() || isTileReview()) { reader.tutorialDone = true; saveReader(); await startWork(); }
  else if (skipTutorial) { reader.tutorialDone = true; saveReader(); await startPractice(); }
  else openTutorial();
}
/* Les reponses vides laissees par l'ancienne version — creees a l'ouverture
   d'une dalle, jamais confirmees — ne sont pas des reponses : on les ecarte au
   chargement plutot que de les compter comme lues. */
/* Restauration du 27 septembre : les deux reponses d'exercice de l'auteur
   ecrasees par le double clic, reprises d'une sauvegarde faite avant. Elles ne
   remplacent que des reponses absentes ou corrompues : une reponse donnee
   depuis par le lecteur l'emporte. */
const REPAIRS = {};   /* reader_id -> {slab_id: answer} : reponses a restaurer (vide par defaut) */
async function applyRepairs() {
  /* Sur une autre page (recherche, completion), ces reponses iraient dans une
     base qui n'est pas la leur, sous un numero de paquet faux. */
  const rep = reader && isStep1() && !isArbEdit() && REPAIRS[reader.id];
  if (!rep) return;
  const fixed = [];
  for (const [id, value] of Object.entries(rep)) {
    if (!byId.has(id)) continue;
    const cur = mine[id];
    if (cur && cur.slab_id === id) continue;
    await store.put(id, JSON.parse(JSON.stringify(value)));
    /* sans retouche, `put` n'ecrit pas de document de retouches : celui qui
       reste en base porte encore les retouches ecrasees, on le vide. */
    if (!store.hasEdits(value) && store.db && store.mode === "shared") {
      try {
        await store.db.doc(`edits/${reader.id}__${id}`).set({ reader_id: reader.id, slab_id: id,
          added_index: [], removed_index: [], cut_index: [], filled_index: [] });
      } catch {}
    }
    fixed.push(id);
  }
  /* Comblement deja pose sur une dalle ou il est interdit : on le retire de la
     copie de ce navigateur, qui sinon le renverrait a la prochaine confirmation. */
  for (const id of NO_FILL) {
    const cur = mine[id];
    if (!cur || cur.slab_id !== id || !(cur.filled_index || []).length) continue;
    const v = JSON.parse(JSON.stringify(cur));
    v.filled_index = []; v.filled_voxels = 0;
    v.fill_removed = "2026-09-30 : comblement annule a la demande de l'auteur (poils fusionnes pontes)";
    await store.put(id, v);
    fixed.push(id);
  }
  if (!fixed.length) return;
  rebuildHistory(); frontierId = nextFrontier();
  if (slab && !practice && fixed.includes(answerId()) && !revisiting()) await goTo(frontierId);
  else if (slab) paintProgress();
}
function cleanAnswers(all) {
  const out = {};
  for (const [id, v] of Object.entries(all || {})) {
    if (v) migrateAnswer(v);
    /* Une reponse sans nature reste une reponse quand son mode n'en demande pas :
       « Stop at the box » (completion), « plusieurs objets » et l'etape 2 de la
       seconde lecture. L'ecarter l'effacait de la base a la confirmation suivante,
       qui reecrit tout le morceau de reponses (9 oct., <dalle>). */
    const hasNature = v && (v.nature || v.doubt || (v.parts || []).some(p => p.nature || p.doubt)
      || (v.several && v.several.length) || (v.support || []).includes("skip")
      || v.mode === "second" || v.mode === "second_trace" || v.mode === "arbitrate");
    const corrupt = v && v.slab_id && v.slab_id !== id;
    if (hasNature && !corrupt && byId.has(id)) out[id] = v;
  }
  return out;
}
/* Jusqu'au 26 septembre, « unsure » etait une nature ; c'est desormais un doute
   qui s'ajoute a une nature obligatoire. Une ancienne reponse est traduite a la
   lecture, sans rien perdre : l'etape 1 garde le doute et redemande la nature
   (`needs_nature`, et le lecteur y est ramene) ; a la recherche, « tubular » et
   « unsure » deviennent un poil douteux, reponse complete. La copie en base ne
   change qu'a la prochaine confirmation du lecteur. */
function migrateAnswer(v) {
  const trace = COH && COH.mode === "trace";
  const fix = n => trace ? (n === "tubular" || n === "unsure") : n === "unsure";
  let hit = false;
  if (!trace && v.nature === "unsure") { v.nature = null; v.doubt = true; hit = true; }
  for (const p of v.parts || []) {
    if (fix(p.nature)) { p.nature = trace ? "hair" : null; p.doubt = true; hit = true; }
  }
  if (hit) { v.from_unsure = true; if (!trace) v.needs_nature = true; }
  return v;
}
function showGateError(msg) {
  const e = $("g-error");
  e.hidden = false; e.textContent = msg;
}
$("g-start").onclick = () => enter($("g-id").value, false);
$("g-skip").onclick = () => enter($("g-id").value, true);
$("g-id").addEventListener("input", () => { $("g-error").hidden = true; paintModes(); });
/* Deux taches : l'accueil propose l'autre et lui passe l'identifiant. La
   recherche tient sur trois pages (270 tuiles ne logent pas dans une seule). */
/* Les liens viennent de config.js ; sans page de recherche configuree, la page
   fonctionne seule et les liens d'etape sont masques. */
const PAGES = { review: CONFIG.pages.review || null, search: CONFIG.pages.search || [] };
const hasStepLinks = () => !!PAGES.review && PAGES.search.length > 0;
/* Chaque personne est envoyee sur une page de recherche, toujours la meme.
   En base partagee, au tour de role dans l'ordre d'arrivee des volontaires a
   l'etape 1 (l'auteur exclu, il les lit toutes), pour equilibrer les pages ;
   sinon — lecteur exterieur, ou identifiant pas encore connu de la base — par
   hachage du nom. Une fois tiree en base partagee, la page est gardee dans la
   fiche du lecteur et ne change plus. */
function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return h >>> 0;
}
function searchPageOf(id) {
  const n = PAGES.search.length, me = person(id);
  const own = reader && reader.id === id ? reader : storedReader(id);
  if (own && Number.isInteger(own.searchPage) && own.searchPage < n) return own.searchPage;
  const first = {};
  for (const [rid, at] of Object.entries(store.started || {})) {
    const p = person(rid);
    if (!at || p === AUTHOR) continue;
    if (!first[p] || at < first[p]) first[p] = at;
  }
  if (!first[me]) return hashName(me) % n;
  const order = Object.entries(first).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const page = order.findIndex(([p]) => p === me) % n;
  if (reader && reader.id === id && store.mode === "shared") { reader.searchPage = page; saveReader(); }
  return page;
}
/* ===========================================================================
   Protocole en deux etapes
   ---------------------------------------------------------------------------
   Etape 1, juger des formes deja trouvees ; etape 2, chercher les poils
   manques. Chercher dans le vide est bien plus facile apres une centaine de
   candidats : la page pousse fortement vers cet ordre sans l'imposer — l'auteur
   peut donner directement le lien de l'etape 2, et le lecteur peut poursuivre
   l'etape 1 au-dela de l'objectif. Le lien vers l'etape 2 porte le nombre de
   formes jugees (#rid-yamada/s1-100) ; l'etape 2 l'enregistre avec chaque
   reponse, pour que l'analyse separe les deux entrees.
   ======================================================================== */
let arrival = null;             /* {id, reviewed} lu dans l'ancre, sinon null */
/* Ancre « /open-<dalle> » : rouvrir une dalle deja repondue, comme par le bouton
   Precedent (revue des tuiles lues avant les regles du 8 octobre). */
let openWanted = null;
function reviewedBy(id) {
  let n = 0;
  try {
    const all = cleanAnswers(JSON.parse(localStorage.getItem(`hcr:${id}`) || "{}"));
    n = Object.keys(all).filter(k => !byId.get(k)?.tutorial).length;
  } catch {}
  return reader && reader.id === id ? Math.max(n, doneCount()) : n;
}
function stepLink(target, id) {
  id = (id ?? (reader && reader.id) ?? "").trim();
  const ok = /^[A-Za-z0-9_-]{1,24}$/.test(id);
  const base = target === "search" ? PAGES.search[ok ? searchPageOf(id) : 0] : PAGES[target];
  if (!ok) return base;
  return base + "#rid-" + id + (target === "search" && !isTrace() ? "/s1-" + reviewedBy(id) : "");
}
function paintStep2(a, on) {
  on = on && hasStepLinks();
  a.hidden = !on;
  if (on) { a.textContent = S().step2Link; a.href = stepLink("search"); }
}
function offerStep2() {
  if (!hasStepLinks()) return;
  const L = S(), local = store.mode !== "shared";
  reader.step2Offered = new Date().toISOString(); saveReader();
  $("ho-title").textContent = L.hoTitle;
  $("ho-msg").textContent = L.hoMsg(doneCount());
  const go = $("ho-go");
  go.textContent = L.hoGo; go.href = stepLink("search");
  $("ho-export").hidden = !local; $("ho-export").textContent = L.mnExport;
  $("ho-stay").textContent = L.hoStay;
  $("ho-note").textContent = local ? L.hoNoteLocal : L.hoNote;
  $("handoff").hidden = false;
  go.focus();
}
$("ho-go").addEventListener("click", () => { $("handoff").hidden = true; });
$("ho-stay").onclick = () => { $("handoff").hidden = true; };
$("ho-export").onclick = () => exportAnswers($("ho-export"));
function storedReader(id) {
  const r = loadReader();
  return r && r.id === id ? r : null;
}
function paintModes() {
  if (!COH) return;
  const here = isTrace() ? "search" : "review", id = ($("g-id").value || "").trim();
  for (const m of ["review", "search"]) {
    const a = $(`g-mode-${m}`);
    if (m === here) { a.removeAttribute("href"); a.setAttribute("aria-current", "page"); }
    else { a.href = stepLink(m, id); a.removeAttribute("aria-current"); }
  }
  /* Etape 2 ouverte sans l'etape 1 : un avertissement, tant que ce lecteur n'a
     pas deja commence l'etape 2 sur ce navigateur. */
  const known = arrival && arrival.id === id ? arrival.reviewed : null;
  const warn = isTrace() && !isPicker() && !storedReader(id)?.step1 && !(known != null && known >= GOAL);
  $("g-stepwarn").hidden = !warn;
  if (warn) {
    $("g-stepwarn-msg").textContent = S().stepWarn(known || 0, GOAL);
    const a = $("g-stepwarn-go");
    a.textContent = S().stepWarnGo; a.href = stepLink("review", id);
  }
}

(async () => {
  try { lang = localStorage.getItem("hcr:lang") || "en"; } catch {}
  glOK = initGL();
  COH = await (await fetch(dataUrl("cohorte.json"))).json();
  BOX = COH.box; COLS = COH.atlas_cols; ROWS = COH.atlas_rows;
  SKIN_SLOT = COH.skin_slot; PER_PACK = COH.per_pack;
  if (glOK) { gl.uniform1f(uni.uBox, BOX); gl.uniform3f(uni.uStep, 1/BOX, 1/BOX, 1/BOX); }
  byId = new Map(COH.slabs.map(s => [s.slab_id, s]));
  $("g-modes").hidden = !hasStepLinks() || isPicker() || isComplete() || isArbitrate() || isArbEdit() || isTileReview();
  if (isTrace()) {
    TRACE_STR = { en: { ...STR.en, ...STR_TRACE.en }, ja: { ...STR.ja, ...STR_TRACE.ja } };
    TRACE2_STR = { en: { ...TRACE_STR.en, ...STR_SECOND_TRACE.en }, ja: { ...TRACE_STR.ja, ...STR_SECOND_TRACE.ja } };
    if (isTileReview()) for (const l of ["en", "ja"]) Object.assign(TRACE_STR[l], STR_TILE_REVIEW[l]);
    $("tl-trace").hidden = false; $("newhair").hidden = false; $("tl-fill").hidden = true;
    $("dpad").hidden = false;
    tool = "trace";
  }
  /* Etape 1 : le traceur des pages de recherche, pour poser un pont qui suit le
     signal plutot que des blocs de 7 voxels (demande de l'auteur, 7 octobre). */
  if (isStep1() || isComplete()) {
    for (const l of ["en", "ja"]) Object.assign(STR[l], STEP1_TRACE[l]);
    $("tl-trace").hidden = false; $("newhair").hidden = false;
  }
  SECOND_STR = { en: { ...STR.en, ...STR_SECOND.en }, ja: { ...STR.ja, ...STR_SECOND.ja } };
  if (isArbitrate()) {
    ARB_STR = { en: { ...STR.en, ...STR_ARBITRATE.en }, ja: { ...STR.ja, ...STR_ARBITRATE.ja } };
    $("g-skip").hidden = true;
  }
  if (isArbEdit()) {
    for (const l of ["en", "ja"]) Object.assign(STR[l], STR_ARB_EDIT[l]);
    $("g-skip").hidden = true;
  }
  if (isComplete()) {
    COMPLETE_STR = { en: { ...STR.en, ...STR_COMPLETE.en }, ja: { ...STR.ja, ...STR_COMPLETE.ja } };
    $("dpad").hidden = false; $("g-skip").hidden = true;
    tool = "b1";
  }
  /* Le bouton presse dans index.html est celui de l'etape 1 (1 vx) : sans cette
     synchronisation, la recherche affichait « 1 vx » alors que l'outil actif
     etait le traceur. */
  setToolUI();
  applyLang();
  try { if (localStorage.getItem("hcr:todo") === "0") setTodoOpen(false); } catch {}
  const prev = loadReader();
  /* Venu de l'autre tache : l'identifiant arrive dans l'ancre (#rid-yamada). */
  const fromPeer = /^#rid-([A-Za-z0-9_-]{1,24})(?:\/s1-(\d{1,5}))?(?:\/open-[A-Za-z0-9-]{3,40})?$/.exec(location.hash || "");
  const openMatch = /\/open-([A-Za-z0-9-]{3,40})$/.exec(location.hash || "");
  if (openMatch) openWanted = openMatch[1];
  if (fromPeer) {
    $("g-id").value = fromPeer[1];
    arrival = { id: fromPeer[1], reviewed: fromPeer[2] != null ? +fromPeer[2] : null };
  }
  paintModes();
  if (prev && !fromPeer) {
    $("g-id").value = prev.id;
    const saved = Object.keys((() => {
      try { return JSON.parse(localStorage.getItem(`hcr:${prev.id}`) || "{}"); } catch { return {}; }
    })()).length;
    if (saved) {
      $("g-resume").hidden = false;
      $("g-resume").textContent = S().gResume(saved);
    }
  }
  if (isPicker()) { await startPicker(); return; }
  show("gate");
  if (!glOK) {
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = "This browser cannot run WebGL2, which the 3-D view needs. Please use an up-to-date Chrome, Edge, Firefox or Safari.";
    $("gate").querySelector(".card").appendChild(p);
  }
})();
