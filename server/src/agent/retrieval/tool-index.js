import { signature } from '../../core/registry.js';
import { editDistance } from '../../core/strings.js';
import { config, hasApiKey } from '../config.js';
import { Bm25Index } from './bm25.js';
import { EmbeddingStore } from './embeddings.js';
import { STOP, SYNONYMS, splitInstruction, stem, tokenize } from './text.js';

const ALWAYS_INCLUDED = ['contacts.search', 'users.list'];
const LOOKUP_ACTIONS = [
  'search',
  'list',
  'get',
  'list_plans',
  'search_posts',
  'list_for_module',
  'list_for_product',
];
const RRF_K = 60;
const CONTENT_WEIGHT = 0.35;
const SYNONYM_WEIGHT = 0.6;
const TYPO_WEIGHT = 0.8;
const TYPO_MIN_LENGTH = 5;
const ALWAYS_FULL_MODULES = 2;
const FULL_MODULE_SHARE = 0.5;
const LOOKUP_MODULES = 7;

function actionDocument(action, mod) {
  const params = Object.keys(action.inputJsonSchema.properties ?? {}).join(' ');
  const keywords = (mod.keywords ?? []).join(' ');
  return [
    action.id,
    action.title,
    action.title,
    action.title,
    action.description,
    action.description,
    mod.title,
    mod.title,
    mod.description,
    keywords,
    keywords,
    params,
  ].join(' ');
}

function moduleDocument(mod, registry) {
  const keywords = mod.keywords ?? [];
  return [
    mod.id,
    mod.title,
    mod.title,
    mod.title,
    mod.description,
    ...keywords,
    ...keywords,
    ...mod.actions.map((id) => registry.get(id).title),
  ].join(' ');
}

function rankPositions(scores) {
  const positions = new Array(scores.length);
  scores
    .map((score, i) => [score, i])
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i], rank) => (positions[i] = rank));
  return positions;
}

/** Reciprocal rank fusion: combines rankings without having to calibrate their score scales. */
function fuse(keywordScores, semanticScores) {
  const keywordRank = rankPositions(keywordScores);
  const semanticRank = rankPositions(semanticScores);
  return keywordScores.map(
    (score, i) => (score > 0 ? 1 / (RRF_K + keywordRank[i]) : 0) + 1 / (RRF_K + semanticRank[i]),
  );
}

/** Picks the few actions (of 500) worth describing to the planner for a request. */
export class ToolIndex {
  constructor(registry) {
    this.registry = registry;
    this.actions = registry.list();
    this.moduleList = registry.listModules();
    this.modules = Object.fromEntries(this.moduleList.map((m) => [m.id, m]));
    this.actionIndex = new Bm25Index(
      this.actions.map((a) => tokenize(actionDocument(a, this.modules[a.module]))),
    );
    this.moduleIndex = new Bm25Index(
      this.moduleList.map((m) => tokenize(moduleDocument(m, registry))),
      { b: 0.5 },
    );
    this.vocabulary = [...new Set([...this.actionIndex.terms(), ...this.moduleIndex.terms()])];
    this.lookupAction = Object.fromEntries(
      this.moduleList.map((m) => [
        m.id,
        LOOKUP_ACTIONS.map((n) => `${m.id}.${n}`).find((id) => registry.get(id)),
      ]),
    );
    this.embeddings = new EmbeddingStore(
      this.actions.map((a) => {
        const mod = this.modules[a.module];
        return `${a.title}. ${a.description} (module: ${mod.title}; keywords: ${(mod.keywords ?? []).join(', ')})`;
      }),
    );
  }

  loadEmbeddings(trace) {
    return this.embeddings.load(trace);
  }

  /** Weighted query terms: the instruction at full weight, quoted or dictated content down-weighted. */
  expand(query) {
    const terms = new Map();
    const { instruction, content } = splitInstruction(query);
    this.addTerms(instruction, 1, terms);
    if (content) this.addTerms(content, CONTENT_WEIGHT, terms);
    return terms;
  }

