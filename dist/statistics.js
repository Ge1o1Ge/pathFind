'use strict';

const SERIES_TARGET = 1000;
const MAX_SERIES_CITIES = 30;
const PLAN_KEY = 'series-plan';
const proofMetrics = {
  referenceTotalMs: ['Получение начального оптимума, мс', 'Полный обычный запуск, который нашёл и доказал маршрут перед тестом подтверждения. Время не входит во время повторного подтверждения.'],
  referenceMainSteps: ['Состояния при получении оптимума', 'Основной поиск первого запуска, до передачи оптимального цикла новому решателю.'],
  referenceCompletionChecks: ['Достройки при получении оптимума', 'Проверки достройки в первом обычном запуске.'],
  pairTotalMs: ['Оба запуска вместе, мс', 'Время получения доказанного оптимума плюс время подтверждения со старта. Оба включают всю подготовку.']
};
const stageMetrics = {
  stageDeferred: ['Отложено по баллу', 'Поэтапный поиск: состояния, впервые отложенные до подключения слабых рёбер. Это не отсечения.'],
  stageReleased: ['Подключено отложенных состояний', 'Число состояний в очередях на момент открытия соответствующих этапов.'],
  stageZeroCuts: ['Отложенные состояния с доказанным нулём', 'Состояния, потерявшие допустимость из-за глобального запрета ребра. В поздних этапах они не восстанавливаются.'],
  stageProbeSkips: ['Отложено проверок достройки по баллу', 'Слабые продолжения пробных достроек; их исчерпание не доказывает тупик полного состояния.'],
  stageEarlyOpens: ['Досрочно открыто этапов', 'Подключение следующей группы при 32 000 отложенных состояниях. Это ограничение накопления, не доказательство оптимума этапа.'],
  stageTransitions: ['Переходов между этапами', 'Число подключений следующих групп баллов.'],
  stageFinalThreshold: ['Порог на момент доказательства', 'Нижняя граница учитывает все этапы: общий оптимум иногда доказан без подключения слабых рёбер.']
};
const combinationMetrics = {
  combinationEvaluations: ['Вычислений B(F)', 'Нижняя оценка для обеих закреплённых ветвей по оставшимся степеням городов.'],
  combinationChecks: ['Проверок соседей в B(F)', 'Каждый просмотренный кандидат при подборе самых дешёвых оставшихся связей.'],
  combinationCacheHits: ['Повторных использований B(F)', 'Оценка состояния используется повторно, пока общая маска запретов не изменилась.'],
  combinationRaised: ['Усилений границы через B(F)', 'Вычисления B(F), давшие более высокую границу, чем остов и доступная оценка через 1-дерево.'],
  combinationCuts: ['Дополнительно исключено через B(F)', 'Состояния, где B(F) исключила улучшение рекорда, а прежняя граница ещё не достигла его. Каждое состояние учитывается один раз.'],
  combinationImpossible: ['Нехватка связей в B(F)', 'Вычисления, обнаружившие нехватку допустимых связей у города с учётом обеих ветвей. Это запрет комбинации, а не глобальный ноль её рёбер.'],
  combinationMs: ['Вычисление B(F), мс', 'Время внутри основного поиска и пробных достроек. Уже входит в общий расчёт, повторно не прибавляется.']
};
const workMetrics = {
  edgeOneTreeChecks: ['Оценок рёбер через 1-дерево', 'Один расчёт на разрешённое ребро; сохранённая оценка повторно сравнивается с улучшенным рекордом.'],
  edgeOneTreeCuts: ['Дополнительных нулей через 1-дерево', 'Глобальные запреты, которые не дала прежняя геометрическая оценка с обязательным ребром. Строгое сравнение сохраняет равные оптимумы.'],
  ...stageMetrics,
  ...combinationMetrics,
  relaxedAttempts: ['Достройки с распутыванием', 'Hvastuns-var: проба на копии текущих ветвей перед обычной ограниченной достройкой.'],
  relaxedBuildChecks: ['Продолжения пробы с пересечениями', 'Проверенные продолжения и замыкающие связи. Пересечения разрешены, глобальные нули и порог этапа сохраняются.'],
  relaxedOptChecks: ['Пары 2-opt в пробной достройке', 'Все проверенные пары рёбер после сборки пробного полного цикла, включая отвергнутые.'],
  relaxedMoves: ['Развороты пробного цикла', 'Принятые изменения 2-opt: удаление недопустимых связей или сокращение длины. Могут менять начало скопированных ветвей.'],
  relaxedCycles: ['Собрано циклов перед распутыванием', 'Полные циклы пробы до 2-opt. Каждый содержит все города ровно один раз.'],
  relaxedImprovements: ['Улучшений L от пробы', 'Более короткие полные циклы до и во время распутывания, включая временные нулевые связи. Входят также в общий счётчик улучшений достройки.'],
  relaxedFailures: ['Возвраты к обычной достройке', 'Защитный возврат, если проверка полного пробного цикла выявила неверный состав городов; это не отсечение состояния.'],
  relaxedLimited: ['Достройки с лимитом 2-opt', 'Достигнут бюджет 8n² пар. Полученный полный цикл всё ещё может улучшить рекорд.'],
  relaxedMs: ['Достройка с распутыванием, мс', 'Подмножество времени пробных достроек. Уже входит в completionMs и общий расчёт; повторно не прибавляется.'],
  relaxedForced: ['Принудительных заполнений пробы', 'После тупика или лимита сборки все оставшиеся города вставляются перед B в пробной копии. Временные нули разрешены.'],
  relaxedFillChecks: ['Проверок при заполнении пробы', 'Просмотренные соседи при случайном выборе среди трёх ближайших свободных городов.'],
  relaxedFilledCities: ['Принудительно добавлено городов', 'Число оставшихся городов, добавленных в полный пробный цикл после обычной сборки.'],
  relaxedRepairedEdges: ['Убрано недопустимых связей пробы', 'Локальный 2-opt убирает нули и связи ниже порога этапа. Следующий геометрический проход может временно использовать такие связи.'],
  relaxedUncrossChecks: ['Проверки отдельного распутывания', 'Пары рёбер после локального 2-opt, включая контрольный подсчёт поперечных пересечений.'],
  relaxedUncrossMoves: ['Замены при отдельном распутывании', 'Развороты с уменьшением геометрической длины в полной пробной копии. Временные нули и связи ниже порога разрешены.'],
  relaxedUncrossLimited: ['Достигнут лимит распутывания', 'Число проб, где отдельный проход исчерпал n³ проверок до полного просмотра без замен.'],
  relaxedCrossingsLeft: ['Пересечения, оставшиеся после проб', 'Сумма оставшихся поперечных пересечений по завершённым пробам. Ноль означает отсутствие таких пересечений в их последних кадрах.'],
  ...scoreQualityMetrics,
  ...scoreDistributionMetrics,
  ...proofMetrics,
  diversityAttempts: ['Возвраты к альтернативам при застое', 'Hvastuns-var: выбор из отложенных вариантов после 4096 состояний без улучшения границ, не чаще раза в 1024 состояния.'],
  diversitySwitches: ['Смены начала ветвей', 'Возвраты к варианту с другим набором первых трёх рёбер каждой ветви. Ни один вариант не теряется.'],
  diversityChecks: ['Кандидаты переключения', 'Состояния, проверенные при выборе альтернативы с учётом повторов начала ветвей.'],
  diversityProbes: ['Достройки после переключения', 'Дополнительные попытки достроить выбранную альтернативу. Входят также в общие счётчики достройки.'],
  diversityMaxVisits: ['Максимум повторов начального ребра', 'Наибольшее число обработанных состояний, содержащих одно ребро среди первых трёх связей ветви. Это не доказательство ошибки ребра.'],
  diversityMs: ['Выбор альтернатив при застое, мс', 'Входит в основной поиск; повторно к общему времени не прибавляется.'],
  repairAttempts: ['Перестройки полного цикла', 'Hvastuns-var: независимые попытки улучшить рекорд перестановкой участков и 2-opt во время поиска.'],
  repairChecks: ['Пары рёбер при перестройке', 'Каждая проверенная пара 2-opt, включая отвергнутые; отдельно от разминки и состояний поиска.'],
  repairMoves: ['Развороты при перестройке', 'Принятые сокращения пробного цикла; они не обязательно улучшают общий рекорд.'],
  repairImprovements: ['Улучшения L от перестройки', 'Сохранённые полные циклы, строго улучшившие рекорд. Неудача не запрещает рёбра и состояния.'],
  repairMs: ['Перестройки полного цикла, мс', 'Активное время попыток, включённое в общий расчёт отдельно от основного поиска.'],
  globalZeros: ['Глобально исключено рёбер', 'Hvastuns-var: только доказанные нули, общие для всех состояний поиска.'],
  requiredEdges: ['Доказано обязательных рёбер', 'Связи, которые должны присутствовать во всех оптимальных циклах по последствиям глобальных запретов.'],
  edgeBoundChecks: ['Сравнения Bₑ с U', 'Первичная проверка оценки ребра и повторные сравнения после улучшения рекорда.'],
  globalStateCuts: ['Состояния с глобальными нулями', 'Отложенные состояния, отброшенные после появления запрещённых рёбер в их путях.'],
  globalEdgeCuts: ['Продолжения с глобальными нулями', 'Продолжения, исключённые общей маской, включая замыкающие связи к B.'],
  edgeMatrixMs: ['Матрица рёбер, мс', 'Hvastuns-var: геометрия, симметричная запись конфликтов, оценки перспективности и нижние оценки с ребром.'],
  edgePruningMs: ['Обновления матрицы и управление, мс', 'Hvastuns-var: сравнения с рекордом, распространение доказанных запретов и управление фазами.'],
  mainSteps: ['Состояния основного поиска', 'У двух и четырёх ветвей это извлечённые варианты. Hvastuns-4 проверяет оценку продолжений ещё до очереди. У Held–Karp это заполненные ячейки таблицы. Стоимость шага различается.'],
  duplicateCuts: ['Отсечено повторов', 'Состояния с уже известной меньшей или равной длиной.'],
  memoEvictions: ['Вытеснено записей кеша', 'На полях от 31 города заполненный кеш заменяет самые старые записи новыми. Варианты поиска сохраняются.'],
  seenStates: ['Записей в кеше', 'Количество сохранённых состояний на момент завершения. Максимум 1 000 000.'],
  treeHits: ['Попадания в кеш остовов', 'Сколько нижних оценок использовали ранее рассчитанный остов или лес.'],
  treeMisses: ['Пересчёты остовов', 'Сколько раз остов или лес пришлось вычислить заново.'],
  treeEvictions: ['Вытеснения кеша остовов', 'На полях от 31 города кеш остовов обновляется после заполнения 16 000 записей.'],
  totalMs: ['Весь расчёт, мс', 'Подготовка + разминка + основной поиск + пробные достройки до доказательства оптимума. У Hvastuns-var включены матрица, обновления запретов и перестройки полных циклов. Без отрисовки, пауз и ожидания между порциями расчёта.'],
  preparationMs: ['Подготовка, мс', 'Расстояния, геометрия, начальные структуры и первая нижняя оценка.'],
  warmupMs: ['Разминка, мс', 'Всё построение начальных циклов: жадный маршрут, вставки, поиск соседей 2-opt и сохранение рекорда.'],
  searchMs: ['Основной поиск, мс', 'Активное время перебора и подтверждения оптимума после разминки, без пробных достроек.'],
  completionAttempts: ['Попытки достройки', 'Пробные завершения текущих ветвей во время основного поиска.'],
  completionChecks: ['Кандидаты достройки', 'Каждый проверенный следующий город или встреча ветвей, включая отвергнутые. Отдельно от состояний основного поиска.'],
  completionSolutions: ['Полные циклы достройки', 'Сколько пробных достроек завершилось допустимым циклом. Циклы между попытками могут повторяться.'],
  completionImprovements: ['Улучшения от достройки', 'Сколько раз пробное завершение уменьшило лучший L.'],
  completionExhausted: ['Доказанные тупики достройки', 'Попытки, полностью исчерпавшие допустимые продолжения. Достижение лимита проверок тупиком не считается.'],
  completionMs: ['Пробные достройки, мс', 'Активное время пробного завершения ветвей, отдельно от основного поиска.'],
  warmupCycles: ['Разные циклы разминки', 'Сколько полных циклов принято в разминке. Не более n − 2, включая первый.'],
  warmupCandidates: ['Кандидаты разминки', 'Сумма проверенных позиций вставки и рассмотренных пар рёбер 2-opt, включая отвергнутые.'],
  insertionChecks: ['Позиции вставки', 'Каждое вычисление прироста длины при попытке вставить город.'],
  twoOptChecks: ['Пары рёбер 2-opt', 'Каждая рассмотренная пара несмежных рёбер, включая проверки без улучшения и повторы.'],
  greedyChecks: ['Проверки жадного старта', 'Сколько раз при построении первого цикла проверялось, свободен ли очередной город. Считаются отдельно от вставок и пар 2-opt.']
};
const statsMetrics = {
  ...workMetrics,
  steps: ['Шаги до завершения (прежняя шкала)', 'Для сравнения со старыми сериями: шаг — принятый цикл разминки или состояние основного поиска. Это разные по стоимости операции.'],
  bestStep: ['Шаг нахождения оптимума', 'Номер шага, на котором впервые найден итоговый рекорд. Первый цикл разминки — шаг 1.'],
  proofSteps: ['Шаги после нахождения оптимума', 'Сколько кандидатов пришлось проверить после последнего улучшения.'],
  ratio: ['Отношение ℓ₁ / ℓ₂', 'Длина первой ветви относительно второй в итоговом оптимальном цикле.'],
  balance: ['Короткая / длинная, %', 'Отношение длин ветвей оптимального цикла без учёта их цвета. При равенстве получается 100 %.'],
  q: ['Баланс Q', 'Отношение энергии ветвей оптимального цикла к энергии двух равных ветвей той же суммарной длины.'],
  l1: ['Длина ветви ℓ₁', 'Длина первой ветви итогового цикла.'],
  l2: ['Длина ветви ℓ₂', 'Длина второй ветви итогового цикла.'],
  length: ['Длина цикла L', 'Сумма длин обеих ветвей итогового цикла.'],
  boundCuts: ['Отсечения по длине', 'Число кандидатов, отброшенных по их индивидуальной нижней оценке.'],
  crossings: ['Отсечения по пересечению', 'Число продолжений, отброшенных из-за пересечения рёбер.'],
  deadEnds: ['Тупики по доступности', 'Число кандидатов, у которых оставшиеся города невозможно соединить в один путь.']
};

