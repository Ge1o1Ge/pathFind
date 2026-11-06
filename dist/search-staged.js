'use strict';

class StagedRouteSearch extends VariableRouteSearch {
  constructor(points, warmupLimit = points.length - 2, integerWeights = false, initialTour, scoreModel = CURRENT_SCORE_MODEL) {
    super(points, warmupLimit, integerWeights, initialTour, scoreModel);
    this.algorithm = 'hvastuns-staged';
    this.stageThresholds = [0.1, 0.05, 0.01, 0.001, 0];
    this.stageIndex = 0;
    this.stageQueues = this.stageThresholds.map(() => new CandidateQueue());
    this.stageDeferred = this.stageReleased = this.stageZeroCuts = this.stageProbeSkips = this.stageEarlyOpens = 0;
    this.stageMemoryLimit = 32000;
    this.stageHistory = [{ step: 0, threshold: this.stageThresholds[0], reason: 'start', upper: this.upper }];
  }
  get stageThreshold() { return this.stageThresholds?.[this.stageIndex] || 0; }
  get pending() {
    return super.pending + (this.stageQueues?.slice(0, this.stageIndex + 1).reduce((sum, q) => sum + q.items.length, 0) || 0);
  }
  get deferredCount() {
    return this.stageQueues?.slice(this.stageIndex + 1).reduce((sum, q) => sum + q.items.length, 0) || 0;
  }
  frontierGroups() { return super.frontierGroups().concat(this.stageQueues?.map(q => q.items) || []); }
  clearFrontier() {
    super.clearFrontier();
    for (const queue of this.stageQueues || []) queue.items.length = 0;
  }
  syncState(state) {
    const valid = super.syncState(state);
    if (!valid && state.deferredStage !== undefined && !state.stageZeroCounted) {
      state.stageZeroCounted = true;
      this.stageZeroCuts++;
    }
    return valid;
  }
  extend(state, side, city) {
    const child = super.extend(state, side, city);
    if (this.edgeAnalysis?.done) child.minScore = Math.min(state.minScore ?? 1, this.edge(state.paths[side].at(-1), city).initialScore);
    return child;
  }
  scoreFloor(state) {
    let score = state.minScore ?? 1;
    // Последние связи добавляются close без ветвления, но тоже определяют этап полного цикла.
    if (!state.free) for (const path of state.paths) {
      if (path.at(-1) !== this.b) score = Math.min(score, this.edge(path.at(-1), this.b).initialScore);
    }
    return score;
  }
  checkedExtension(state, side, city) {
    const child = super.checkedExtension(state, side, city);
    if (child && this.completion && this.scoreFloor(child) < this.stageThreshold) {
      this.completion.stageLimited = true;
      this.stageProbeSkips++;
      return null;
    }
    return child;
  }
  finishCompletion(outcome) {
    // Исчерпание только разрешённых на этом этапе достроек не доказывает тупик полного состояния.
    if (outcome === 'exhausted' && this.completion.stageLimited) outcome = 'budget';
    super.finishCompletion(outcome);
  }
  repairDue() { return this.stageThreshold === 0 && super.repairDue(); }
  deferChild(state) {
    const score = this.scoreFloor(state), tier = this.stageThresholds.findIndex(threshold => score >= threshold);
    if (tier <= this.stageIndex) return false;
    state.deferredStage = tier;
    this.stageQueues[tier].add(state);
    this.stageDeferred++;
    return true;
  }
  openStage(reason) {
    let tier = this.stageIndex + 1;
    while (tier < this.stageQueues.length && !this.stageQueues[tier].items.length) tier++;
    if (tier === this.stageQueues.length) return;
    this.stageIndex = tier;
    this.stageReleased += this.stageQueues[tier].items.length;
    if (reason === 'memory') this.stageEarlyOpens++;
    this.stageHistory.push({ step: this.mainSteps, threshold: this.stageThreshold, reason, upper: this.upper });
    // Сканирование учитывает и ещё закрытые этапы; смена приоритета сама по себе не повышает нижнюю границу.
    this.nextCheckpoint = this.steps + 1;
  }
  choose() {
    if (this.selectedState) { const state = this.selectedState; this.selectedState = null; return state; }
    if (!this.next && !this.pending && !this.stack.length && this.deferredCount) this.openStage('exhausted');
    else if (this.deferredCount >= this.stageMemoryLimit) this.openStage('memory');
    this.refillQueues();
    if (this.stack.length) return this.stack.pop();
    if (this.next) { this.queueFor(this.next).add(this.next); this.next = null; }
    let selected;
    for (const queue of this.queues.concat(this.stageQueues.slice(0, this.stageIndex + 1))) {
      if (queue.first && (!selected || queue.first.cost < selected.first.cost)) selected = queue;
    }
    return selected?.take();
  }
  reportZeros() {
    return { ...super.reportZeros(), stages: { threshold: this.stageThreshold, index: this.stageIndex, thresholds: this.stageThresholds,
      pending: this.deferredCount, history: this.stageHistory, deferred: this.stageDeferred, released: this.stageReleased,
      zeroCuts: this.stageZeroCuts, probeSkips: this.stageProbeSkips, earlyOpens: this.stageEarlyOpens, memoryLimit: this.stageMemoryLimit } };
  }
}