  addTerms(text, scale, terms) {
    const add = (term, weight) => terms.set(term, Math.max(terms.get(term) ?? 0, weight * scale));
    const words = String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOP.has(w));
    for (const word of words) {
      const term = stem(word);
      for (const synonym of SYNONYMS[word] ?? SYNONYMS[term] ?? []) add(stem(synonym), SYNONYM_WEIGHT);
      if (this.actionIndex.has(term)) add(term, 1);
      else {
        const correction = this.correctTypo(term);
        if (correction) add(correction, TYPO_WEIGHT);
      }
    }
  }

  correctTypo(term) {
    if (term.length < TYPO_MIN_LENGTH) return null;
    const maxDistance = term.length >= 8 ? 2 : 1;
    let best = null;
    let bestDistance = maxDistance + 1;
    for (const candidate of this.vocabulary) {
      if (maxDistance === 1 && candidate[0] !== term[0]) continue;
      const distance = editDistance(term, candidate, maxDistance);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Returns the tool IDs for the planner: the top-k actions, every action of the strongest modules,
   * a lookup action per relevant module, actions used last turn (sticky) and the always-on lookups.
   */
  async search(
    query,
    { k = config.topK, sticky = [], mode = config.retrieval, trace, fullModules = 4 } = {},
  ) {
    const started = performance.now();
    const terms = this.expand(query);
    const keywordScores = this.actionIndex.score(terms);
    const moduleScores = this.moduleIndex
      .score(terms)
      .map((score, i) => ({ id: this.moduleList[i].id, score }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);

    let scores = keywordScores;
    if (mode === 'hybrid' && hasApiKey()) {
      const semantic = await this.embeddings.similarities(query, trace);
      if (semantic) scores = fuse(keywordScores, semantic);
    }
    const ranked = scores
      .map((score, i) => ({ i, score }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const picked = new Set(ranked.slice(0, k).map((x) => this.actions[x.i].id));
    const best = moduleScores[0]?.score ?? 0;
    moduleScores
      .slice(0, fullModules)
      .filter((m, i) => i < ALWAYS_FULL_MODULES || m.score >= best * FULL_MODULE_SHARE)
      .forEach((m) => this.modules[m.id].actions.forEach((id) => picked.add(id)));

    const relevantModules = [
      ...new Set([
        ...moduleScores.slice(0, LOOKUP_MODULES - 1).map((m) => m.id),
        ...ranked.slice(0, k).map((x) => this.actions[x.i].module),
      ]),
    ].slice(0, LOOKUP_MODULES);
    for (const id of relevantModules) if (this.lookupAction[id]) picked.add(this.lookupAction[id]);
    for (const id of [...sticky, ...ALWAYS_INCLUDED]) if (this.registry.get(id)) picked.add(id);

    return {
      ids: [...picked],
      modules: relevantModules,
      moduleTop: moduleScores.slice(0, 5).map((m) => ({ id: m.id, score: Math.round(m.score * 100) / 100 })),
      top: ranked
        .slice(0, 5)
        .map((x) => ({ id: this.actions[x.i].id, score: Math.round(x.score * 1000) / 1000 })),
      ms: performance.now() - started,
    };
  }

  /** Token-cheap description block for the planner prompt. */
  describe(ids) {
    return ids
      .map((id) => {
        const action = this.registry.get(id);
        const outputKeys = Object.keys(action.outputJsonSchema.properties ?? {});
        const returns = outputKeys.includes('items')
          ? ' -> {items[], total}'
          : outputKeys.length > 1
            ? ` -> {${outputKeys.slice(0, 6).join(', ')}}`
            : ' -> record';
        return `- ${signature(action)} [${action.effect}]${returns}\n    ${action.description}`;
      })
      .join('\n');
  }
}