function emptyStats(n) {
  return { n, series: 0, manual: 0, byBound: 0, metrics: {} };
}

function statisticsMetrics(kind = 'normal') {
  if (kind !== 'proof') return Object.fromEntries(Object.entries(statsMetrics).filter(([key]) => !(key in proofMetrics)));
  return { ...statsMetrics,
    mainSteps: ['Состояния подтверждения', 'Свежий поиск с готовым оптимальным циклом со старта, без разминки и без кеша первого запуска.'],
    totalMs: ['Подтверждение оптимума, мс', 'Весь повторный расчёт, включая проверку начального цикла, подготовку и матрицу. Получение начального оптимума измеряется отдельно.'] };
}

function statsReport(rows, plan = initialPlan(), algorithm = 'khvastuns', kind = 'normal', profile = { type: 'uniform' }, scoreModel = CURRENT_SCORE_MODEL) {
  const definitions = statisticsMetrics(kind);
  function counts(series, manual, byBound, withWarmupSteps) {
    const completed = series + manual;
    return { series, manual, completed, withWarmupSteps, byBound: algorithm === 'held' ? null : byBound,
      byBoundPercent: completed && algorithm !== 'held' ? 100 * byBound / completed : null };
  }
  let series = 0, manual = 0, byBound = 0, withWarmupSteps = 0;
  const sizes = rows.filter(row => row.n <= MAX_SERIES_CITIES || row.manual > 0).map(row => {
    series += row.series;
    manual += row.manual;
    byBound += row.byBound;
    withWarmupSteps += row.withWarmupSteps || 0;
    const samples = counts(row.series, row.manual, row.byBound, row.withWarmupSteps || 0);
    const metrics = {};
    for (const key of Object.keys(definitions)) {
      const m = row.metrics[key];
      metrics[key] = m ? { ...m, mean: m.sum / (m.samples ?? samples.completed) } : null;
    }
    const batchStart = plan.starts[row.n] || 0;
    return { n: row.n, ...samples, batchStart, seriesTarget: row.n <= MAX_SERIES_CITIES ? batchStart + SERIES_TARGET : null, metrics,
      ...(isVariableAlgorithm(algorithm) ? { scoreDistribution: scoreDistribution([row], row.n, 'combined', scoreModel),
        scoreDistributions: Object.fromEntries(Object.keys(SCORE_COMPONENTS).map(key => [key, scoreDistribution([row], row.n, key, scoreModel)])) } : {}) };
  });
  return {
    formatVersion: 1, algorithm, kind, fieldProfile: normalizeFieldProfile(profile), fieldGeneratorVersion: 1,
    ...(isVariableAlgorithm(algorithm) ? { scoreModel, scoreFormula: scoreModelInfo(scoreModel).formula } : {}),
    seriesSeedFormula: 'seriesSeed(n, index), index начинается с 0',
    exportedAt: new Date().toISOString(), seriesTargetPerSize: SERIES_TARGET,
    metricLabels: Object.fromEntries(Object.entries(definitions).map(([key, [label]]) => [key, label])),
    totals: counts(series, manual, byBound, withWarmupSteps), sizes,
    ...(isVariableAlgorithm(algorithm) ? { scoreDistribution: scoreDistribution(rows, null, 'combined', scoreModel),
      scoreDistributions: Object.fromEntries(Object.keys(SCORE_COMPONENTS).map(key => [key, scoreDistribution(rows, null, key, scoreModel)])) } : {})
  };
}

function downloadStatsReport(report, name) {
  const file = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pathfind-' + name + '-results-' + report.exportedAt.replace(/[:.]/g, '-') + '.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addMeasurement(row, measurement, index) {
  // Две вкладки могут закончить одно поле серии. Индекс проверяется внутри транзакции.
  if (index !== null && row.series !== index) return false;
  if (index === null) row.manual++;
  else row.series++;
  if (measurement.byBound) row.byBound++;
  if (measurement.includesWarmupSteps) row.withWarmupSteps = (row.withWarmupSteps || 0) + 1;
  for (const [name, value] of Object.entries(measuredValues(measurement))) {
    const metric = row.metrics[name];
    if (metric) {
      metric.min = Math.min(metric.min, value);
      metric.max = Math.max(metric.max, value);
      metric.sum += value;
    } else row.metrics[name] = { min: value, max: value, sum: value };
    // В старых прогонах этих замеров нет: они не входят в знаменатель среднего.
    if (name in workMetrics) row.metrics[name].samples = (row.metrics[name].samples || 0) + 1;
  }
  return true;
}

function statsDatabaseName(algorithm = 'khvastuns', kind = 'normal', profile = { type: 'uniform' }, scoreModel = CURRENT_SCORE_MODEL) {
  scoreModelInfo(scoreModel);
  const key = fieldProfileKey(profile);
  return 'atlas-route-statistics-v1' + (algorithm === 'khvastuns' ? '' : '-' + algorithm) + (kind === 'proof' ? '-proof' : '') +
    (isVariableAlgorithm(algorithm) && scoreModel !== LEGACY_SCORE_MODEL ? '-score-' + scoreModel : '') +
    (key ? '-field-' + key : '');
}

function openStatsDatabase(algorithm = 'khvastuns', kind = 'normal', profile = { type: 'uniform' }, scoreModel = CURRENT_SCORE_MODEL) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(statsDatabaseName(algorithm, kind, profile, scoreModel), 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sizes', { keyPath: 'n' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function initialPlan() {
  return { n: PLAN_KEY, revision: 0, resetAt: 0, cleared: {}, starts: {}, only: null };
}

function generation(plan, n) {
  return plan.cleared[n] ?? plan.resetAt;
}

function statsKey(plan, n) {
  // После сброса старые вкладки могут писать по прежнему ключу, но не в новую выборку.
  const version = generation(plan, n);
  return version ? [version, n] : n;
}

function readStatistics(db, cityCounts, edit) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sizes', edit ? 'readwrite' : 'readonly');
    const store = tx.objectStore('sizes');
    const read = store.getAll();
    let snapshot;
    read.onsuccess = () => {
      const records = new Map(read.result.map(item => [String(item.n), item]));
      const plan = records.get(PLAN_KEY) || initialPlan();
      const rows = cityCounts.map(n => {
        const saved = records.get(String(statsKey(plan, n)));
        return saved?.row || saved || emptyStats(n);
      });
      const changed = edit ? edit(store, plan, rows) : false;
      if (changed) store.put(plan);
      snapshot = { plan, rows, changed };
    };
    tx.oncomplete = () => resolve(snapshot);
    tx.onabort = () => reject(tx.error || new Error('Не удалось получить статистику'));
  });
}

function saveMeasurement(db, plan, n, measurement, index) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sizes', 'readwrite');
    const sizes = tx.objectStore('sizes');
    const key = statsKey(plan, n);
    const control = sizes.get(PLAN_KEY);
    const read = sizes.get(key);
    let row;
    read.onsuccess = () => {
      const active = control.result || initialPlan();
      if (generation(active, n) !== generation(plan, n) || (index !== null && active.revision !== plan.revision)) return;
      row = read.result?.row || read.result || emptyStats(n);
      if (addMeasurement(row, measurement, index)) sizes.put(Array.isArray(key) ? { n: key, row } : row);
    };
    tx.oncomplete = () => resolve(row);
    tx.onabort = () => reject(tx.error || new Error('Запись статистики прервана'));
  });
}

function initStatistics(maxCities, algorithm, kind = 'normal', profile = { type: 'uniform' }, isCurrent = () => true,
  scoreModel = CURRENT_SCORE_MODEL, readOnly = false) {
  profile = normalizeFieldProfile(profile);
  const canSeries = profile.type !== 'custom' && !readOnly;
  const proof = kind === 'proof', definitions = statisticsMetrics(kind);
  const selected = () => isCurrent() && el('algorithm').value === algorithm && el('series-mode').value === kind;
  if (algorithm === 'held') maxCities = Math.min(maxCities, 22);
  const minCities = Number(el('count').min);
  const cityCounts = Array.from({ length: maxCities - minCities + 1 }, (_, i) => minCities + i);
  let rows = cityCounts.map(emptyStats), plan = initialPlan();
  const recordedFields = new WeakMap();
  const average = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  const database = openStatsDatabase(algorithm, kind, profile, scoreModel);
  let ready = false, running = false, task = null, worker = null, localRunner = null;
  let exporting = false, changing = false;
  let error = '', paintTimer = null;

  function merge(row) {
    const i = row.n - minCities, old = rows[i];
    if (old && row.series + row.manual >= old.series + old.manual) rows[i] = row;
  }
  function applySnapshot(snapshot) {
    if (snapshot.plan.revision < plan.revision) return;
    if (snapshot.plan.revision !== plan.revision) {
      running = false;
      task = null;
      if (worker) { worker.onmessage = worker.onerror = null; worker.terminate(); worker = null; }
      if (localRunner) { localRunner({ type: 'pause' }); localRunner = null; }
      plan = snapshot.plan;
      rows = snapshot.rows;
      if (selected()) el('export-status').hidden = true;
    } else snapshot.rows.forEach(merge);
    ready = true;
    paint();
  }
  async function refresh() {
    applySnapshot(await readStatistics(await database, cityCounts));
  }
  function remaining(row) {
    return canSeries && row.n <= MAX_SERIES_CITIES && row.series < (plan.starts[row.n] || 0) + SERIES_TARGET;
  }
  function share(wins, total) {
    return total ? average.format(100 * wins / total) + ' %' : '—';
  }
  function paint() {
    clearTimeout(paintTimer);
    paintTimer = null;
    if (!selected()) return;
    el('stats-tab').textContent = running ? 'Сбор сложности · идёт' : 'Сбор сложности';
    if (el('stats-panel').hidden) return;
    const busy = !ready || changing;
    el('stats-export').disabled = busy || exporting;
    el('stats-reset').disabled = busy || running || exporting || readOnly;
    el('series-add').disabled = busy || running || exporting || !canSeries;
    const metric = el('stats-metric').value;
    const batch = plan.only === null ? rows.filter(row => row.n <= MAX_SERIES_CITIES) : [rows[plan.only - minCities]];
    const completed = batch.reduce((s, row) => s + row.series - (plan.starts[row.n] || 0), 0);
    const total = rows.reduce((s, row) => s + row.series + row.manual, 0);
    const byBound = rows.reduce((s, row) => s + row.byBound, 0);
    const target = batch.length * SERIES_TARGET;
    el('series-progress').max = target;
    el('series-progress').value = completed;
    el('series-total').textContent = integer.format(completed) + ' / ' + integer.format(target);
    el('series-start').disabled = busy || running || !rows.some(remaining);
    el('series-stop').disabled = !running;
    el('series-start-label').textContent = plan.only !== null && completed >= target ? 'Продолжить общую серию'
      : task || completed ? 'Продолжить серию' : 'Запустить серию';
    const position = task ? ' · ' + task.n + ' гор., поле ' + (task.index + 1) +
      (proof ? task.phase === 'proof' ? ' · 2/2: подтверждение' : ' · 1/2: получение оптимума' : '') +
      ' · состояний поиска: ' + integer.format(task.mainSteps) +
      (algorithm === 'held' ? '' : ' · достройка: ' + integer.format(task.completionChecks || 0) +
        ' проверок · порог очереди ' + integer.format(task.queueLimit)) +
      (task.relaxedChecks ? ' · с распутыванием: ' + integer.format(task.relaxedChecks) + ' проверок' : '') : '';
    const scope = plan.only !== null && !task ? ' · ' + plan.only + ' гор.' : '';
    el('series-state').textContent = (!ready ? 'Ожидание хранилища' : completed >= target ? 'Серия завершена' : running ? 'Идёт сбор' : task || completed ? 'Остановлено' : 'Готово к запуску') + scope + position;
    el('series-field-code').value = task?.code || '';
    el('series-field-copy').disabled = !task;
    el('series-error').hidden = !error;
    el('series-error').textContent = error;
    el('overall-bound').parentElement.hidden = algorithm === 'held';
    el('overall-bound').textContent = 'Всего завершено по границе ' + share(byBound, total) + ' (' + integer.format(byBound) + ' из ' + integer.format(total) + ').';
    el('metric-description').textContent = definitions[metric][1];
    if (isVariableAlgorithm(algorithm)) renderScoreDistribution(rows, kind, scoreModel);
    el('stats-rows').innerHTML = rows.filter(row => row.n <= MAX_SERIES_CITIES || row.manual > 0).map(row => {
      const count = row.series + row.manual, m = row.metrics[metric];
      const measured = m ? m.samples ?? count : 0;
      const values = m ? [m.min, m.max, m.sum / measured].map(v => metric in scoreQualityMetrics || metric in scoreDistributionMetrics ? formatEdgeScore(v) : average.format(v)) : ['—', '—', '—'];
      return '<tr><th scope="row">' + row.n + '</th><td>' + integer.format(row.series) + '</td><td>' + integer.format(row.manual) + '</td>' +
        '<td>' + integer.format(measured) + '</td>' + values.map(v => '<td>' + v + '</td>').join('') + '<td title="' + row.byBound + ' из ' + count + '">' + (algorithm === 'held' ? '—' : share(row.byBound, count)) + '</td>' +
        '<td class="row-actions">' + (readOnly ? 'Архив' : row.n > MAX_SERIES_CITIES || !canSeries ? 'Только вручную' : ['restart', 'add'].map(action => {
          const label = action === 'restart' ? 'Заново' : 'Ещё 1 000';
          return '<button class="outline" data-action="' + action + '" data-n="' + row.n + '" aria-label="' + label + ', ' + row.n + ' городов"' +
            (busy || running || exporting ? ' disabled' : '') + '>' + label + '</button>';
        }).join(' ')) + '</td></tr>';
    }).join('');
  }
  function schedulePaint() {
    if (paintTimer === null) paintTimer = setTimeout(paint, 150);
  }
  function storageError() {
    running = false;
    if (task && !task.result) command({ type: 'pause' });
    error = 'Не удалось сохранить или прочитать статистику. Проверь доступ браузера к локальному хранилищу.';
    paint();
  }
  async function commit(n, measurement, index) {
    if (readOnly || (isVariableAlgorithm(algorithm) && measurement.scoreModel !== scoreModel)) throw new Error('Версия замера не совпадает с базой статистики.');
    const started = plan;
    const db = await database;
    const saved = await saveMeasurement(db, started, n, measurement, index);
    if (!saved) { await refresh(); return; }
    if (plan.revision !== started.revision) return;
    merge(saved);
    schedulePaint();
  }
  async function finishTask(current) {
    if (current.saving) return;
    current.saving = true;
    try {
      await commit(current.n, current.result, current.index);
      if (task !== current) return;
      task = null;
      if (running) nextField();
    } catch {
      if (task !== current) return;
      current.saving = false;
      storageError();
    }
  }
  function receive(message) {
    if (!task) return;
    if (message.error) { running = false; task = null; error = message.error; paint(); return; }
    task.mainSteps = message.mainSteps;
    task.completionChecks = message.completionChecks;
    task.relaxedChecks = message.relaxedChecks;
    task.queueLimit = message.queueLimit ?? INITIAL_QUEUE_LIMIT;
    task.phase = message.phase;
    if (message.done) {
      if (isVariableAlgorithm(algorithm) && message.measurement?.scoreModel !== scoreModel) {
        running = false; task = null; error = 'Версия оценки исполнителя не совпала. Обнови страницу; поле не записано.'; paint(); return;
      }
      if (proof && !message.proofSeries) {
        running = false; task = null;
        error = 'Исполнитель не подтвердил повторный запуск. Обнови страницу; поле не записано.';
        paint(); return;
      }
      task.result = message.measurement;
      finishTask(task);
    }
    schedulePaint();
  }
  function command(message) {
    if (message.type === 'start') message = { ...message, scoreModel };
    if (!worker && !localRunner) {
      if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
        try { worker = new Worker('series-runner.js'); } catch { /* Локальный расчёт доступен ниже. */ }
      }
      if (worker) {
        worker.onmessage = event => receive(event.data);
        worker.onerror = () => {
          worker.terminate();
          worker = null;
          localRunner = createSeriesRunner(receive, 8);
          if (task && !task.result) {
            localRunner({ type: 'start', algorithm, points: task.points, proofSeries: proof, scoreModel });
            if (!running) localRunner({ type: 'pause' });
          }
        };
      } else localRunner = createSeriesRunner(receive, 8);
    }
    if (worker) worker.postMessage(message);
    else localRunner(message);
  }
  function nextField() {
    const row = rows.find(r => (plan.only === null || plan.only === r.n) && remaining(r));
    if (!row) { running = false; paint(); return; }
    task = { n: row.n, index: row.series, points: profileSeriesField(row.n, row.series, profile),
      code: encodeField(profile, row.n, seriesSeed(row.n, row.series)), mainSteps: 0, queueLimit: INITIAL_QUEUE_LIMIT };
    command({ type: 'start', algorithm, points: task.points, proofSeries: proof });
  }

  const updates = typeof BroadcastChannel === 'function' ? new BroadcastChannel(statsDatabaseName(algorithm, kind, profile, scoreModel).replace('atlas-route-statistics-v1', 'atlas-route-series')) : null;
  if (updates) updates.onmessage = () => refresh().catch(storageError);

  async function changeSeries(action, n = null) {
    if (!ready || running || changing || exporting || readOnly) return;
    if (!canSeries && action !== 'reset') return;
    if (action === 'reset' || action === 'restart') {
      const affected = n === null ? rows : [rows[n - minCities]];
      const series = affected.reduce((sum, row) => sum + row.series, 0);
      const manual = affected.reduce((sum, row) => sum + row.manual, 0);
      const scope = ROUTE_ALGORITHMS[algorithm] + (proof ? ' · подтверждение оптимума' : ' · обычный поиск') + ' · ' + fieldProfileLabel(profile);
      const question = n === null ? 'Сбросить всю статистику ' + scope + '?' : 'Начать заново для ' + n + ' городов (' + scope + ')?';
      const detail = 'Серийных результатов к удалению: ' + integer.format(series) + ', ручных: ' + integer.format(manual) + '.';
      if (!window.confirm(question + '\n' + detail)) return;
    }
    const revision = plan.revision;
    changing = true;
    error = '';
    paint();
    try {
      const snapshot = await readStatistics(await database, cityCounts, (store, next, saved) => {
        if (next.revision !== revision) return false;
        next.revision++;
        next.only = n;
        if (action === 'reset') {
          store.clear();
          next.resetAt = next.revision;
          next.starts = {};
          next.cleared = {};
          saved.forEach((row, i) => { saved[i] = emptyStats(row.n); });
        } else if (action === 'restart') {
          store.delete(statsKey(next, n));
          next.cleared[n] = next.revision;
          next.starts[n] = 0;
          saved[n - minCities] = emptyStats(n);
        } else if (action === 'add') {
          for (const row of saved) {
            if (row.n <= MAX_SERIES_CITIES && (n === null || n === row.n)) next.starts[row.n] = row.series;
          }
        }
        return true;
      });
      applySnapshot(snapshot);
      if (snapshot.changed && plan.revision === snapshot.plan.revision) {
        updates?.postMessage(plan.revision);
        if (action !== 'reset' && selected()) startSeries();
      } else error = 'План серии изменён в другой вкладке. Данные обновлены.';
    } catch {
      error = 'Не удалось изменить серию в локальном хранилище. Попробуй ещё раз.';
    } finally {
      changing = false;
      paint();
    }
  }

  function selectMode(stats) {
    el('manual-panel').hidden = stats;
    el('stats-panel').hidden = !stats;
    el('manual-tab').setAttribute('aria-pressed', String(!stats));
    el('stats-tab').setAttribute('aria-pressed', String(stats));
    if (stats) { paint(); refresh().catch(storageError); }
  }
  function startSeries() {
    if (!canSeries) return;
    running = true;
    error = '';
    if (!task) nextField();
    else if (task.result) finishTask(task);
    else command({ type: 'resume' });
    paint();
  }
  async function report() {
    const snapshot = await readStatistics(await database, cityCounts);
    return statsReport(snapshot.rows, snapshot.plan, algorithm, kind, profile, scoreModel);
  }
  function activate() {
    el('manual-tab').onclick = () => selectMode(false);
    el('stats-tab').onclick = () => selectMode(true);
    const metric = el('stats-metric'), previous = metric.value;
    const componentSummary = key => Object.values(SCORE_COMPONENTS).some(c => key === c.min || key === c.prefix + 'Mean');
    const supported = Object.entries(definitions).filter(([key]) => (!(key in scoreDistributionMetrics) || (isVariableAlgorithm(algorithm) && componentSummary(key))) &&
      (algorithm === 'hvastuns-staged' || !(key in stageMetrics)) &&
      (isVariableAlgorithm(algorithm) || !(key in combinationMetrics)) &&
      (isVariableAlgorithm(algorithm) || !key.startsWith('relaxed')) &&
      (isVariableAlgorithm(algorithm) || !(key in scoreQualityMetrics)) &&
      (algorithm !== 'held' || ['mainSteps', 'totalMs', 'preparationMs', 'searchMs', 'l1', 'l2', 'length', 'ratio', 'balance', 'q'].includes(key)));
    metric.innerHTML = supported.map(([key, m]) => '<option value="' + key + '">' + m[0] + '</option>').join('');
    if (supported.some(([key]) => key === previous)) metric.value = previous;
    else metric.value = 'mainSteps';
    metric.onchange = paint;
    el('distribution-size').onchange = el('distribution-y').onchange = el('distribution-component').onchange = paint;
    el('series-field-copy').onclick = () => copyFieldText(el('series-field-code'));
    el('stats-export').onclick = async () => {
      if (!ready || exporting || changing) return;
      exporting = true;
      paint();
      const status = el('export-status');
      try {
        const result = await report();
        downloadStatsReport(result, algorithm + (proof ? '-proof' : ''));
        status.textContent = 'JSON подготовлен. Завершённых прогонов в сводке — ' + integer.format(result.totals.completed) + '.';
      } catch {
        status.textContent = 'Не удалось скачать сводку. Попробуй ещё раз.';
      } finally {
        exporting = false;
        status.hidden = false;
        paint();
      }
    };
    el('series-start').onclick = () => {
      if (running || !ready || changing) return;
      if (plan.only !== null && !remaining(rows[plan.only - minCities])) changeSeries('resume-all');
      else startSeries();
    };
    el('series-add').onclick = () => changeSeries('add');
    el('stats-reset').onclick = () => changeSeries('reset');
    el('stats-rows').onclick = event => {
      const button = event.target.closest('button[data-action]');
      if (button) changeSeries(button.dataset.action, Number(button.dataset.n));
    };
    el('series-stop').onclick = () => {
      running = false;
      if (task && !task.result) command({ type: 'pause' });
      paint();
    };
    el('export-status').hidden = true;
    el('stats-scope').textContent = ROUTE_ALGORITHMS[algorithm] + (proof ? ' · подтверждение оптимума' : ' · обычный поиск') +
      ' · ' + fieldProfileLabel(profile) + (isVariableAlgorithm(algorithm) ? ' · ' + scoreModelInfo(scoreModel).label : '') +
      (readOnly ? ' · архив, только просмотр и экспорт.' : canSeries ? ' · серия 3–' + Math.min(maxCities, MAX_SERIES_CITIES) + ' городов.' : ' · только ручные прогоны.');
    el('series-proof-description').hidden = !proof;
    el('stats-run-description').textContent = proof ? 'Показатели относятся к повторному подтверждению с готовым оптимумом. Получение начального маршрута и время обоих запусков доступны отдельными показателями. Записываются только поля, где оба запуска завершились и длины совпали.' :
      'Минимум, максимум и среднее включают только прогоны, в которых измерялся выбранный показатель. Их число указано в столбце «Замеров». Повтор ручного поиска на том же поле учитывается один раз.';
    paint();
  }
  window.addEventListener('focus', () => { if (selected() && !el('stats-panel').hidden) refresh().catch(storageError); });
  refresh().catch(storageError);
  return {
    activate, report,
    pause() {
      running = false;
      if (task && !task.result) command({ type: 'pause' });
    },
    recordManual(points, measurement) {
      if (proof || readOnly) return;
      if (!ready) {
        refresh().then(() => this.recordManual(points, measurement)).catch(storageError);
        return;
      }
      const version = generation(plan, points.length);
      if (recordedFields.get(points) === version) return;
      recordedFields.set(points, version);
      commit(points.length, measurement, null).catch(() => {
        if (recordedFields.get(points) === version) recordedFields.delete(points);
        storageError();
      });
    }
  };
}
